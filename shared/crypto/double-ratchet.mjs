// Реализация алгоритма Double Ratchet (Signal Protocol).
// Обеспечивает прямую секретность (Forward Secrecy) на каждое сообщение,
// самовосстановление после компрометации (Post-Compromise Security) на каждый поворот диалога
// и устойчивость к перестановке/потере пакетов при переключении транспортов (WS <-> WebRTC <-> Tor).

import {
  utf8ToBytes,
  concatBytes,
  u32be,
  constantTimeEqual,
  wipe,
  toBase64Url,
  fromBase64Url,
  generateEcdhKeyPair,
  exportRawPublicKey,
  exportPkcs8PrivateKey,
  importEcdhPrivateKeyPkcs8,
  ecdhSharedSecret,
  hkdfDeriveBytes,
  hmacSha256,
  aesGcmEncrypt,
  aesGcmDecrypt,
  padPayload,
  unpadPayload,
} from './primitives.mjs';

const DR_ROOT_INFO = utf8ToBytes('MSG-DR-ROOT-RATCHET-v1');
const DR_MSG_INFO = utf8ToBytes('MSG-DR-MESSAGE-KEY-v1');
const ZERO_SALT_32 = new Uint8Array(32);
const HMAC_MSG_INPUT = new Uint8Array([0x01]);
const HMAC_CHAIN_INPUT = new Uint8Array([0x02]);

export const MAX_SKIP_PER_CHAIN = 256;          // Защита от DoS при подделке счётчика N
export const MAX_SKIPPED_KEYS_TOTAL = 512;      // Потолок хранения пропущенных ключей на сессию
export const SKIPPED_KEY_TTL_MS = 7 * 86400e3;  // 7 суток жизни пропущенного ключа

/** Шаг корневого храповика: (rk, dhOut) -> { rootKey (32B), chainKey (32B) } */
async function kdfRootKey(rootKey, dhOut) {
  const derived = await hkdfDeriveBytes(dhOut, rootKey, DR_ROOT_INFO, 64);
  const nextRootKey = derived.slice(0, 32);
  const chainKey = derived.slice(32, 64);
  wipe(derived);
  return { nextRootKey, chainKey };
}

/** Шаг симметричной цепочки: ck -> { nextChainKey (32B), messageKey (32B) } с затиранием старого ck */
async function kdfChainKey(chainKey) {
  const messageKey = await hmacSha256(chainKey, HMAC_MSG_INPUT);
  const nextChainKey = await hmacSha256(chainKey, HMAC_CHAIN_INPUT);
  wipe(chainKey);
  return { nextChainKey, messageKey };
}

/** Вывод одноразового ключа AES-256-GCM (32B) и детерминированного IV (12B) из messageKey */
async function expandMessageKey(messageKey) {
  const material = await hkdfDeriveBytes(messageKey, ZERO_SALT_32, DR_MSG_INFO, 44);
  const encKey = material.slice(0, 32);
  const iv = material.slice(32, 44);
  wipe(material);
  return { encKey, iv };
}

/** Каноническая сериализация заголовка храповика для криптографической привязки в AAD */
export function encodeHeaderBytes(header) {
  const dhRaw = header.dh instanceof Uint8Array ? header.dh : fromBase64Url(header.dh);
  if (dhRaw.byteLength !== 65) throw new Error('Некорректный ключ DH в заголовке Double Ratchet');
  return concatBytes(utf8ToBytes('MSG-DR-HDR-v1:'), dhRaw, u32be(header.pn), u32be(header.n));
}

function skippedId(dhPubB64, n) {
  return `${dhPubB64}:${n}`;
}

