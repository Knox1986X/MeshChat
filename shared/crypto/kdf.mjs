// Парольный KDF (Argon2id + scrypt fallback), разделение ключей Zero-Knowledge аутентификации
// и опциональное резервное шифрование ключей восстановления (Recovery Kit).

import argon2Module from '../../public/vendor/argon2.mjs';
import { scryptAsync } from '../../public/vendor/noble-scrypt.mjs';
import {
  utf8ToBytes,
  bytesToUtf8,
  sha256,
  hkdfDeriveBytes,
  hmacSha256,
  aesGcmEncrypt,
  aesGcmDecrypt,
  generateEcdsaKeyPair,
  exportRawPublicKey,
  exportPkcs8PrivateKey,
  importEcdsaPrivateKeyPkcs8,
  ecdsaSign,
  randomBytes,
  toBase64Url,
  fromBase64Url,
  wipe,
} from './primitives.mjs';

// Параметры по умолчанию согласно требованиям безопасности:
// Argon2id: 64 MiB памяти, 3 прохода, 1 поток
export const ARGON2_DEFAULT_PARAMS = Object.freeze({
  memorySize: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
});

// scrypt fallback (например, Tor Browser на уровне Safest с отключённым WebAssembly):
// N = 2^17 = 131072 (128 MiB памяти), r = 8, p = 1
export const SCRYPT_DEFAULT_PARAMS = Object.freeze({
  N: 131072,
  r: 8,
  p: 1,
  dkLen: 32,
});

const B32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Без похожих символов 0/O/1/I

/** Нормализация имени пользователя перед вычислением детерминированной клиентской соли */
export function normalizeUsername(username) {
  const clean = String(username || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(clean)) {
    throw new Error('Имя пользователя должно быть от 3 до 32 символов (латиница, цифры, _)');
  }
  return clean;
}

/** Детерминированная доменная соль клиента (16 байт) из нормализованного username */
export async function deriveClientSalt(username) {
  const clean = normalizeUsername(username);
  const digest = await sha256(utf8ToBytes(`MSG-CLIENT-KDF-SALT-v1:${clean}`));
  return digest.subarray(0, 16);
}

/**
 * Вычисляет 32-байтный masterSecret по паролю и соли.
 * Основной алгоритм — Argon2id (WASM), резервный — scrypt (N=2^17, r=8, p=1).
 */
export async function derivePasswordSecret(password, saltBytes, { algorithm = 'auto', params } = {}) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Пароль должен содержать минимум 8 символов');
  }
  if (!(saltBytes instanceof Uint8Array) || saltBytes.byteLength < 16) {
    throw new Error('Соль должна быть не короче 16 байт');
  }

  const pwdBytes = utf8ToBytes(password.normalize('NFKC'));
  try {
    if (algorithm === 'argon2id' || algorithm === 'auto') {
      try {
        const cfg = { ...ARGON2_DEFAULT_PARAMS, ...(params || {}) };
        const hash = await argon2Module.argon2id({
          password: pwdBytes,
          salt: saltBytes,
          memorySize: cfg.memorySize,
          iterations: cfg.iterations,
          parallelism: cfg.parallelism,
          hashLength: cfg.hashLength,
          outputType: 'binary',
        });
        return {
          secret: new Uint8Array(hash),
          kdfInfo: { algorithm: 'argon2id', ...cfg },
        };
      } catch (err) {
        if (algorithm === 'argon2id') throw err;
        // В случае запрета WebAssembly (например, Tor Browser Safest) прозрачно переходим на scrypt N=2^17
      }
    }

    const scfg = { ...SCRYPT_DEFAULT_PARAMS, ...(params || {}) };
    const secret = await scryptAsync(pwdBytes, saltBytes, scfg);
    return {
      secret: new Uint8Array(secret),
      kdfInfo: { algorithm: 'scrypt', ...scfg },
    };
  } finally {
    wipe(pwdBytes);
  }
}

/**
 * Разделяет парольный секрет на два криптографически независимых ключа через HKDF-SHA256:
 * - authKey (32 B): для Zero-Knowledge аутентификации на сервере (сам пароль сервер не видит НИКОГДА).
 * - localWrapKey (32 B): строго локальный ключ клиента (на сервер никогда не передаётся).
 */
