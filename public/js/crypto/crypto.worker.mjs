// Изолированный Web Worker для всех криптографических операций.
// UI-поток общается с ним только высокоуровневыми командами и никогда не имеет доступа
// ни к приватным CryptoKey, ни к цепочкам ключей Double Ratchet.

import {
  utf8ToBytes,
  bytesToUtf8,
  toBase64Url,
  fromBase64Url,
  wipe,
} from '../../../shared/crypto/primitives.mjs';
import {
  deriveAccountKeys,
  computeAuthChallengeProof,
  createZkAuthRegistration,
  signZkLoginChallenge,
  solveProofOfWork,
  generateRecoveryKey,
  encryptRecoveryBundle,
  decryptRecoveryBundle,
} from '../../../shared/crypto/kdf.mjs';
import {
  generateIdentity,
  restoreIdentityFromRecovery,
  generateSignedPreKey,
  generateOneTimePreKeys,
  x3dhInitiate,
  x3dhRespond,
} from '../../../shared/crypto/x3dh.mjs';
import { DoubleRatchetSession } from '../../../shared/crypto/double-ratchet.mjs';
import {
  sealSenderEnvelope,
  unsealSenderEnvelope,
  encryptFileForUpload,
  decryptDownloadedFile,
  encryptAnonymousQuestion,
  decryptAnonymousQuestion,
} from '../../../shared/crypto/sealed-sender.mjs';
import { computeSafetyNumber } from '../../../shared/crypto/safety-number.mjs';
import { CryptoKeyStore } from './keystore-idb.mjs';

export class CryptoEngine {
  constructor(store = new CryptoKeyStore()) {
    this.store = store;
    this.sessions = new Map(); // peerId -> DoubleRatchetSession (кеш в RAM воркера)
    this.identity = null;      // { userId, publicIdentity, privateKeys: { ikSignPriv, ikDhPriv } }
  }

  async init() {
    await this.store.open();
    const pub = await this.store.getEncryptedRecord('me:publicIdentity');
    if (pub) {
      const ikSignPriv = await this.store.getNativeKey('me:ikSignPriv');
      const ikDhPriv = await this.store.getNativeKey('me:ikDhPriv');
      if (ikSignPriv && ikDhPriv) {
        this.identity = {
          userId: pub.userId,
          publicIdentity: pub,
          privateKeys: { ikSignPriv, ikDhPriv },
        };
      }
    }
    return { hasIdentity: Boolean(this.identity), publicIdentity: this.identity?.publicIdentity || null };
  }

  /** Вычисление Zero-Knowledge верификатора для регистрации или ответа на challenge входа */
  async deriveAuthMaterial({ username, password, challengeB64 = null, algorithm = 'auto' }) {
    const { authKey, localWrapKey, kdfInfo } = await deriveAccountKeys(username, password, { algorithm });
    try {
      const result = {
        kdfInfo,
        authKeyB64: challengeB64 ? undefined : toBase64Url(authKey),
        challengeProof: challengeB64
          ? await computeAuthChallengeProof(authKey, challengeB64, username)
          : undefined,
      };
      return result;
    } finally {
      wipe(authKey);
      wipe(localWrapKey);
    }
  }

  /** Подготовка асимметричной Zero-Knowledge регистрации (пароль не покидает воркер) */
  async prepareZkRegistration({ username, password, algorithm = 'auto' }) {
    return createZkAuthRegistration(username, password, { algorithm });
  }

  /** Подпись серверного challenge при входе (пароль не покидает воркер) */
  async solveZkLogin({ username, password, encryptedAuthKey, challengeNonce, algorithm = 'auto' }) {
    return signZkLoginChallenge({
      username,
      password,
      encryptedAuthKey,
      challengeNonce,
      options: { algorithm },
    });
  }

  /** Решение анти-спам задачи Proof-of-Work в фоновом потоке */
  async solvePow({ challengeToken, difficultyBits }) {
    return solveProofOfWork(challengeToken, difficultyBits);
  }

