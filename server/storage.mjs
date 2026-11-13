// Слепое транзакционное хранилище сервера (BlindStorage).
// Спроектировано так, что дамп базы физически НЕ содержит:
//   - открытых сообщений (конверты удаляются сразу после ACK),
//   - списка контактов и связей «кто с кем общается» (нет поля fromUserId),
//   - реальных IP-адресов или истории входов,
//   - паролей и симметричных верификаторов (хранится только публичный ключ ECDSA + клиентский шифроблоб).
//
// Движок записи: быстрый Append-Only журнал (WAL с проверкой контрольной суммы SHA-256)
// + атомарный компактификатор снапшотов (tmp -> fsync -> rename) + облачное зеркало S3.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const DEFAULT_ENVELOPE_TTL_MS = 14 * 24 * 3600 * 1000; // Макс. хранение недоставленного конверта — 14 дней
const DEFAULT_BLOB_TTL_MS = 30 * 24 * 3600 * 1000;     // Автоудаление шифроблобов через 30 дней

/** Округляет метку времени до 5-минутного интервала (защита от точной корреляции в БД) */
function coarseTimestamp(ts = Date.now()) {
  return Math.floor(ts / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
}

/** Только сутки (YYYY-MM-DD) без часов и секунд */
function coarseDay(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function sha256B64(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

export class BlindStorage {
  constructor({
    dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data'),
    s3Mirror = null,
    compactEveryOps = 500,
  } = {}) {
    this.dataDir = dataDir;
    this.blobsDir = path.join(dataDir, 'blobs');
    this.snapshotPath = path.join(dataDir, 'blind-state.json');
    this.walPath = path.join(dataDir, 'blind-state.wal');
    this.s3 = s3Mirror;
    this.compactEveryOps = compactEveryOps;

    this._walFd = null;
    this._walOps = 0;
    this._s3SyncTimer = null;

    // Индексированное состояние в памяти
    this.users = new Map();          // userId -> userRecord
    this.userByUsername = new Map(); // normalizedUsername -> userId
    this.userByMailbox = new Map();  // mailboxId -> userId
    this.opks = new Map();           // userId -> Array<{ keyId, pub }>
    this.envelopes = new Map();      // mailboxId -> Map<envId, envelope>
    this.asks = new Map();           // mailboxId -> Array<askEnvelope>
    this.rooms = new Map();          // roomId -> roomRecord (зашифрованные каналы/группы)
    this.sessions = new Map();       // sessionTokenHash -> { userId, expiresAt }
    this.blobs = new Map();          // blobId -> { id, size, sha256B64, once, burnTokenHash, expiresAt }
    this.invites = new Map();        // inviteHash -> { inviteHash, maxUses, used, expiresAt }
    this.meta = {
      schemaVersion: 1,
      serverFakeAuthSeed: crypto.randomBytes(32).toString('base64url'),
    };
  }

  async init() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.blobsDir, { recursive: true });

    let loaded = false;
    if (fs.existsSync(this.snapshotPath)) {
      const raw = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8'));
      this._hydrateSnapshot(raw);
      loaded = true;
    }

    if (fs.existsSync(this.walPath)) {
      this._replayWal();
      loaded = true;
    }

    // Если локальный диск пуст (холодный старт на Render Free / Fly), подтягиваем снапшот из S3
    if (!loaded && this.s3?.enabled) {
      const cloudSnap = await this.s3.pullSnapshot();
      if (cloudSnap) {
        this._hydrateSnapshot(cloudSnap);
        this.compactSync();
      }
    }

    this._walFd = fs.openSync(this.walPath, 'a');
    this.purgeExpired();

    this._gcInterval = setInterval(() => this.purgeExpired(), 60 * 1000);
    this._gcInterval.unref?.();
  }

  // ─────────────────────── Пользователи и ключи X3DH ───────────────────────

  createUser({
    id,
    username,
    authPubB64,
    encryptedAuthKey,
    publicBundle,
    mailboxId,
    mailboxWriteToken,
    encryptedRecovery = null,
  }) {
    const uname = username.toLowerCase();
    if (this.userByUsername.has(uname)) {
      throw new Error('USERNAME_TAKEN');
    }

    const record = {
      id,
      username: uname,
      authPubB64,
      encryptedAuthKey,
      encryptedRecovery,
      identity: publicBundle.identity,
      signedPreKey: publicBundle.signedPreKey,
      mailboxId,
      mailboxWriteToken, // Токен доставки, выдаваемый вместе с PreKeyBundle (владелец может ротировать в 1 клик)
      mailboxWriteHash: sha256B64(mailboxWriteToken),
      askSalt: crypto.randomBytes(24).toString('base64url'),
      askEnabled: true,
      blockedAskTags: [],
      createdDay: coarseDay(),
    };

    const opkList = Array.isArray(publicBundle.oneTimePreKeys)
      ? publicBundle.oneTimePreKeys.slice(0, 200)
      : [];

    this._appendOp({ type: 'user.put', record, opkList });
    return record;
  }

  getUserByUsername(username) {
    const id = this.userByUsername.get(String(username || '').toLowerCase());
    return id ? this.users.get(id) || null : null;
  }

  getUserById(userId) {
    return this.users.get(userId) || null;
  }

  getUserByMailbox(mailboxId) {
    const uid = this.userByMailbox.get(mailboxId);
    return uid ? this.users.get(uid) || null : null;
  }

  /**
   * Выдаёт PreKeyBundle собеседника для X3DH и атомарно удаляет один One-Time PreKey (OPK).
   */
  consumePreKeyBundle(usernameOrId) {
    const key = String(usernameOrId || '').trim().replace(/^@/, '');
    const user = this.users.get(key) || this.getUserByUsername(key);
    if (!user) return null;

    const list = this.opks.get(user.id) || [];
    let oneTimePreKey = null;
    if (list.length > 0) {
      oneTimePreKey = list[0];
      this._appendOp({ type: 'opk.pop', userId: user.id, keyId: oneTimePreKey.keyId });
    }

    return {
      userId: user.id,
      username: user.username,
      mailboxId: user.mailboxId,
      mailboxWriteToken: user.mailboxWriteToken,
      identity: user.identity,
      signedPreKey: user.signedPreKey,
      oneTimePreKey,
    };
  }

  countRemainingOpks(userId) {
    return (this.opks.get(userId) || []).length;
  }

  replenishOpks(userId, newOpks) {
    if (!this.users.has(userId) || !Array.isArray(newOpks)) return 0;
    const clean = newOpks
      .filter((k) => Number.isInteger(k.keyId) && typeof k.pub === 'string' && k.pub.length <= 120)
      .slice(0, 150);
    this._appendOp({ type: 'opk.push', userId, items: clean });
    return this.countRemainingOpks(userId);
  }

  updateSignedPreKey(userId, signedPreKey) {
    const u = this.users.get(userId);
    if (!u) return false;
    this._appendOp({ type: 'user.spk', userId, signedPreKey });
    return true;
  }

  rotateMailbox(userId, newMailboxId, newWriteToken) {
    const u = this.users.get(userId);
    if (!u) return null;
    this._appendOp({
      type: 'user.mailbox',
      userId,
      mailboxId: newMailboxId,
      mailboxWriteToken: newWriteToken,
      mailboxWriteHash: sha256B64(newWriteToken),
    });
    return { mailboxId: newMailboxId, mailboxWriteToken: newWriteToken };
  }

  saveRecoveryBlob(userId, encryptedRecovery) {
    if (!this.users.has(userId)) return false;
    this._appendOp({ type: 'user.recovery', userId, encryptedRecovery });
    return true;
  }

  deleteAccountCompletely(userId) {
    if (!this.users.has(userId)) return false;
    this._appendOp({ type: 'user.del', userId });
    return true;
  }

  // ─────────────────────── Сессии (только SHA-256 хеш токена, без IP и UA!) ───────────────────────

  createSession(userId, ttlMs = 30 * 24 * 3600 * 1000) {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = sha256B64(rawToken);
    const expiresAt = Date.now() + ttlMs;
    this._appendOp({ type: 'session.put', tokenHash, userId, expiresAt });
    return { token: rawToken, expiresAt };
  }

  verifySessionToken(rawToken) {
    if (typeof rawToken !== 'string' || rawToken.length < 20) return null;
    const tokenHash = sha256B64(rawToken);
    const s = this.sessions.get(tokenHash);
    if (!s) return null;
    if (s.expiresAt <= Date.now()) {
      this._appendOp({ type: 'session.del', tokenHash });
      return null;
    }
    const user = this.users.get(s.userId);
    return user ? { user, tokenHash } : null;
  }

  revokeSession(rawToken) {
    const tokenHash = sha256B64(String(rawToken || ''));
    if (this.sessions.has(tokenHash)) {
      this._appendOp({ type: 'session.del', tokenHash });
    }
  }

  // ─────────────────────── Слепые почтовые ящики (Blind Mailboxes) ───────────────────────

  /**
   * Кладёт зашифрованный конверт Sealed Sender в почтовый ящик получателя.
   * Не принимает и не сохраняет идентификатор отправителя!
   */
  enqueueEnvelope({ mailboxId, sealedBytes, ttlSec = 14 * 86400 }) {
    const owner = this.getUserByMailbox(mailboxId);
    if (!owner) throw new Error('MAILBOX_NOT_FOUND');

    const box = this.envelopes.get(mailboxId);
    if (box && box.size >= 2000) {
      throw new Error('MAILBOX_FULL');
    }

    const ttlMs = Math.min(DEFAULT_ENVELOPE_TTL_MS, Math.max(5000, Number(ttlSec) * 1000));
    const item = {
      id: `env_${crypto.randomBytes(12).toString('base64url')}`,
      mailboxId,
      blobB64: Buffer.from(sealedBytes).toString('base64url'),
      createdBucket: coarseTimestamp(),
      expiresAt: Date.now() + ttlMs,
    };
    this._appendOp({ type: 'env.put', item });
    return { id: item.id, expiresAt: item.expiresAt };
  }

  /** Возвращает очередь непрочитанных конвертов владельцу ящика */
  pullEnvelopes(mailboxId, limit = 100) {
    const box = this.envelopes.get(mailboxId);
    if (!box || box.size === 0) return [];
    const now = Date.now();
    const out = [];
    for (const env of box.values()) {
      if (env.expiresAt > now) {
        out.push(env);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** Физическое удаление доставленных конвертов сразу после клиентского ACK */
  ackEnvelopes(mailboxId, ids) {
    const box = this.envelopes.get(mailboxId);
    if (!box || !Array.isArray(ids) || ids.length === 0) return 0;
    const removed = ids.filter((id) => box.has(id));
    if (removed.length > 0) {
      this._appendOp({ type: 'env.ack', mailboxId, ids: removed });
    }
    return removed.length;
  }

  // ─────────────────────── Зашифрованные комнаты / каналы (Spaces) ───────────────────────

  createRoom({ roomId, verifyPubB64, encryptedMetaB64, writeTokenHash }) {
    if (this.rooms.has(roomId)) throw new Error('ROOM_EXISTS');
    const room = {
      id: roomId,
      verifyPubB64,
      encryptedMetaB64,
      writeTokenHash,
      seq: 0,
      items: [],
      createdDay: coarseDay(),
    };
    this._appendOp({ type: 'room.create', room });
    return room;
  }

  appendRoomEnvelope({ roomId, encryptedBlobB64, ttlSec = 7 * 86400 }) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    const ttlMs = Math.min(DEFAULT_ENVELOPE_TTL_MS, Math.max(5000, Number(ttlSec) * 1000));
    const entry = {
      seq: room.seq + 1,
      id: `rm_${crypto.randomBytes(10).toString('base64url')}`,
      blobB64: encryptedBlobB64,
      createdBucket: coarseTimestamp(),
      expiresAt: Date.now() + ttlMs,
    };
    this._appendOp({ type: 'room.post', roomId, entry });
    return entry;
  }

  getRoomHistory(roomId, afterSeq = 0, limit = 100) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const now = Date.now();
    const items = room.items
      .filter((x) => x.seq > afterSeq && x.expiresAt > now)
      .slice(-limit);
    return {
      id: room.id,
      encryptedMetaB64: room.encryptedMetaB64,
      seq: room.seq,
      items,
    };
  }

  // ─────────────────────── E2E «Голая правда» (анонимные вопросы) ───────────────────────

  enqueueAnonymousAsk({ mailboxId, payloadB64, senderBlockTag }) {
    const owner = this.getUserByMailbox(mailboxId);
    if (!owner || !owner.askEnabled) throw new Error('ASK_DISABLED');
    if (owner.blockedAskTags.includes(senderBlockTag)) {
      // Теневой отказ: заблокированный тролль не узнаёт о блокировке
      return { accepted: true, shadowed: true };
    }
    const ask = {
      id: `ask_${crypto.randomBytes(10).toString('base64url')}`,
      payloadB64,
      senderBlockTag,
      createdBucket: coarseTimestamp(),
      expiresAt: Date.now() + DEFAULT_ENVELOPE_TTL_MS,
    };
    this._appendOp({ type: 'ask.put', mailboxId, ask });
    return { accepted: true, id: ask.id };
  }

  pullAnonymousAsks(mailboxId) {
    return (this.asks.get(mailboxId) || []).filter((a) => a.expiresAt > Date.now());
  }

  ackAnonymousAsk(mailboxId, askId) {
    this._appendOp({ type: 'ask.ack', mailboxId, askId });
  }

  blockAnonymousSender(userId, senderBlockTag) {
    const u = this.users.get(userId);
    if (!u || typeof senderBlockTag !== 'string') return false;
    this._appendOp({ type: 'ask.block', userId, senderBlockTag: senderBlockTag.slice(0, 32) });
    return true;
  }

  // ─────────────────────── Зашифрованные файлы (Blobs + Одноразовые once) ───────────────────────

  async saveEncryptedBlob({ bytes, once = false, burnToken = '', ttlSec = 30 * 86400 }) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const id = `b_${crypto.randomBytes(16).toString('hex')}`;
    const ttlMs = Math.min(DEFAULT_BLOB_TTL_MS, Math.max(60_000, Number(ttlSec) * 1000));
    const record = {
      id,
      size: buf.length,
      sha256B64: sha256B64(buf),
      once: Boolean(once),
      burnTokenHash: burnToken ? sha256B64(burnToken) : null,
      expiresAt: Date.now() + ttlMs,
    };

    const filePath = path.join(this.blobsDir, `${id}.bin`);
    fs.writeFileSync(filePath, buf);
    if (this.s3?.enabled) {
      await this.s3.putBlob(id, buf);
    }
    this._appendOp({ type: 'blob.put', record });
    return record;
  }

  async readEncryptedBlob(blobId) {
    const rec = this.blobs.get(blobId);
    if (!rec || rec.expiresAt <= Date.now()) return null;
    const filePath = path.join(this.blobsDir, `${blobId}.bin`);
    if (fs.existsSync(filePath)) {
      return { record: rec, buffer: fs.readFileSync(filePath) };
    }
    if (this.s3?.enabled) {
      const cloudBuf = await this.s3.getBlob(blobId);
      if (cloudBuf) {
        fs.writeFileSync(filePath, cloudBuf);
        return { record: rec, buffer: cloudBuf };
      }
    }
    return null;
  }

  async deleteEncryptedBlob(blobId) {
    if (!this.blobs.has(blobId)) return false;
    this._appendOp({ type: 'blob.del', blobId });
    const filePath = path.join(this.blobsDir, `${blobId}.bin`);
    try {
      if (fs.existsSync(filePath)) {
        // Перезаписываем нулями перед unlink для локального диска
        const sz = fs.statSync(filePath).size;
        if (sz > 0 && sz <= 8 * 1024 * 1024) {
          fs.writeFileSync(filePath, Buffer.alloc(sz));
        }
        fs.unlinkSync(filePath);
      }
    } catch { /* ignore */ }
    if (this.s3?.enabled) {
      await this.s3.deleteBlob(blobId);
    }
    return true;
  }

  // ─────────────────────── Инвайт-коды для закрытой сети (INVITE_ONLY) ───────────────────────

  createInvite({ maxUses = 1, ttlSec = 7 * 86400 } = {}) {
    const code = `inv_${crypto.randomBytes(12).toString('base64url')}`;
    const inviteHash = sha256B64(code);
    this._appendOp({
      type: 'invite.put',
      record: { inviteHash, maxUses, used: 0, expiresAt: Date.now() + ttlSec * 1000 },
    });
    return { code, maxUses };
  }

  consumeInvite(code) {
    const inviteHash = sha256B64(String(code || '').trim());
    const rec = this.invites.get(inviteHash);
    if (!rec || rec.expiresAt <= Date.now() || rec.used >= rec.maxUses) return false;
    this._appendOp({ type: 'invite.use', inviteHash });
    return true;
  }

  // ─────────────────────── Сборка мусора по TTL и экспорт для аудита ───────────────────────

  purgeExpired() {
    const now = Date.now();
    for (const [mb, box] of this.envelopes.entries()) {
      const expIds = [];
      for (const [id, env] of box.entries()) {
        if (env.expiresAt <= now) expIds.push(id);
      }
      if (expIds.length) this._appendOp({ type: 'env.ack', mailboxId: mb, ids: expIds });
    }
    for (const [blobId, rec] of this.blobs.entries()) {
      if (rec.expiresAt <= now) {
        this.deleteEncryptedBlob(blobId).catch(() => {});
      }
    }
    for (const [th, sess] of this.sessions.entries()) {
      if (sess.expiresAt <= now) {
        this._appendOp({ type: 'session.del', tokenHash: th });
      }
    }
  }

  /** Обезличенная агрегированная статистика для /api/metrics (без userId и IP) */
  getAnonymousMetrics() {
    let queuedEnvelopes = 0;
    for (const box of this.envelopes.values()) queuedEnvelopes += box.size;
    let blobBytes = 0;
    for (const b of this.blobs.values()) blobBytes += b.size;
    return {
      usersTotal: this.users.size,
      roomsTotal: this.rooms.size,
      envelopesQueued: queuedEnvelopes,
      blobsStored: this.blobs.size,
      blobBytesTotal: blobBytes,
    };
  }

  /** Полная сериализация состояния БД (для снапшотов и проверок безопасности) */
  serializeState() {
    const envelopesObj = {};
    for (const [mb, box] of this.envelopes.entries()) {
      envelopesObj[mb] = [...box.values()];
    }
    return {
      meta: this.meta,
      users: [...this.users.values()],
      opks: Object.fromEntries(this.opks),
      envelopes: envelopesObj,
      asks: Object.fromEntries(this.asks),
      rooms: [...this.rooms.values()],
      sessions: Object.fromEntries(this.sessions),
      blobs: [...this.blobs.values()],
      invites: [...this.invites.values()],
    };
  }

  compactSync() {
    const json = JSON.stringify(this.serializeState());
    const tmp = `${this.snapshotPath}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, json, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, this.snapshotPath);

    if (this._walFd !== null) {
      fs.closeSync(this._walFd);
      fs.writeFileSync(this.walPath, '');
      this._walFd = fs.openSync(this.walPath, 'a');
      this._walOps = 0;
    }

    if (this.s3?.enabled) {
      clearTimeout(this._s3SyncTimer);
      this._s3SyncTimer = setTimeout(() => {
        this.s3.pushSnapshot(json).catch(() => {});
      }, 1500);
      this._s3SyncTimer.unref?.();
    }
  }

  async close() {
    clearInterval(this._gcInterval);
    clearTimeout(this._s3SyncTimer);
    this.compactSync();
    if (this.s3?.enabled) {
      await this.s3.pushSnapshot(JSON.stringify(this.serializeState()));
    }
    if (this._walFd !== null) {
      fs.closeSync(this._walFd);
      this._walFd = null;
    }
  }

  // ─────────────────────── Внутренний WAL-движок ───────────────────────

  _appendOp(op) {
    this._applyOp(op);
    if (this._walFd !== null) {
      const line = JSON.stringify(op);
      const mac = sha256B64(line).slice(0, 12);
      fs.writeSync(this._walFd, `${mac}\t${line}\n`);
      this._walOps += 1;
      if (this._walOps >= this.compactEveryOps) {
        this.compactSync();
      }
    }
  }

  _replayWal() {
    const content = fs.readFileSync(this.walPath, 'utf8');
    for (const rawLine of content.split('\n')) {
      if (!rawLine) continue;
      const tab = rawLine.indexOf('\t');
      if (tab < 0) continue;
      const mac = rawLine.slice(0, tab);
      const json = rawLine.slice(tab + 1);
      if (sha256B64(json).slice(0, 12) !== mac) continue; // Отбрасываем оборванный при сбое питания хвост
      try {
        this._applyOp(JSON.parse(json));
      } catch { /* ignore */ }
    }
  }

  _hydrateSnapshot(snap) {
    if (!snap) return;
    if (snap.meta) this.meta = { ...this.meta, ...snap.meta };
    for (const u of snap.users || []) {
      this.users.set(u.id, u);
      this.userByUsername.set(u.username, u.id);
      this.userByMailbox.set(u.mailboxId, u.id);
    }
    for (const [uid, list] of Object.entries(snap.opks || {})) {
      this.opks.set(uid, list);
    }
    for (const [mb, list] of Object.entries(snap.envelopes || {})) {
      const m = new Map();
      for (const e of list) m.set(e.id, e);
      this.envelopes.set(mb, m);
    }
    for (const [mb, list] of Object.entries(snap.asks || {})) {
      this.asks.set(mb, list);
    }
    for (const r of snap.rooms || []) {
      this.rooms.set(r.id, r);
    }
    for (const [th, s] of Object.entries(snap.sessions || {})) {
      this.sessions.set(th, s);
    }
    for (const b of snap.blobs || []) {
      this.blobs.set(b.id, b);
    }
    for (const inv of snap.invites || []) {
      this.invites.set(inv.inviteHash, inv);
    }
  }

  _applyOp(op) {
    switch (op.type) {
      case 'user.put': {
        const u = op.record;
        this.users.set(u.id, u);
        this.userByUsername.set(u.username, u.id);
        this.userByMailbox.set(u.mailboxId, u.id);
        this.opks.set(u.id, op.opkList || []);
        break;
      }
      case 'opk.pop': {
        const list = this.opks.get(op.userId) || [];
        this.opks.set(op.userId, list.filter((x) => x.keyId !== op.keyId));
        break;
      }
      case 'opk.push': {
        const list = this.opks.get(op.userId) || [];
        const existingIds = new Set(list.map((x) => x.keyId));
        for (const item of op.items) {
          if (!existingIds.has(item.keyId)) list.push(item);
        }
        this.opks.set(op.userId, list.slice(-300));
        break;
      }
      case 'user.spk': {
        const u = this.users.get(op.userId);
        if (u) u.signedPreKey = op.signedPreKey;
        break;
      }
      case 'user.mailbox': {
        const u = this.users.get(op.userId);
        if (u) {
          this.userByMailbox.delete(u.mailboxId);
          this.envelopes.delete(u.mailboxId);
          u.mailboxId = op.mailboxId;
          u.mailboxWriteToken = op.mailboxWriteToken;
          u.mailboxWriteHash = op.mailboxWriteHash;
          this.userByMailbox.set(op.mailboxId, u.id);
        }
        break;
      }
      case 'user.recovery': {
        const u = this.users.get(op.userId);
        if (u) u.encryptedRecovery = op.encryptedRecovery;
        break;
      }
      case 'user.del': {
        const u = this.users.get(op.userId);
        if (u) {
          this.userByUsername.delete(u.username);
          this.userByMailbox.delete(u.mailboxId);
          this.envelopes.delete(u.mailboxId);
          this.asks.delete(u.mailboxId);
          this.opks.delete(u.id);
          this.users.delete(u.id);
          for (const [th, s] of this.sessions.entries()) {
            if (s.userId === u.id) this.sessions.delete(th);
          }
        }
        break;
      }
      case 'session.put':
        this.sessions.set(op.tokenHash, { userId: op.userId, expiresAt: op.expiresAt });
        break;
      case 'session.del':
        this.sessions.delete(op.tokenHash);
        break;
      case 'env.put': {
        const { item } = op;
        let box = this.envelopes.get(item.mailboxId);
        if (!box) {
          box = new Map();
          this.envelopes.set(item.mailboxId, box);
        }
        box.set(item.id, item);
        break;
      }
      case 'env.ack': {
        const box = this.envelopes.get(op.mailboxId);
        if (box) {
          for (const id of op.ids) box.delete(id);
          if (box.size === 0) this.envelopes.delete(op.mailboxId);
        }
        break;
      }
      case 'room.create':
        this.rooms.set(op.room.id, op.room);
        break;
      case 'room.post': {
        const r = this.rooms.get(op.roomId);
        if (r) {
          r.seq = op.entry.seq;
          r.items.push(op.entry);
          if (r.items.length > 500) r.items.splice(0, r.items.length - 500);
        }
        break;
      }
      case 'ask.put': {
        const arr = this.asks.get(op.mailboxId) || [];
        arr.push(op.ask);
        if (arr.length > 200) arr.splice(0, arr.length - 200);
        this.asks.set(op.mailboxId, arr);
        break;
      }
      case 'ask.ack': {
        const arr = this.asks.get(op.mailboxId);
        if (arr) {
          this.asks.set(op.mailboxId, arr.filter((x) => x.id !== op.askId));
        }
        break;
      }
      case 'ask.block': {
        const u = this.users.get(op.userId);
        if (u && !u.blockedAskTags.includes(op.senderBlockTag)) {
          u.blockedAskTags.push(op.senderBlockTag);
          if (u.blockedAskTags.length > 500) u.blockedAskTags.shift();
        }
        break;
      }
      case 'blob.put':
        this.blobs.set(op.record.id, op.record);
        break;
      case 'blob.del':
        this.blobs.delete(op.blobId);
        break;
      case 'invite.put':
        this.invites.set(op.record.inviteHash, op.record);
        break;
      case 'invite.use': {
        const inv = this.invites.get(op.inviteHash);
        if (inv) {
          inv.used += 1;
          if (inv.used >= inv.maxUses) this.invites.delete(op.inviteHash);
        }
        break;
      }
    }
  }
}