export async function deriveAccountKeys(username, password, options = {}) {
  const salt = await deriveClientSalt(username);
  const { secret, kdfInfo } = await derivePasswordSecret(password, salt, options);
  try {
    const authKey = await hkdfDeriveBytes(secret, salt, 'MSG-ZK-AUTH-KEY-v1', 32);
    const localWrapKey = await hkdfDeriveBytes(secret, salt, 'MSG-LOCAL-WRAP-KEY-v1', 32);
    return { authKey, localWrapKey, kdfInfo };
  } finally {
    wipe(secret);
  }
}

/**
 * Ответ клиента на одноразовый серверный challenge при входе (Zero-Knowledge Challenge-Response).
 * Сервер проверяет или верификатор ключа при регистрации, или подпись сеансового ключа.
 */
export async function computeAuthChallengeProof(authKey, serverChallengeB64, username) {
  const clean = normalizeUsername(username);
  const msg = utf8ToBytes(`MSG-AUTH-CHALLENGE-v1:${clean}:${serverChallengeB64}`);
  const mac = await hmacSha256(authKey, msg);
  return toBase64Url(mac);
}

/**
 * Асимметричная Zero-Knowledge регистрация (в стиле OPAQUE / Proton / Bitwarden):
 * Генерирует пару ECDSA P-256 для аутентификации и шифрует приватный ключ ключом authKey (Argon2id).
 * На сервер уходят ТОЛЬКО публичный ключ authPub и зашифрованный блоб encryptedAuthKey.
 * Сервер физически не хранит ни пароль, ни хеш пароля, ни симметричный секрет!
 */
export async function createZkAuthRegistration(username, password, options = {}) {
  const clean = normalizeUsername(username);
  const { authKey, localWrapKey, kdfInfo } = await deriveAccountKeys(clean, password, options);
  try {
    const authPair = await generateEcdsaKeyPair({ extractable: true });
    const authPubRaw = await exportRawPublicKey(authPair.publicKey);
    const authPrivPkcs8 = await exportPkcs8PrivateKey(authPair.privateKey);
    const iv = randomBytes(12);
    const aad = utf8ToBytes(`MSG-ZK-AUTH-WRAP-v1:${clean}`);
    const ct = await aesGcmEncrypt(authKey, iv, authPrivPkcs8, aad);
    wipe(authPrivPkcs8);

    return {
      username: clean,
      authPubB64: toBase64Url(authPubRaw),
      encryptedAuthKey: {
        v: 1,
        alg: kdfInfo.algorithm,
        iv: toBase64Url(iv),
        ct: toBase64Url(ct),
      },
      kdfInfo,
    };
  } finally {
    wipe(authKey);
    wipe(localWrapKey);
  }
}

/**
 * Асимметричный Zero-Knowledge вход:
 * Расшифровывает encryptedAuthKey локально с помощью пароля (Argon2id), подписывает серверный
 * одноразовый challengeNonce ключом ECDSA P-256 и затирает ключи в RAM.
 */
export async function signZkLoginChallenge({ username, password, encryptedAuthKey, challengeNonce, options = {} }) {
  if (!encryptedAuthKey || encryptedAuthKey.v !== 1) {
    throw new Error('Некорректный конверт ключа аутентификации');
  }
  const clean = normalizeUsername(username);
  const kdfOpts = { ...options, algorithm: options.algorithm || encryptedAuthKey.alg || 'auto' };
  const { authKey, localWrapKey } = await deriveAccountKeys(clean, password, kdfOpts);
  try {
    const aad = utf8ToBytes(`MSG-ZK-AUTH-WRAP-v1:${clean}`);
    let pkcs8;
    try {
      pkcs8 = await aesGcmDecrypt(
        authKey,
        fromBase64Url(encryptedAuthKey.iv),
        fromBase64Url(encryptedAuthKey.ct),
        aad
      );
    } catch {
      throw new Error('Неверное имя пользователя или пароль');
    }
    const authPriv = await importEcdsaPrivateKeyPkcs8(pkcs8, { extractable: false });
    wipe(pkcs8);

    const payload = utf8ToBytes(`MSG-ZK-LOGIN-v1:${clean}:${challengeNonce}`);
    const sig = await ecdsaSign(authPriv, payload);
    return toBase64Url(sig);
  } finally {
    wipe(authKey);
    wipe(localWrapKey);
  }
}

// ─────────────────────── Анти-спам Hashcash Proof-of-Work (без CAPTCHA и телефонов) ───────────────────────

/** Подсчёт числа ведущих нулевых бит в SHA-256 хеше */
export function countLeadingZeroBits(bytes) {
  let bits = 0;
  for (const b of bytes) {
    if (b === 0) {
      bits += 8;
    } else {
      bits += Math.clz32(b) - 24;
      break;
    }
  }
  return bits;
}