  /** Генерация полного комплекта ключей устройства при регистрации (Identity + SPK + OPKs) */
  async provisionIdentity({ userId, opkCount = 50, createRecoveryKit = true }) {
    await this.store.open();
    const generated = await generateIdentity(userId, { exportForRecovery: createRecoveryKit });

    await this.store.putNativeKey('me:ikSignPriv', generated.privateKeys.ikSignPriv);
    await this.store.putNativeKey('me:ikDhPriv', generated.privateKeys.ikDhPriv);
    await this.store.putEncryptedRecord('me:publicIdentity', generated.publicIdentity);

    this.identity = {
      userId,
      publicIdentity: generated.publicIdentity,
      privateKeys: generated.privateKeys,
    };

    // Генерируем стартовый SignedPreKey #1 и пачку One-Time PreKeys
    const spk = await generateSignedPreKey(generated.privateKeys.ikSignPriv, 1, { extractable: false });
    await this.store.putNativeKey(`spk:${spk.keyId}`, spk.privateKey);
    await this.store.putEncryptedRecord(`spkMeta:${spk.keyId}`, {
      keyId: spk.keyId,
      pubRawB64: toBase64Url(spk.publicKeyRaw),
      publicPreKey: spk.publicPreKey,
    });
    await this.store.putEncryptedRecord('me:counters', { nextSpkId: 2, nextOpkId: 1 + opkCount });

    const opks = await generateOneTimePreKeys(1, opkCount, { extractable: false });
    for (const item of opks) {
      await this.store.putNativeKey(`opk:${item.keyId}`, item.privateKey);
    }

    let recoveryKit = null;
    if (createRecoveryKit && generated.recoveryMaterial) {
      const recoveryKey = generateRecoveryKey();
      const encryptedBackup = await encryptRecoveryBundle(generated.recoveryMaterial, recoveryKey);
      recoveryKit = { recoveryKey, encryptedBackup };
    }

    return {
      publicBundle: {
        identity: generated.publicIdentity,
        signedPreKey: spk.publicPreKey,
        oneTimePreKeys: opks.map(o => o.publicPreKey),
      },
      recoveryKit,
    };
  }

  /** Восстановление ключей личности на новом устройстве по фразе/ключу восстановления */
  async importRecoveryKit({ encryptedBackup, recoveryKey, opkCount = 50 }) {
    const material = await decryptRecoveryBundle(encryptedBackup, recoveryKey);
    const restored = await restoreIdentityFromRecovery(material);

    await this.store.putNativeKey('me:ikSignPriv', restored.privateKeys.ikSignPriv);
    await this.store.putNativeKey('me:ikDhPriv', restored.privateKeys.ikDhPriv);
    await this.store.putEncryptedRecord('me:publicIdentity', restored.publicIdentity);
    this.identity = restored;

    const spkId = Math.floor(Date.now() / 1000);
    const spk = await generateSignedPreKey(restored.privateKeys.ikSignPriv, spkId, { extractable: false });
    await this.store.putNativeKey(`spk:${spk.keyId}`, spk.privateKey);
    await this.store.putEncryptedRecord(`spkMeta:${spk.keyId}`, {
      keyId: spk.keyId,
      pubRawB64: toBase64Url(spk.publicKeyRaw),
      publicPreKey: spk.publicPreKey,
    });
    const opks = await generateOneTimePreKeys(1, opkCount, { extractable: false });
    for (const item of opks) {
      await this.store.putNativeKey(`opk:${item.keyId}`, item.privateKey);
    }

    return {
      publicBundle: {
        identity: restored.publicIdentity,
        signedPreKey: spk.publicPreKey,
        oneTimePreKeys: opks.map(o => o.publicPreKey),
      },
    };
  }

  /** Пополнение пачки одноразовых ключей (вызывается автоматически, когда на сервере осталось < 20 OPK) */
  async replenishOneTimePreKeys({ count = 50 } = {}) {
    this._requireIdentity();
    const counters = (await this.store.getEncryptedRecord('me:counters')) || { nextSpkId: 2, nextOpkId: 100 };
    const opks = await generateOneTimePreKeys(counters.nextOpkId, count, { extractable: false });
    for (const item of opks) {
      await this.store.putNativeKey(`opk:${item.keyId}`, item.privateKey);
    }
    counters.nextOpkId += count;
    await this.store.putEncryptedRecord('me:counters', counters);
    return opks.map(o => o.publicPreKey);
  }

  /** Установка исходящей сессии X3DH + Double Ratchet по PreKeyBundle собеседника */
  async establishOutgoingSession({ peerBundle }) {
    this._requireIdentity();
    const peerId = peerBundle.identity.userId;
    const x3dh = await x3dhInitiate({
      aliceIdentity: this.identity.publicIdentity,
      alicePrivateKeys: this.identity.privateKeys,
      bobPreKeyBundle: peerBundle,
    });
    const session = await DoubleRatchetSession.initAsInitiator({
      sharedSecret: x3dh.sharedSecret,
      associatedData: x3dh.associatedData,
      remoteRatchetPubRaw: x3dh.remoteRatchetPubRaw,
    });
    this.sessions.set(peerId, session);
    await this._persistSession(peerId, session, {
      peerIdentity: peerBundle.identity,
      pendingHandshake: x3dh.handshake,
    });
    return { peerId, safetyNumber: await computeSafetyNumber(this.identity.publicIdentity, peerBundle.identity) };
  }

