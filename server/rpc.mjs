// Слепой бинарный RPC-маршрутизатор и real-time коммутатор почтовых ящиков.
// Архитектурный инвариант: обработчики доставки (relay.drop, webrtc.signal, ask.send)
// работают по обезличенному адресу ящика mailboxId + доказательству writeToken и НЕ связывают
// отправителя с получателем даже в оперативной памяти.

import crypto from 'node:crypto';
import {
  FRAME_TYPE,
  encodeFrame,
  decodeFrame,
} from '../shared/codec/binary-frame.mjs';
import { fromBase64Url } from '../shared/crypto/primitives.mjs';
import { assertPublic, PublicError } from './privacy-gate.mjs';
import { sha256B64 } from './storage.mjs';

function verifyWriteProof(expectedWriteToken, payloadBytes, providedProof) {
  if (!expectedWriteToken || typeof providedProof !== 'string') return false;
  const expectedMac = crypto
    .createHmac('sha256', expectedWriteToken)
    .update(payloadBytes)
    .digest('base64url');
  const a = Buffer.from(expectedMac);
  const b = Buffer.from(providedProof);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export class BlindRpcRouter {
  constructor({ storage, auth, privacyGate }) {
    this.storage = storage;
    this.auth = auth;
    this.gate = privacyGate;

    // Активные подписки в RAM (не пишутся на диск):
    // mailboxId -> Set<ServerWsConnection>
    this.mailboxSubscribers = new Map();
    // roomId -> Set<ServerWsConnection>
    this.roomSubscribers = new Map();
  }

  /** Подключает обработчики жизненного цикла к новому WebSocket-соединению */
  bindConnection(conn, req) {
    const reqCtx = this.gate.inspectRequest(req);
    conn.context = {
      reqCtx,
      userId: null,
      mailboxId: null,
      rooms: new Set(),
    };

    conn.on('message', async (rawData, isBinary) => {
      if (!isBinary) {
        conn.close(1003, 'binary_frames_only');
        return;
      }

      let frame;
      try {
        frame = decodeFrame(rawData);
      } catch {
        conn.close(1002, 'malformed_frame');
        return;
      }

      // Прикладной PING для замера RTT клиентом
      if (frame.type === FRAME_TYPE.PING) {
        conn.sendBinary(encodeFrame({ type: FRAME_TYPE.PONG, id: frame.id, meta: frame.meta }));
        return;
      }
      // Шумовой cover-трафик молча поглощается
      if (frame.type === FRAME_TYPE.COVER || frame.type === FRAME_TYPE.PONG) {
        return;
      }
      if (frame.type !== FRAME_TYPE.RPC_REQ) {
        return;
      }

      const method = String(frame.meta?.m || '');
      const params = frame.meta?.p || {};

      try {
        this.gate.enforceLimit('ws-rpc', reqCtx.clientTag, 240, 10_000);
        const out = await this._dispatch(conn, method, params, frame.body);
        const resBody = out?.__binaryBody instanceof Uint8Array ? out.__binaryBody : null;
        const resData = out?.__binaryBody !== undefined ? out.data : out;

        conn.sendBinary(
          encodeFrame({
            type: FRAME_TYPE.RPC_RES,
            id: frame.id,
            meta: { ok: true, r: resData },
            body: resBody,
          })
        );
      } catch (err) {
        const message = err instanceof PublicError
          ? err.message
          : 'Ошибка обработки запроса';
        conn.sendBinary(
          encodeFrame({
            type: FRAME_TYPE.RPC_RES,
            id: frame.id,
            meta: { ok: false, e: message },
          })
        );
      }
    });

    conn.on('close', () => this._cleanupConn(conn));
  }

  /** Отправка события в реальном времени всем подключённым устройствам данного почтового ящика */
  pushToMailbox(mailboxId, eventName, data, binaryBody = null) {
    const subs = this.mailboxSubscribers.get(mailboxId);
    if (!subs || subs.size === 0) return 0;
    const frame = encodeFrame({
      type: FRAME_TYPE.EVENT,
      id: 0,
      meta: { ev: eventName, d: data },
      body: binaryBody,
    });
    let delivered = 0;
    for (const c of subs) {
      if (c.sendBinary(frame)) delivered += 1;
    }
    return delivered;
  }

  /** Рассылка зашифрованного пакета подписчикам комнаты/канала */
  pushToRoom(roomId, eventName, data, binaryBody = null, excludeConn = null) {
    const subs = this.roomSubscribers.get(roomId);
    if (!subs || subs.size === 0) return 0;
    const frame = encodeFrame({
      type: FRAME_TYPE.EVENT,
      id: 0,
      meta: { ev: eventName, d: data },
      body: binaryBody,
    });
    let count = 0;
    for (const c of subs) {
      if (c !== excludeConn && c.sendBinary(frame)) count += 1;
    }
    return count;
  }

  async _dispatch(conn, method, p, body) {
    const { reqCtx } = conn.context;

    switch (method) {
      // ───── 1. Публичные / Слепые методы (НЕ требуют и НЕ читают сессию отправителя!) ─────

      case 'auth.pow':
        return this.auth.requestPow(p.purpose, reqCtx);

      case 'auth.register': {
        const reg = await this.auth.register(p, reqCtx);
        this._bindSessionToConn(conn, reg.userId, reg.mailboxId);
        return reg;
      }

      case 'auth.challenge':
        return this.auth.issueLoginChallenge(p, reqCtx);

      case 'auth.login': {
        const res = await this.auth.verifyLogin(p, reqCtx);
        this._bindSessionToConn(conn, res.userId, res.mailboxId);
        return {
          ...res,
          remainingOpks: this.storage.countRemainingOpks(res.userId),
        };
      }

      case 'relay.drop': {
        // Слепая доставка конверта Sealed Sender в чужой почтовый ящик
        this.gate.enforceLimit('relay-drop', reqCtx.clientTag, 90, 60_000);
        const mailboxId = String(p.mailboxId || '');
        assertPublic(body && body.byteLength >= 128 && body.byteLength <= 512 * 1024, 'Недопустимый размер конверта');

        const recipient = this.storage.getUserByMailbox(mailboxId);
        assertPublic(recipient, 'Почтовый ящик получателя не найден', 404);
        assertPublic(
          verifyWriteProof(recipient.mailboxWriteToken, body, p.writeProof),
          'Недействительный токен доставки почтового ящика',
          403
        );

        const queued = this.storage.enqueueEnvelope({
          mailboxId,
          sealedBytes: body,
          ttlSec: p.ttlSec,
        });

        // Мгновенно пушим конверт получателю, если он сейчас онлайн
        this.pushToMailbox(mailboxId, 'mailbox.envelope', { id: queued.id, expiresAt: queued.expiresAt }, body);
        return { id: queued.id, expiresAt: queued.expiresAt };
      }

      case 'webrtc.signal': {
        // Слепой эфемерный P2P-сигналинг (живёт ТОЛЬКО в RAM, на диск никогда не пишется!)
        this.gate.enforceLimit('rtc-sig', reqCtx.clientTag, 360, 60_000);
        const mailboxId = String(p.mailboxId || '');
        assertPublic(body && body.byteLength >= 32 && body.byteLength <= 65536, 'Некорректный пакет сигналинга');
        const recipient = this.storage.getUserByMailbox(mailboxId);
        assertPublic(recipient, 'Адресат недоступен', 404);
        assertPublic(
          verifyWriteProof(recipient.mailboxWriteToken, body, p.writeProof),
          'Недействительный токен сигналинга',
          403
        );
        const onlineCount = this.pushToMailbox(mailboxId, 'webrtc.signal', { ts: Date.now() }, body);
        return { relayed: onlineCount > 0 };
      }

      case 'voice.frame': {
        // Слепой бинарный E2EE-ретранслятор аудиокадров для сетей с жёстким Symmetric CGNAT (4G/LTE).
        // Пакеты шифруются сквозным ключом звонка AES-256-GCM на клиентах и никогда не сохраняются на диск.
        this.gate.enforceLimit('voice-rt', reqCtx.clientTag, 1800, 60_000);
        const mailboxId = String(p.mailboxId || '');
        assertPublic(body && body.byteLength >= 36 && body.byteLength <= 16384, 'Некорректный аудиокадр');
        const recipient = this.storage.getUserByMailbox(mailboxId);
        assertPublic(recipient, 'Адресат недоступен', 404);
        assertPublic(
          verifyWriteProof(recipient.mailboxWriteToken, body, p.writeProof),
          'Недействительный токен голосового канала',
          403
        );
        const onlineCount = this.pushToMailbox(mailboxId, 'voice.frame', { ts: Date.now() }, body);
        return { relayed: onlineCount > 0 };
      }

      case 'ask.info': {
        this.gate.enforceLimit('ask-info', reqCtx.clientTag, 60, 60_000);
        const uname = String(p.username || '').trim().replace(/^@/, '').toLowerCase();
        const target = this.storage.getUserByUsername(uname);
        assertPublic(target && target.askEnabled, 'Пользователь не принимает анонимные вопросы', 404);
        return {
          username: target.username,
          mailboxId: target.mailboxId,
          ikDhPub: target.identity.ikDhPub,
        };
      }

      case 'ask.send': {
        this.gate.enforceLimit('ask-send', reqCtx.clientTag, 8, 10 * 60_000);
        this.gate.verifyPowSolution(p.powChallenge, p.powNonce, 'ask');
        const target = this.storage.getUserByMailbox(String(p.mailboxId || ''));
        assertPublic(target && target.askEnabled, 'Пользователь не принимает анонимные вопросы', 404);
        assertPublic(typeof p.payloadB64 === 'string' && p.payloadB64.length <= 8192, 'Некорректный шифртекст вопроса');

        const senderBlockTag = reqCtx.deriveSenderBlockTag(target.askSalt);
        const res = this.storage.enqueueAnonymousAsk({
          mailboxId: target.mailboxId,
          payloadB64: p.payloadB64,
          senderBlockTag,
        });
        if (!res.shadowed) {
          this.pushToMailbox(target.mailboxId, 'ask.new', {
            id: res.id,
            payloadB64: p.payloadB64,
            senderBlockTag,
          });
        }
        return { ok: true };
      }

      // ───── 2. Авторизация внутри установленного шифрованного транспорта ─────

      case 'session.auth': {
        const verified = this.storage.verifySessionToken(p.token);
        if (!verified) throw new PublicError('Сессия недействительна или истекла', 401);
        this._bindSessionToConn(conn, verified.user.id, verified.user.mailboxId);
        return {
          userId: verified.user.id,
          username: verified.user.username,
          mailboxId: verified.user.mailboxId,
          mailboxWriteToken: verified.user.mailboxWriteToken,
          remainingOpks: this.storage.countRemainingOpks(verified.user.id),
        };
      }

      // ───── 3. Методы владельца почтового ящика ─────

      case 'directory.bundle': {
        this._requireSession(conn);
        this.gate.enforceLimit('dir-lookup', reqCtx.clientTag, 40, 60_000);
        const bundle = this.storage.consumePreKeyBundle(p.query);
        assertPublic(bundle, 'Пользователь не найден', 404);
        // Оповещаем владельца Боба, если его запас одноразовых ключей OPK опустился ниже 20
        const left = this.storage.countRemainingOpks(bundle.userId);
        if (left < 20) {
          this.pushToMailbox(bundle.mailboxId, 'keys.lowOpk', { remaining: left });
        }
        return bundle;
      }

      case 'mailbox.pull': {
        const user = this._requireSession(conn);
        const items = this.storage.pullEnvelopes(user.mailboxId, Number(p.limit) || 100);
        const asks = this.storage.pullAnonymousAsks(user.mailboxId);
        return { envelopes: items, asks };
      }

      case 'mailbox.ack': {
        const user = this._requireSession(conn);
        const deleted = this.storage.ackEnvelopes(user.mailboxId, p.ids || []);
        if (Array.isArray(p.askIds)) {
          for (const aid of p.askIds) this.storage.ackAnonymousAsk(user.mailboxId, aid);
        }
        return { deleted };
      }

      case 'mailbox.rotate': {
        const user = this._requireSession(conn);
        const oldMb = user.mailboxId;
        const newMb = `mb_${crypto.randomBytes(16).toString('base64url')}`;
        const newWt = crypto.randomBytes(24).toString('base64url');
        const rotated = this.storage.rotateMailbox(user.id, newMb, newWt);
        this._rebindMailbox(conn, oldMb, newMb);
        return rotated;
      }

      case 'keys.replenishOpk': {
        const user = this._requireSession(conn);
        const total = this.storage.replenishOpks(user.id, p.oneTimePreKeys || []);
        return { remainingOpks: total };
      }

      case 'keys.rotateSpk': {
        const user = this._requireSession(conn);
        assertPublic(p.signedPreKey?.keyId && p.signedPreKey?.pub && p.signedPreKey?.sig, 'Некорректный SignedPreKey');
        this.storage.updateSignedPreKey(user.id, p.signedPreKey);
        return { ok: true };
      }

      case 'turn.credentials': {
        this._requireSession(conn);
        return this.auth.issueEphemeralTurnCredentials();
      }

      case 'ask.block': {
        const user = this._requireSession(conn);
        this.storage.blockAnonymousSender(user.id, p.senderBlockTag);
        return { blocked: true };
      }

      case 'room.create': {
        this._requireSession(conn);
        const roomId = `rm_${crypto.randomBytes(12).toString('base64url')}`;
        const writeToken = crypto.randomBytes(24).toString('base64url');
        this.storage.createRoom({
          roomId,
          verifyPubB64: String(p.verifyPubB64 || ''),
          encryptedMetaB64: String(p.encryptedMetaB64 || ''),
          writeTokenHash: sha256B64(writeToken),
        });
        this._subscribeRoom(conn, roomId);
        return { roomId, writeToken };
      }

      case 'room.subscribe': {
        this._requireSession(conn);
        const hist = this.storage.getRoomHistory(String(p.roomId || ''), Number(p.afterSeq || 0), 100);
        assertPublic(hist, 'Канал не найден', 404);
        this._subscribeRoom(conn, hist.id);
        return hist;
      }

      case 'room.post': {
        this.gate.enforceLimit('room-post', reqCtx.clientTag, 60, 60_000);
        const room = this.storage.rooms.get(String(p.roomId || ''));
        assertPublic(room, 'Канал не найден', 404);
        assertPublic(
          sha256B64(String(p.writeToken || '')) === room.writeTokenHash,
          'Нет прав публикации в этот канал',
          403
        );
        const blobB64 = body?.byteLength
          ? Buffer.from(body).toString('base64url')
          : String(p.encryptedBlobB64 || '');
        assertPublic(blobB64.length >= 32 && blobB64.length <= 512 * 1024, 'Недопустимый размер сообщения канала');

        const entry = this.storage.appendRoomEnvelope({
          roomId: room.id,
          encryptedBlobB64: blobB64,
          ttlSec: p.ttlSec,
        });
        this.pushToRoom(room.id, 'room.message', { roomId: room.id, seq: entry.seq, id: entry.id }, fromBase64Url(blobB64));
        return { seq: entry.seq, id: entry.id };
      }

      case 'account.saveRecovery': {
        const user = this._requireSession(conn);
        this.storage.saveRecoveryBlob(user.id, p.encryptedRecovery || null);
        return { ok: true };
      }

      case 'account.delete': {
        const user = this._requireSession(conn);
        this.storage.deleteAccountCompletely(user.id);
        conn.close(1000, 'account_deleted');
        return { deleted: true };
      }

      default:
        throw new PublicError(`Неизвестный RPC-метод: ${method}`, 404);
    }
  }

  _requireSession(conn) {
    const uid = conn.context?.userId;
    const user = uid ? this.storage.getUserById(uid) : null;
    if (!user) throw new PublicError('Требуется авторизация сессии (session.auth)', 401);
    return user;
  }

  _bindSessionToConn(conn, userId, mailboxId) {
    if (conn.context.mailboxId) {
      this.mailboxSubscribers.get(conn.context.mailboxId)?.delete(conn);
    }
    conn.context.userId = userId;
    conn.context.mailboxId = mailboxId;
    if (!this.mailboxSubscribers.has(mailboxId)) {
      this.mailboxSubscribers.set(mailboxId, new Set());
    }
    this.mailboxSubscribers.get(mailboxId).add(conn);
  }

  _rebindMailbox(conn, oldMb, newMb) {
    this.mailboxSubscribers.get(oldMb)?.delete(conn);
    conn.context.mailboxId = newMb;
    if (!this.mailboxSubscribers.has(newMb)) {
      this.mailboxSubscribers.set(newMb, new Set());
    }
    this.mailboxSubscribers.get(newMb).add(conn);
  }

  _subscribeRoom(conn, roomId) {
    conn.context.rooms.add(roomId);
    if (!this.roomSubscribers.has(roomId)) {
      this.roomSubscribers.set(roomId, new Set());
    }
    this.roomSubscribers.get(roomId).add(conn);
  }

  _cleanupConn(conn) {
    const mb = conn.context?.mailboxId;
    if (mb) {
      const set = this.mailboxSubscribers.get(mb);
      if (set) {
        set.delete(conn);
        if (set.size === 0) this.mailboxSubscribers.delete(mb);
      }
    }
    for (const rid of conn.context?.rooms || []) {
      const rset = this.roomSubscribers.get(rid);
      if (rset) {
        rset.delete(conn);
        if (rset.size === 0) this.roomSubscribers.delete(rid);
      }
    }
  }
}