/** Решает легковесную клиентскую задачу Proof-of-Work против спам-ботов (обычно 14..18 бит, ~15–60 мс) */
export async function solveProofOfWork(challengeToken, difficultyBits = 15) {
  let nonce = 0;
  while (true) {
    const attempt = `${nonce}`;
    const digest = await sha256(utf8ToBytes(`MSG-POW-v1:${challengeToken}:${attempt}`));
    if (countLeadingZeroBits(digest) >= difficultyBits) {
      return attempt;
    }
    nonce += 1;
  }
}

// ─────────────────────── Опциональный Zero-Knowledge Recovery Kit ───────────────────────

/**
 * Генерирует высокоэнтропийный ключ восстановления (256 бит),
 * отформатированный в 8 удобных для записи групп по 6 символов (например, K7M9P2-...).
 */
export function generateRecoveryKey() {
  const raw = randomBytes(32);
  let chars = '';
  for (let i = 0; i < raw.length; i++) {
    chars += B32_ALPHABET[raw[i] & 31];
  }
  // Для сохранения полных 256 бит кодируем также каноническую строку: группы Base32 из битового потока
  let bitBuf = 0;
  let bitCount = 0;
  let full = '';
  for (const byte of raw) {
    bitBuf = (bitBuf << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      full += B32_ALPHABET[(bitBuf >>> bitCount) & 31];
    }
  }
  if (bitCount > 0) {
    full += B32_ALPHABET[(bitBuf << (5 - bitCount)) & 31];
  }
  wipe(raw);
  // 52 символа -> разбиваем по 4–5 символов через дефис
  return full.match(/.{1,4}/g).join('-');
}

/** Декодирует форматированный Recovery Key обратно в 32 байта ключа */
export function parseRecoveryKey(formattedKey) {
  const clean = String(formattedKey || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  if (clean.length !== 52) {
    throw new Error('Некорректная длина ключа восстановления');
  }
  let bitBuf = 0;
  let bitCount = 0;
  const out = new Uint8Array(32);
  let pos = 0;
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Недопустимый символ в ключе восстановления');
    bitBuf = (bitBuf << 5) | idx;
    bitCount += 5;
    if (bitCount >= 8 && pos < 32) {
      bitCount -= 8;
      out[pos++] = (bitBuf >>> bitCount) & 0xff;
    }
  }
  return out;
}

/** Шифрует резервный слепок ключей личности ключом восстановления (AES-256-GCM + HKDF) */
export async function encryptRecoveryBundle(bundleObject, recoveryKeyStr) {
  const rawKey = parseRecoveryKey(recoveryKeyStr);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  try {
    const aesKey = await hkdfDeriveBytes(rawKey, salt, 'MSG-RECOVERY-BUNDLE-v1', 32);
    const plaintext = utf8ToBytes(JSON.stringify(bundleObject));
    const aad = utf8ToBytes('MSG-RECOVERY-AAD-v1');
    const ciphertext = await aesGcmEncrypt(aesKey, iv, plaintext, aad);
    wipe(aesKey);
    wipe(plaintext);
    return {
      v: 1,
      salt: toBase64Url(salt),
      iv: toBase64Url(iv),
      ct: toBase64Url(ciphertext),
    };
  } finally {
    wipe(rawKey);
  }
}

/** Расшифровывает резервный слепок ключей личности по ключу восстановления */
export async function decryptRecoveryBundle(encryptedEnvelope, recoveryKeyStr) {
  if (!encryptedEnvelope || encryptedEnvelope.v !== 1) {
    throw new Error('Неподдерживаемый формат резервной копии ключей');
  }
  const rawKey = parseRecoveryKey(recoveryKeyStr);
  try {
    const salt = fromBase64Url(encryptedEnvelope.salt);
    const iv = fromBase64Url(encryptedEnvelope.iv);
    const ct = fromBase64Url(encryptedEnvelope.ct);
    const aesKey = await hkdfDeriveBytes(rawKey, salt, 'MSG-RECOVERY-BUNDLE-v1', 32);
    const aad = utf8ToBytes('MSG-RECOVERY-AAD-v1');
    const pt = await aesGcmDecrypt(aesKey, iv, ct, aad);
    wipe(aesKey);
    const parsed = JSON.parse(bytesToUtf8(pt));
    wipe(pt);
    return parsed;
  } finally {
    wipe(rawKey);
  }
}