  /** Шифрование сообщения для собеседника и упаковка в анонимный конверт Sealed Sender */
  async encryptMessageForPeer({ peerId, payloadObject }) {
    this._requireIdentity();
    const meta = await this.store.getEncryptedRecord(`peerMeta:${peerId}`);
    if (!meta || !meta.peerIdentity) {
      throw new Error(`Нет установленной криптосессии с пользователем ${peerId}`);
    }
    const session = await this._loadSession(peerId);
    const ratchetPacket = await session.encrypt(utf8ToBytes(JSON.stringify(payloadObject)));

    const innerObject = {
      dr: ratchetPacket,
      x3dh: meta.pendingHandshake || undefined,
    };
    await this._persistSession(peerId, session, meta);

    const sealedBytes = await sealSenderEnvelope({
      recipientIkDhPubB64: meta.peerIdentity.ikDhPub,
      senderIdentity: this.identity.publicIdentity,
      innerObject,
    });
    return { sealedBytes };
  }

  /** Вскрытие входящего конверта Sealed Sender и расшифровка Double Ratchet (с автопринятием X3DH) */
  async decryptIncomingSealedEnvelope({ sealedBytes }) {
    this._requireIdentity();
    const unsealed = await unsealSenderEnvelope({
      recipientIkDhPriv: this.identity.privateKeys.ikDhPriv,
      recipientIkDhPubB64: this.identity.publicIdentity.ikDhPub,
      sealedBytes,
    });

    const peerIdentity = unsealed.sender;
    const peerId = peerIdentity.userId;
    const existingMeta = await this.store.getEncryptedRecord(`peerMeta:${peerId}`);

    // Защита от скрытой подмены ключа собеседника (Key Pinning / TOFU + предупреждение о смене)
    if (
      existingMeta?.peerIdentity &&
      (existingMeta.peerIdentity.ikSignPub !== peerIdentity.ikSignPub ||
        existingMeta.peerIdentity.ikDhPub !== peerIdentity.ikDhPub) &&
      !existingMeta.allowKeyChange
    ) {
      throw new Error(`ВНИМАНИЕ: изменился ключ безопасности пользователя ${peerId}! Сверьте код безопасности.`);
    }

    let session = await this._loadSession(peerId).catch(() => null);

    // Если в пакете есть заголовок X3DH и сессия ещё не создана (либо оба пира начали диалог одновременно —
    // детерминированно побеждает инициатор с лексикографически меньшим userId)
    const shouldAcceptHandshake =
      unsealed.body.x3dh &&
      (!session || (existingMeta?.pendingHandshake && peerId < this.identity.userId));

    if (shouldAcceptHandshake) {
      const hs = unsealed.body.x3dh;
      const spkPriv = await this.store.getNativeKey(`spk:${hs.spkId}`);
      const spkMeta = await this.store.getEncryptedRecord(`spkMeta:${hs.spkId}`);
      if (!spkPriv || !spkMeta) {
        throw new Error(`Не найден локальный SignedPreKey #${hs.spkId}`);
      }
      let opkObj = null;
      if (hs.opkId !== null && hs.opkId !== undefined) {
        const opkPriv = await this.store.getNativeKey(`opk:${hs.opkId}`);
        if (!opkPriv) throw new Error(`Одноразовый ключ OPK #${hs.opkId} уже использован или отсутствует`);
        opkObj = { keyId: hs.opkId, privateKey: opkPriv };
      }

      const x3dhOut = await x3dhRespond({
        bobIdentity: this.identity.publicIdentity,
        bobPrivateKeys: this.identity.privateKeys,
        bobSignedPreKey: { keyId: hs.spkId, privateKey: spkPriv },
        bobOneTimePreKey: opkObj,
        handshake: hs,
      });

      // Немедленно удаляем использованный одноразовый ключ OPK (Forward Secrecy рукопожатия!)
      if (opkObj) {
        await this.store.deleteNativeKey(`opk:${opkObj.keyId}`);
      }

      session = await DoubleRatchetSession.initAsResponder({
        sharedSecret: x3dhOut.sharedSecret,
        associatedData: x3dhOut.associatedData,
        localRatchetPrivateKey: spkPriv,
        localRatchetPubRaw: fromBase64Url(spkMeta.pubRawB64),
      });
    }

    if (!session) {
      throw new Error(`Сессия Double Ratchet с ${peerId} отсутствует и заголовок X3DH не передан`);
    }

    const plainBytes = await session.decrypt(unsealed.body.dr);
    const payload = JSON.parse(bytesToUtf8(plainBytes));
    wipe(plainBytes);

    // Как только мы получили ответ от собеседника, pendingHandshake больше не нужно дублировать
    const nextMeta = {
      peerIdentity,
      pendingHandshake: existingMeta?.pendingHandshake && !unsealed.body.x3dh ? null : null,
      verified: Boolean(existingMeta?.verified),
    };
    await this._persistSession(peerId, session, nextMeta);

    return {
      senderId: peerId,
      senderIdentity: peerIdentity,
      sentAt: unsealed.sentAt,
      payload,
    };
  }