export class DoubleRatchetSession {
  constructor(state) {
    this.rootKey = state.rootKey;               // Uint8Array(32)
    this.associatedData = state.associatedData; // Uint8Array
    this.dhSendPriv = state.dhSendPriv;         // CryptoKey (ECDH P-256)
    this.dhSendPubRaw = state.dhSendPubRaw;     // Uint8Array(65)
    this.dhRecvPubRaw = state.dhRecvPubRaw;     // Uint8Array(65) | null
    this.sendChainKey = state.sendChainKey;     // Uint8Array(32) | null
    this.recvChainKey = state.recvChainKey;     // Uint8Array(32) | null
    this.ns = state.ns || 0;                    // Счётчик отправленных в текущей цепочке
    this.nr = state.nr || 0;                    // Счётчик принятых в текущей цепочке
    this.pn = state.pn || 0;                    // Длина предыдущей цепочки отправки
    this.skippedKeys = state.skippedKeys || new Map(); // id -> { mk: Uint8Array(32), ts: number }
  }

  /** Инициализация сессии на стороне инициатора (Алисы) сразу после X3DH */
  static async initAsInitiator({ sharedSecret, associatedData, remoteRatchetPubRaw }) {
    const dhSend = await generateEcdhKeyPair({ extractable: true }); // эфемерный ключ храповика для сериализации в зашифрованную БД
    const dhSendPubRaw = await exportRawPublicKey(dhSend.publicKey);
    const dhOut = await ecdhSharedSecret(dhSend.privateKey, remoteRatchetPubRaw);
    const { nextRootKey, chainKey } = await kdfRootKey(sharedSecret, dhOut);
    wipe(dhOut);
    wipe(sharedSecret);

    return new DoubleRatchetSession({
      rootKey: nextRootKey,
      associatedData: new Uint8Array(associatedData),
      dhSendPriv: dhSend.privateKey,
      dhSendPubRaw,
      dhRecvPubRaw: new Uint8Array(remoteRatchetPubRaw),
      sendChainKey: chainKey,
      recvChainKey: null,
      ns: 0,
      nr: 0,
      pn: 0,
      skippedKeys: new Map(),
    });
  }

  /** Инициализация сессии на стороне ответчика (Боба) с его текущим SignedPreKey в роли стартового ключа */
  static async initAsResponder({ sharedSecret, associatedData, localRatchetPrivateKey, localRatchetPubRaw }) {
    return new DoubleRatchetSession({
      rootKey: new Uint8Array(sharedSecret),
      associatedData: new Uint8Array(associatedData),
      dhSendPriv: localRatchetPrivateKey,
      dhSendPubRaw: new Uint8Array(localRatchetPubRaw),
      dhRecvPubRaw: null,
      sendChainKey: null,
      recvChainKey: null,
      ns: 0,
      nr: 0,
      pn: 0,
      skippedKeys: new Map(),
    });
  }

  /** Шифрование исходящего сообщения с автопаддингом и немедленным уничтожением использованных ключей */
  async encrypt(plaintextBytes) {
    if (!this.sendChainKey) {
      throw new Error('Цепочка отправки ещё не инициализирована (ожидается входящий шаг храповика)');
    }
    const plain = plaintextBytes instanceof Uint8Array ? plaintextBytes : utf8ToBytes(String(plaintextBytes));
    const padded = padPayload(plain);

    const { nextChainKey, messageKey } = await kdfChainKey(this.sendChainKey);
    this.sendChainKey = nextChainKey;

    const header = {
      dh: toBase64Url(this.dhSendPubRaw),
      pn: this.pn,
      n: this.ns,
    };
    this.ns += 1;

    const { encKey, iv } = await expandMessageKey(messageKey);
    wipe(messageKey);

    try {
      const aad = concatBytes(this.associatedData, encodeHeaderBytes(header));
      const ciphertext = await aesGcmEncrypt(encKey, iv, padded, aad);
      return {
        header,
        ciphertext: toBase64Url(ciphertext),
      };
    } finally {
      wipe(encKey);
      wipe(iv);
      wipe(padded);
    }
  }

