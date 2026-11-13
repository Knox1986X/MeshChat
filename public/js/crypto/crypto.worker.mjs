// Изолированный Web Worker для всех криптографических операций.
// UI-поток общается с ним только высокоуровневыми командами и никогда не имеет доступа
// ни к приватным CryptoKey, ни к цепочкам ключей Double Ratchet.

import {
  utf8ToBytes,
  bytesToUtf8,
  randomBytes,
  toBase64Url,
  fromBase64Url,
  aesGcmEncrypt,
  aesGcmDecrypt,
  padPayload,
  unpadPayload,
  sha256,
  wipe,
} from '../../../shared/crypto/primitives.mjs';
import {
  deriveAccountKeys,
  computeAuthChallengeProof,
  createZkAuthRegistration,
  signZkLoginChallenge,
  signZkChallengeWithNativeKey,
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
    this.paddingBlockBytes = 512;
    this._mutex = Promise.resolve(); // Строгая FIFO-очередь для исключения гонок состояний храповика
  }

  /** Настройка криптопараметров времени выполнения (например, квант выравнивания ISO/IEC 7816-4) */
  setCryptoConfig({ paddingBlockBytes } = {}) {
    const q = Number(paddingBlockBytes);
    if ([256, 512, 1024, 2048, 4096].includes(q)) {
      this.paddingBlockBytes = q;
    }
    return { paddingBlockBytes: this.paddingBlockBytes };
  }

  /** Последовательное выполнение асинхронных операций с ключами и сессиями Double Ratchet */
  _runSerialized(fn) {
    const next = this._mutex.then(fn, fn);
    this._mutex = next.catch(() => {});
    return next;
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
    await this.store.open();
    const reg = await createZkAuthRegistration(username, password, { algorithm });
    if (reg.authPrivKey) {
      await this.store.putNativeKey('me:zkAuthPriv', reg.authPrivKey);
    }
    await this.store.putEncryptedRecord('me:zkTicket', {
      username: reg.username,
      authPubB64: reg.authPubB64,
      encryptedAuthKey: reg.encryptedAuthKey,
    });
    const { authPrivKey, ...safeResult } = reg;
    return safeResult;
  }

  /** Подпись серверного challenge при входе (пароль не покидает воркер) */
  async solveZkLogin({ username, password, encryptedAuthKey, challengeNonce, algorithm = 'auto' }) {
    await this.store.open();
    const res = await signZkLoginChallenge({
      username,
      password,
      encryptedAuthKey,
      challengeNonce,
      returnKeyPair: true,
      options: { algorithm },
    });
    if (res.authPrivKey) {
      await this.store.putNativeKey('me:zkAuthPriv', res.authPrivKey);
    }
    const prev = (await this.store.getEncryptedRecord('me:zkTicket')) || {};
    await this.store.putEncryptedRecord('me:zkTicket', {
      ...prev,
      username: String(username || '').trim().toLowerCase(),
      encryptedAuthKey,
    });
    return res.signatureB64;
  }

  /** Мгновенная подпись challenge неизвлекаемым ключом без повторного ввода пароля */
  async signStoredZkChallenge({ username, challengeNonce }) {
    await this.store.open();
    const authPriv = await this.store.getNativeKey('me:zkAuthPriv');
    if (!authPriv) {
      throw new Error('NO_STORED_ZK_KEY');
    }
    return signZkChallengeWithNativeKey(authPriv, username, challengeNonce);
  }

  /** Сохранение метаданных ZK-билета для прозрачного самовосстановления сессии на ретрансляторе */
  async saveZkMetadata({ username, authPubB64, encryptedAuthKey, encryptedRecovery }) {
    await this.store.open();
    const prev = (await this.store.getEncryptedRecord('me:zkTicket')) || {};
    await this.store.putEncryptedRecord('me:zkTicket', {
      username: username || prev.username || null,
      authPubB64: authPubB64 || prev.authPubB64 || null,
      encryptedAuthKey: encryptedAuthKey || prev.encryptedAuthKey || null,
      encryptedRecovery: encryptedRecovery !== undefined ? encryptedRecovery : (prev.encryptedRecovery || null),
    });
    return { saved: true };
  }

  /** Экспорт публичного комплекта для прозрачной перерегистрации на перезапущенном эфемерном ретрансляторе */
  async exportRelayRehydrationPackage({ opkCount = 30 } = {}) {
    return this._runSerialized(async () => {
      await this.init();
      this._requireIdentity();
      const ticket = await this.store.getEncryptedRecord('me:zkTicket');
      if (!ticket?.username || !ticket?.authPubB64 || !ticket?.encryptedAuthKey) {
        throw new Error('MISSING_ZK_REHYDRATION_TICKET');
      }
      const counters = (await this.store.getEncryptedRecord('me:counters')) || {
        nextSpkId: 2,
        nextOpkId: 200,
        activeSpkId: 1,
      };
      let spkMeta = counters.activeSpkId
        ? await this.store.getEncryptedRecord(`spkMeta:${counters.activeSpkId}`)
        : null;
      if (!spkMeta?.publicPreKey) {
        const spkId = counters.nextSpkId || Math.floor(Date.now() / 1000);
        const spk = await generateSignedPreKey(this.identity.privateKeys.ikSignPriv, spkId, { extractable: false });
        await this.store.putNativeKey(`spk:${spk.keyId}`, spk.privateKey);
        spkMeta = {
          keyId: spk.keyId,
          pubRawB64: toBase64Url(spk.publicKeyRaw),
          publicPreKey: spk.publicPreKey,
        };
        await this.store.putEncryptedRecord(`spkMeta:${spk.keyId}`, spkMeta);
        counters.activeSpkId = spk.keyId;
        counters.nextSpkId = spk.keyId + 1;
      }
      const startOpk = counters.nextOpkId || 200;
      const opks = await generateOneTimePreKeys(startOpk, opkCount, { extractable: false });
      for (const item of opks) {
        await this.store.putNativeKey(`opk:${item.keyId}`, item.privateKey);
      }
      counters.nextOpkId = startOpk + opkCount;
      await this.store.putEncryptedRecord('me:counters', counters);

      return {
        username: ticket.username,
        authPubB64: ticket.authPubB64,
        encryptedAuthKey: ticket.encryptedAuthKey,
        encryptedRecovery: ticket.encryptedRecovery || null,
        publicBundle: {
          identity: this.identity.publicIdentity,
          signedPreKey: spkMeta.publicPreKey,
          oneTimePreKeys: opks.map(o => o.publicPreKey),
        },
      };
    });
  }

  /** Локальный криптографический эхо-тест (AES-256-GCM + ISO/IEC 7816-4 выравнивание 512 Б + SHA-256) */
  async loopbackSelfTest({ text = 'MeshChat E2EE Loopback Test', paddingBlockBytes = 0 } = {}) {
    await this.store.open();
    const started = performance.now();
    const raw = utf8ToBytes(String(text));
    const padded = padPayload(raw, paddingBlockBytes || this.paddingBlockBytes || 512);
    const iv = randomBytes(12);
    const aad = utf8ToBytes('MESHCHAT-LOOPBACK-E2EE-v1');
    const ct = await aesGcmEncrypt(this.store._masterKey, iv, padded, aad);
    const digest = await sha256(ct);
    const hexPrefix = Array.from(digest.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const ptPadded = await aesGcmDecrypt(this.store._masterKey, iv, ct, aad);
    const unpadded = unpadPayload(ptPadded);
    const decoded = bytesToUtf8(unpadded);
    const elapsedMs = Math.max(1, Math.round((performance.now() - started) * 10) / 10);
    wipe(raw);
    wipe(padded);
    wipe(ptPadded);
    wipe(unpadded);
    return {
      ok: decoded === String(text),
      decryptedText: decoded,
      paddedBytes: ct.byteLength,
      sha256Prefix: hexPrefix,
      elapsedMs,
    };
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
    await this.store.putEncryptedRecord('me:counters', { nextSpkId: 2, nextOpkId: 1 + opkCount, activeSpkId: 1 });

    const opks = await generateOneTimePreKeys(1, opkCount, { extractable: false });
    for (const item of opks) {
      await this.store.putNativeKey(`opk:${item.keyId}`, item.privateKey);
    }

    let recoveryKit = null;
    if (createRecoveryKit && generated.recoveryMaterial) {
      const recoveryKey = generateRecoveryKey();
      const encryptedBackup = await encryptRecoveryBundle(generated.recoveryMaterial, recoveryKey);
      recoveryKit = { recoveryKey, encryptedBackup };
      const prevTicket = (await this.store.getEncryptedRecord('me:zkTicket')) || {};
      await this.store.putEncryptedRecord('me:zkTicket', {
        ...prevTicket,
        encryptedRecovery: encryptedBackup,
      });
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
    await this.store.putEncryptedRecord('me:counters', {
      nextSpkId: spkId + 1,
      nextOpkId: 1 + opkCount,
      activeSpkId: spk.keyId,
    });
    const prevTicket = (await this.store.getEncryptedRecord('me:zkTicket')) || {};
    await this.store.putEncryptedRecord('me:zkTicket', {
      ...prevTicket,
      encryptedRecovery: encryptedBackup,
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

  /** Проверка наличия готовой к отправке сессии Double Ratchet для указанного собеседника */
  async hasPeerSession({ peerId }) {
    return this._runSerialized(async () => {
      this._requireIdentity();
      const session = await this._loadSession(peerId).catch(() => null);
      const meta = await this.store.getEncryptedRecord(`peerMeta:${peerId}`);
      return {
        ready: Boolean(session && session.sendChainKey && meta?.peerIdentity),
        hasIdentity: Boolean(meta?.peerIdentity),
      };
    });
  }

  /** Сохранение публичного удостоверения собеседника (TOFU) без преждевременного запуска храповика */
  async savePeerIdentity({ peerIdentity }) {
    return this._runSerialized(async () => {
      this._requireIdentity();
      const peerId = peerIdentity.userId;
      const existingMeta = (await this.store.getEncryptedRecord(`peerMeta:${peerId}`)) || {};
      if (
        existingMeta.peerIdentity &&
        (existingMeta.peerIdentity.ikSignPub !== peerIdentity.ikSignPub ||
          existingMeta.peerIdentity.ikDhPub !== peerIdentity.ikDhPub) &&
        !existingMeta.allowKeyChange
      ) {
        throw new Error(`ВНИМАНИЕ: изменился публичный ключ собеседника ${peerId}. Сверьте отпечаток безопасности.`);
      }
      await this.store.putEncryptedRecord(`peerMeta:${peerId}`, {
        ...existingMeta,
        peerIdentity,
      });
      return {
        peerId,
        safetyNumber: await computeSafetyNumber(this.identity.publicIdentity, peerIdentity),
      };
    });
  }

  /** Установка исходящей сессии X3DH + Double Ratchet по PreKeyBundle собеседника */
  async establishOutgoingSession({ peerBundle, forceReset = false }) {
    return this._runSerialized(async () => {
      this._requireIdentity();
      const peerId = peerBundle.identity.userId;
      const existingMeta = await this.store.getEncryptedRecord(`peerMeta:${peerId}`);

      if (
        existingMeta?.peerIdentity &&
        (existingMeta.peerIdentity.ikSignPub !== peerBundle.identity.ikSignPub ||
          existingMeta.peerIdentity.ikDhPub !== peerBundle.identity.ikDhPub) &&
        !existingMeta.allowKeyChange
      ) {
        throw new Error(`ВНИМАНИЕ: изменился ключ безопасности пользователя ${peerId}. Сверьте отпечаток.`);
      }

      // Не перезатираем уже работающую сессию Double Ratchet при повторном открытии диалога
      if (!forceReset) {
        const existingSession = await this._loadSession(peerId).catch(() => null);
        if (existingSession && existingSession.sendChainKey) {
          await this.store.putEncryptedRecord(`peerMeta:${peerId}`, {
            ...existingMeta,
            peerIdentity: peerBundle.identity,
          });
          return {
            peerId,
            reused: true,
            safetyNumber: await computeSafetyNumber(this.identity.publicIdentity, peerBundle.identity),
          };
        }
      }

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
        acceptedEphemeralPub: existingMeta?.acceptedEphemeralPub || null,
        verified: Boolean(existingMeta?.verified),
      });
      return { peerId, safetyNumber: await computeSafetyNumber(this.identity.publicIdentity, peerBundle.identity) };
    });
  }

  /** Шифрование сообщения для собеседника и упаковка в анонимный конверт Sealed Sender */
  async encryptMessageForPeer({ peerId, payloadObject }) {
    return this._runSerialized(async () => {
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
        minBlockBytes: this.paddingBlockBytes || 512,
      });
      return { sealedBytes };
    });
  }

  /** Вскрытие входящего конверта Sealed Sender и расшифровка Double Ratchet (с автопринятием X3DH) */
  async decryptIncomingSealedEnvelope({ sealedBytes }) {
    return this._runSerialized(async () => {
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
        throw new Error(`ВНИМАНИЕ: изменился ключ безопасности пользователя ${peerId}. Сверьте отпечаток.`);
      }

      let session = await this._loadSession(peerId).catch(() => null);
      let acceptedEphemeralPub = existingMeta?.acceptedEphemeralPub || null;
      const hs = unsealed.body.x3dh || null;

      // Определяем, нужно ли инициализировать ответную сессию X3DH:
      // 1) Если пакет принадлежит уже принятой серии первого полёта (тот же ephemeralPub) — не пересоздаём сессию.
      // 2) Если пришёл НОВЫЙ ephemeralPub и у нас нет встречного неподтверждённого рукопожатия (или мы уступаем по userId) — принимаем X3DH.
      const isSameAcceptedFlight = Boolean(hs && session && acceptedEphemeralPub === hs.ephemeralPub);
      const shouldAcceptHandshake = Boolean(
        hs &&
        !isSameAcceptedFlight &&
        (!session || !existingMeta?.pendingHandshake || peerId < this.identity.userId)
      );

      if (shouldAcceptHandshake) {
        const spkPriv = await this.store.getNativeKey(`spk:${hs.spkId}`);
        const spkMeta = await this.store.getEncryptedRecord(`spkMeta:${hs.spkId}`);
        if (!spkPriv || !spkMeta) {
          throw new Error(`Не найден локальный SignedPreKey #${hs.spkId}`);
        }
        let opkObj = null;
        let missingOpk = false;
        if (hs.opkId !== null && hs.opkId !== undefined) {
          const opkPriv = await this.store.getNativeKey(`opk:${hs.opkId}`);
          if (!opkPriv) {
            missingOpk = true;
          } else {
            opkObj = { keyId: hs.opkId, privateKey: opkPriv };
          }
        }

        if (missingOpk) {
          if (!session) {
            throw new Error(`Одноразовый ключ OPK #${hs.opkId} уже использован или отсутствует`);
          }
        } else {
          const x3dhOut = await x3dhRespond({
            bobIdentity: this.identity.publicIdentity,
            bobPrivateKeys: this.identity.privateKeys,
            bobSignedPreKey: { keyId: hs.spkId, privateKey: spkPriv },
            bobOneTimePreKey: opkObj,
            handshake: hs,
          });

          // Немедленно удаляем использованный одноразовый ключ OPK (Forward Secrecy рукопожатия)
          if (opkObj) {
            await this.store.deleteNativeKey(`opk:${opkObj.keyId}`);
          }

          session = await DoubleRatchetSession.initAsResponder({
            sharedSecret: x3dhOut.sharedSecret,
            associatedData: x3dhOut.associatedData,
            localRatchetPrivateKey: spkPriv,
            localRatchetPubRaw: fromBase64Url(spkMeta.pubRawB64),
          });
          acceptedEphemeralPub = hs.ephemeralPub;
        }
      }

      if (!session) {
        throw new Error(`Сессия Double Ratchet с ${peerId} отсутствует и заголовок X3DH не передан`);
      }

      const plainBytes = await session.decrypt(unsealed.body.dr);
      const payload = JSON.parse(bytesToUtf8(plainBytes));
      wipe(plainBytes);

      // Если мы приняли встречный X3DH или получили ответ без X3DH — наш pendingHandshake завершён
      const keepPendingHandshake =
        existingMeta?.pendingHandshake && hs && !shouldAcceptHandshake && !isSameAcceptedFlight
          ? existingMeta.pendingHandshake
          : null;

      const nextMeta = {
        peerIdentity,
        pendingHandshake: keepPendingHandshake,
        acceptedEphemeralPub,
        verified: Boolean(existingMeta?.verified),
      };
      await this._persistSession(peerId, session, nextMeta);

      return {
        senderId: peerId,
        senderIdentity: peerIdentity,
        sentAt: unsealed.sentAt,
        payload,
      };
    });
  }

  /** Вычисление кода безопасности (60 цифр + 128-битный HEX + QR) для чата с peerId */
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

  /** Шифрование/расшифровка анонимного обращения E2E-шлюза */
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

  /** Экстренная очистка расшифрованных сессий из оперативной памяти воркера */
  lockRamCache() {
    return this._runSerialized(() => {
      for (const s of this.sessions.values()) {
        if (s.rootKey) wipe(s.rootKey);
        if (s.sendChainKey) wipe(s.sendChainKey);
        if (s.recvChainKey) wipe(s.recvChainKey);
      }
      this.sessions.clear();
      return { locked: true };
    });
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