  /** Вычисление кода безопасности (60 цифр + 8 эмодзи + QR) для чата с peerId */
  async getSafetyNumber({ peerId }) {
    this._requireIdentity();
    const meta = await this.store.getEncryptedRecord(`peerMeta:${peerId}`);
    if (!meta?.peerIdentity) throw new Error('Ключ собеседника не найден');
    return computeSafetyNumber(this.identity.publicIdentity, meta.peerIdentity);
  }

  /** Шифрование файла до загрузки на сервер */
  async encryptFile({ bytes, meta }) {
    return encryptFileForUpload(bytes, meta);
  }

  /** Расшифровка файла после скачивания с сервера */
  async decryptFile({ bytes, descriptor }) {
    return decryptDownloadedFile(bytes, descriptor);
  }

  /** Шифрование/расшифровка анонимного вопроса «Голой правды» */
  async encryptAsk({ recipientIkDhPubB64, text }) {
    return encryptAnonymousQuestion({ recipientIkDhPubB64, text });
  }

  async decryptAsk({ payloadB64 }) {
    this._requireIdentity();
    return decryptAnonymousQuestion({
      recipientIkDhPriv: this.identity.privateKeys.ikDhPriv,
      recipientIkDhPubB64: this.identity.publicIdentity.ikDhPub,
      payloadB64,
    });
  }

  /** Экстренный сброс расшифрованных сессий из оперативной памяти воркера («Прикрыться») */
  lockRamCache() {
    for (const s of this.sessions.values()) {
      if (s.rootKey) wipe(s.rootKey);
      if (s.sendChainKey) wipe(s.sendChainKey);
      if (s.recvChainKey) wipe(s.recvChainKey);
    }
    this.sessions.clear();
    return { locked: true };
  }

  _requireIdentity() {
    if (!this.identity) throw new Error('Ключи личности на этом устройстве ещё не инициализированы');
  }

  async _loadSession(peerId) {
    if (this.sessions.has(peerId)) return this.sessions.get(peerId);
    const saved = await this.store.getEncryptedRecord(`session:${peerId}`);
    if (!saved) throw new Error(`Сессия ${peerId} не найдена`);
    let fallbackKey = null;
    if (!saved.dhSendPkcs8 && saved.spkId) {
      fallbackKey = await this.store.getNativeKey(`spk:${saved.spkId}`);
    }
    const session = await DoubleRatchetSession.importState(saved, fallbackKey);
    this.sessions.set(peerId, session);
    return session;
  }

  async _persistSession(peerId, session, meta) {
    this.sessions.set(peerId, session);
    const state = await session.exportState();
    await this.store.putEncryptedRecord(`session:${peerId}`, state);
    if (meta) {
      await this.store.putEncryptedRecord(`peerMeta:${peerId}`, meta);
    }
  }
}

// ─────────────────────── Обработчик сообщений Web Worker в браузере ───────────────────────

const isBrowserWorker =
  typeof self !== 'undefined' &&
  typeof self.postMessage === 'function' &&
  typeof window === 'undefined';

if (isBrowserWorker) {
  const engine = new CryptoEngine();

  self.onmessage = async (event) => {
    const { id, method, params } = event.data || {};
    if (!id || typeof method !== 'string' || method.startsWith('_')) return;

    try {
      if (typeof engine[method] !== 'function') {
        throw new Error(`Неизвестный метод CryptoWorker: ${method}`);
      }
      const result = await engine[method](params || {});
      const transfer = [];
      if (result instanceof Uint8Array) {
        transfer.push(result.buffer);
      } else if (result && typeof result === 'object') {
        if (result.sealedBytes instanceof Uint8Array) transfer.push(result.sealedBytes.buffer);
        if (result.encryptedBytes instanceof Uint8Array) transfer.push(result.encryptedBytes.buffer);
      }
      self.postMessage({ id, ok: true, result }, transfer);
    } catch (err) {
      self.postMessage({ id, ok: false, error: err?.message || String(err) });
    }
  };
}