  /** Расшифровка входящего пакета (включая пакеты, пришедшие не по порядку) */
  async decrypt(packet) {
    if (!packet || !packet.header || typeof packet.ciphertext !== 'string') {
      throw new Error('Некорректный пакет Double Ratchet');
    }
    const { header } = packet;
    const headerDhRaw = fromBase64Url(header.dh);
    const ctBytes = fromBase64Url(packet.ciphertext);
    const aad = concatBytes(this.associatedData, encodeHeaderBytes(header));

    this._pruneExpiredSkippedKeys();

    // 1. Проверяем, не относится ли пакет к ранее пропущенным сообщениям
    const skKey = skippedId(header.dh, header.n);
    if (this.skippedKeys.has(skKey)) {
      const entry = this.skippedKeys.get(skKey);
      this.skippedKeys.delete(skKey);
      return this._decryptWithMessageKey(entry.mk, ctBytes, aad);
    }

    // 2. Валидация счётчиков ДО мутации состояния сессии (атомарность при атаках)
    const needDhStep = !this.dhRecvPubRaw || !constantTimeEqual(headerDhRaw, this.dhRecvPubRaw);
    if (needDhStep) {
      if (this.recvChainKey && header.pn - this.nr > MAX_SKIP_PER_CHAIN) {
        throw new Error(`Превышен лимит пропущенных сообщений предыдущей цепочки (${MAX_SKIP_PER_CHAIN})`);
      }
      if (header.n > MAX_SKIP_PER_CHAIN) {
        throw new Error(`Превышен лимит пропущенных сообщений новой цепочки (${MAX_SKIP_PER_CHAIN})`);
      }
      await this._skipMessageKeys(header.pn);
      await this._dhRatchetStep(headerDhRaw);
    } else if (header.n < this.nr) {
      throw new Error('Повторная доставка (replay) уже расшифрованного сообщения отвергнута');
    }

    await this._skipMessageKeys(header.n);

    const { nextChainKey, messageKey } = await kdfChainKey(this.recvChainKey);
    this.recvChainKey = nextChainKey;
    this.nr += 1;

    return this._decryptWithMessageKey(messageKey, ctBytes, aad);
  }

  async _decryptWithMessageKey(messageKey, ctBytes, aad) {
    const { encKey, iv } = await expandMessageKey(messageKey);
    try {
      const padded = await aesGcmDecrypt(encKey, iv, ctBytes, aad);
      const unpadded = unpadPayload(padded);
      wipe(padded);
      return unpadded;
    } finally {
      wipe(messageKey);
      wipe(encKey);
      wipe(iv);
    }
  }

  async _skipMessageKeys(untilN) {
    if (!this.recvChainKey) return;
    if (untilN - this.nr > MAX_SKIP_PER_CHAIN) {
      throw new Error(`Превышен лимит пропуска сообщений (${MAX_SKIP_PER_CHAIN})`);
    }
    const dhB64 = toBase64Url(this.dhRecvPubRaw);
    while (this.nr < untilN) {
      const { nextChainKey, messageKey } = await kdfChainKey(this.recvChainKey);
      this.recvChainKey = nextChainKey;
      this.skippedKeys.set(skippedId(dhB64, this.nr), { mk: messageKey, ts: Date.now() });
      this.nr += 1;

      // Вытесняем самые старые ключи при достижении потолка
      if (this.skippedKeys.size > MAX_SKIPPED_KEYS_TOTAL) {
        const oldestKey = this.skippedKeys.keys().next().value;
        const oldEntry = this.skippedKeys.get(oldestKey);
        if (oldEntry) wipe(oldEntry.mk);
        this.skippedKeys.delete(oldestKey);
      }
    }
  }

  async _dhRatchetStep(remoteDhRaw) {
    this.pn = this.ns;
    this.ns = 0;
    this.nr = 0;
    this.dhRecvPubRaw = new Uint8Array(remoteDhRaw);

    // Шаг 1: обновляем цепочку приёма на основе текущего dhSendPriv и нового ключа собеседника
    const dhRecvSecret = await ecdhSharedSecret(this.dhSendPriv, this.dhRecvPubRaw);
    const step1 = await kdfRootKey(this.rootKey, dhRecvSecret);
    wipe(dhRecvSecret);
    wipe(this.rootKey);
    this.rootKey = step1.nextRootKey;
    if (this.recvChainKey) wipe(this.recvChainKey);
    this.recvChainKey = step1.chainKey;

    // Шаг 2: генерируем свежую пару ключей отправки и обновляем цепочку отправки (Post-Compromise Security)
    const nextSendPair = await generateEcdhKeyPair({ extractable: true });
    const nextSendPubRaw = await exportRawPublicKey(nextSendPair.publicKey);
    const dhSendSecret = await ecdhSharedSecret(nextSendPair.privateKey, this.dhRecvPubRaw);
    const step2 = await kdfRootKey(this.rootKey, dhSendSecret);
    wipe(dhSendSecret);
    wipe(this.rootKey);

    this.rootKey = step2.nextRootKey;
    if (this.sendChainKey) wipe(this.sendChainKey);
    this.sendChainKey = step2.chainKey;
    this.dhSendPriv = nextSendPair.privateKey;
    this.dhSendPubRaw = nextSendPubRaw;
  }

  _pruneExpiredSkippedKeys() {
    const cutoff = Date.now() - SKIPPED_KEY_TTL_MS;
    for (const [k, v] of this.skippedKeys.entries()) {
      if (v.ts < cutoff) {
        wipe(v.mk);
        this.skippedKeys.delete(k);
      }
    }
  }

  /**
   * Экспорт состояния сессии в plain-объект ТОЛЬКО для немедленного шифрования
   * неизвлекаемым dbMasterKey (AES-256-GCM) перед записью в IndexedDB.
   */
  async exportState() {
    let dhSendPkcs8B64 = null;
    if (this.dhSendPriv && this.dhSendPriv.extractable) {
      const pkcs8 = await exportPkcs8PrivateKey(this.dhSendPriv);
      dhSendPkcs8B64 = toBase64Url(pkcs8);
      wipe(pkcs8);
    }
    const skipped = [];
    for (const [k, v] of this.skippedKeys.entries()) {
      skipped.push([k, toBase64Url(v.mk), v.ts]);
    }
    return {
      v: 1,
      rk: toBase64Url(this.rootKey),
      ad: toBase64Url(this.associatedData),
      dhSendPkcs8: dhSendPkcs8B64,
      dhSendPub: toBase64Url(this.dhSendPubRaw),
      dhRecvPub: this.dhRecvPubRaw ? toBase64Url(this.dhRecvPubRaw) : null,
      ckSend: this.sendChainKey ? toBase64Url(this.sendChainKey) : null,
      ckRecv: this.recvChainKey ? toBase64Url(this.recvChainKey) : null,
      ns: this.ns,
      nr: this.nr,
      pn: this.pn,
      skipped,
    };
  }

  /** Восстановление сессии из расшифрованного состояния (с возможностью подставить неизвлекаемый SPK) */
  static async importState(data, fallbackNonExtractablePrivKey = null) {
    if (!data || data.v !== 1) throw new Error('Неподдерживаемая версия состояния Double Ratchet');
    let dhSendPriv = fallbackNonExtractablePrivKey;
    if (data.dhSendPkcs8) {
      const pkcs8 = fromBase64Url(data.dhSendPkcs8);
      dhSendPriv = await importEcdhPrivateKeyPkcs8(pkcs8, { extractable: true });
      wipe(pkcs8);
    }
    const skippedKeys = new Map();
    for (const [k, mkB64, ts] of data.skipped || []) {
      skippedKeys.set(k, { mk: fromBase64Url(mkB64), ts });
    }
    return new DoubleRatchetSession({
      rootKey: fromBase64Url(data.rk),
      associatedData: fromBase64Url(data.ad),
      dhSendPriv,
      dhSendPubRaw: fromBase64Url(data.dhSendPub),
      dhRecvPubRaw: data.dhRecvPub ? fromBase64Url(data.dhRecvPub) : null,
      sendChainKey: data.ckSend ? fromBase64Url(data.ckSend) : null,
      recvChainKey: data.ckRecv ? fromBase64Url(data.ckRecv) : null,
      ns: data.ns,
      nr: data.nr,
      pn: data.pn,
      skippedKeys,
    });
  }
}
