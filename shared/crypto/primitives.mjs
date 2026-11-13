// Низкоуровневые криптопримитивы поверх стандартного WebCrypto API (SubtleCrypto).
// Никаких самописных алгоритмов: только NIST P-256 (ECDH/ECDSA), HKDF-SHA256, HMAC-SHA256, SHA-256/512 и AES-256-GCM.

const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error('WebCrypto API (crypto.subtle) недоступен в текущем окружении');
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Стандартные корзины размеров конвертов для защиты от анализа трафика по длине пакета
const PADDING_BUCKETS = [512, 2048, 8192, 32768, 65536];
const PADDING_BLOCK_ABOVE_MAX = 16384;

/** Строка UTF-8 -> Uint8Array */
export function utf8ToBytes(str) {
  return textEncoder.encode(String(str));
}

/** Uint8Array -> строка UTF-8 */
export function bytesToUtf8(bytes) {
  return textDecoder.decode(bytes);
}

/** Криптостойкие случайные байты */
export function randomBytes(length) {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Безопасное затирание чувствительного буфера в памяти */
export function wipe(buf) {
  if (buf instanceof Uint8Array) {
    buf.fill(0);
  } else if (buf instanceof ArrayBuffer) {
    new Uint8Array(buf).fill(0);
  }
}

/** Склейка нескольких Uint8Array в один */
export function concatBytes(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.byteLength;
  }
  return out;
}

/** Запись uint32 big-endian в 4-байтный буфер */
export function u32be(num) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, num >>> 0, false);
  return b;
}

/** Чтение uint32 big-endian */
export function readU32be(bytes, offset = 0) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

/** Сравнение буферов за константное время (защита от timing side-channel) */
export function constantTimeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/** Кодирование Uint8Array -> Base64URL без '=' */
export function toBase64Url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64url');
  }
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Декодирование Base64URL -> Uint8Array */
export function fromBase64Url(str) {
  if (typeof str !== 'string') throw new TypeError('Ожидалась Base64URL-строка');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64url'));
  }
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─────────────────────── Хеширование и KDF ───────────────────────

export async function sha256(data) {
  const buf = await subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

export async function sha512(data) {
  const buf = await subtle.digest('SHA-512', data);
  return new Uint8Array(buf);
}

/** HKDF-SHA256: вывод произвольного числа ключевых байтов */
export async function hkdfDeriveBytes(ikm, salt, info, byteLength) {
  const baseKey = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt instanceof Uint8Array ? salt : utf8ToBytes(salt),
      info: info instanceof Uint8Array ? info : utf8ToBytes(info),
    },
    baseKey,
    byteLength * 8
  );
  return new Uint8Array(bits);
}

/** Вычисление HMAC-SHA256 */
export async function hmacSha256(keyBytes, dataBytes) {
  const key = await subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await subtle.sign('HMAC', key, dataBytes);
  return new Uint8Array(sig);
}

/** Проверка HMAC-SHA256 за константное время */
export async function hmacVerifySha256(keyBytes, dataBytes, macBytes) {
  const expected = await hmacSha256(keyBytes, dataBytes);
  const ok = constantTimeEqual(expected, macBytes);
  wipe(expected);
  return ok;
}

// ─────────────────────── ECDH / ECDSA (NIST P-256) ───────────────────────

/**
 * Генерация пары ключей ECDH P-256.
 * По умолчанию extractable = false (приватный ключ нельзя выгрузить при XSS).
 */
export async function generateEcdhKeyPair({ extractable = false } = {}) {
  return subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    extractable,
    ['deriveBits']
  );
}

/** Генерация пары ключей подписи ECDSA P-256 */
export async function generateEcdsaKeyPair({ extractable = false } = {}) {
  return subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    extractable,
    ['sign', 'verify']
  );
}

/** Экспорт публичного ключа P-256 в сжатый/несжатый ANSI X9.62 raw (65 байт) */
export async function exportRawPublicKey(publicKey) {
  const raw = await subtle.exportKey('raw', publicKey);
  return new Uint8Array(raw);
}

/** Импорт публичного ключа ECDH P-256 из raw (65 байт) с валидацией точки на кривой */
export async function importEcdhPublicKey(rawBytes) {
  if (!(rawBytes instanceof Uint8Array) || rawBytes.byteLength !== 65 || rawBytes[0] !== 0x04) {
    throw new Error('Некорректный формат публичного ключа ECDH P-256');
  }
  return subtle.importKey(
    'raw',
    rawBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

/** Импорт публичного ключа ECDSA P-256 из raw (65 байт) */
export async function importEcdsaPublicKey(rawBytes) {
  if (!(rawBytes instanceof Uint8Array) || rawBytes.byteLength !== 65 || rawBytes[0] !== 0x04) {
    throw new Error('Некорректный формат публичного ключа ECDSA P-256');
  }
  return subtle.importKey(
    'raw',
    rawBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

/** Экспорт/импорт приватного ключа в PKCS#8 (используется ТОЛЬКО для эфемерных ключей храповика или опционального бэкапа) */
export async function exportPkcs8PrivateKey(privateKey) {
  const buf = await subtle.exportKey('pkcs8', privateKey);
  return new Uint8Array(buf);
}

export async function importEcdhPrivateKeyPkcs8(pkcs8Bytes, { extractable = false } = {}) {
  return subtle.importKey(
    'pkcs8',
    pkcs8Bytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    extractable,
    ['deriveBits']
  );
}

export async function importEcdsaPrivateKeyPkcs8(pkcs8Bytes, { extractable = false } = {}) {
  return subtle.importKey(
    'pkcs8',
    pkcs8Bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    extractable,
    ['sign']
  );
}

/** Вычисление общего секрета ECDH P-256 (32 байта) */
export async function ecdhSharedSecret(privateKey, remotePublicKeyOrRaw) {
  const pub = remotePublicKeyOrRaw instanceof Uint8Array
    ? await importEcdhPublicKey(remotePublicKeyOrRaw)
    : remotePublicKeyOrRaw;
  const bits = await subtle.deriveBits(
    { name: 'ECDH', public: pub },
    privateKey,
    256
  );
  const out = new Uint8Array(bits);
  // Проверка на вырожденный нулевой секрет
  let nonZero = 0;
  for (let i = 0; i < out.length; i++) nonZero |= out[i];
  if (nonZero === 0) throw new Error('Отвергнут вырожденный общий секрет ECDH');
  return out;
}

/** Цифровая подпись ECDSA P-256 с SHA-256 (64 байта IEEE P1363) */
export async function ecdsaSign(privateKey, dataBytes) {
  const sig = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    dataBytes
  );
  return new Uint8Array(sig);
}

/** Проверка подписи ECDSA P-256 с SHA-256 */
export async function ecdsaVerify(publicKeyOrRaw, dataBytes, sigBytes) {
  if (!(sigBytes instanceof Uint8Array) || sigBytes.byteLength !== 64) return false;
  const pub = publicKeyOrRaw instanceof Uint8Array
    ? await importEcdsaPublicKey(publicKeyOrRaw)
    : publicKeyOrRaw;
  return subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pub,
    sigBytes,
    dataBytes
  );
}

// ─────────────────────── AES-256-GCM ───────────────────────

/** Шифрование AES-256-GCM с поддержкой AAD (Associated Authenticated Data) */
export async function aesGcmEncrypt(keyOrRawBytes, iv12Bytes, plaintextBytes, additionalData) {
  const key = keyOrRawBytes instanceof Uint8Array
    ? await subtle.importKey('raw', keyOrRawBytes, { name: 'AES-GCM' }, false, ['encrypt'])
    : keyOrRawBytes;
  const params = { name: 'AES-GCM', iv: iv12Bytes, tagLength: 128 };
  if (additionalData && additionalData.byteLength > 0) {
    params.additionalData = additionalData;
  }
  const ct = await subtle.encrypt(params, key, plaintextBytes);
  return new Uint8Array(ct);
}

/** Расшифровка AES-256-GCM с проверкой тега аутентичности (128 бит) и AAD */
export async function aesGcmDecrypt(keyOrRawBytes, iv12Bytes, ciphertextBytes, additionalData) {
  const key = keyOrRawBytes instanceof Uint8Array
    ? await subtle.importKey('raw', keyOrRawBytes, { name: 'AES-GCM' }, false, ['decrypt'])
    : keyOrRawBytes;
  const params = { name: 'AES-GCM', iv: iv12Bytes, tagLength: 128 };
  if (additionalData && additionalData.byteLength > 0) {
    params.additionalData = additionalData;
  }
  const pt = await subtle.decrypt(params, key, ciphertextBytes);
  return new Uint8Array(pt);
}

/** Генерация неизвлекаемого локального мастер-ключа для IndexedDB (extractable: false) */
export async function generateNonExtractableDbKey() {
  return subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ─────────────────────── Защита от Traffic Analysis (ISO/IEC 7816-4 Padding) ───────────────────────

/**
 * Дополняет полезную нагрузку до ближайшей стандартной корзины размера.
 * Формат: payload || 0x80 || 0x00 * k.
 * Короткое «ок» и абзац текста дают одинаковый размер шифртекста (512 Б).
 */
export function padPayload(payloadBytes, minBlockBytes = 0) {
  const minNeeded = payloadBytes.byteLength + 1;
  const quantum = Number(minBlockBytes) || 0;
  let target = 0;

  if (quantum === 256 && minNeeded <= 256) {
    target = 256;
  } else {
    for (const b of PADDING_BUCKETS) {
      if (b >= minNeeded && b >= quantum) {
        target = b;
        break;
      }
    }
    if (quantum > 512 && minNeeded <= quantum) {
      target = quantum;
    }
  }

  if (target === 0) {
    const step = quantum > 0 ? Math.max(quantum, PADDING_BLOCK_ABOVE_MAX) : PADDING_BLOCK_ABOVE_MAX;
    target = Math.ceil(minNeeded / step) * step;
  }
  const out = new Uint8Array(target);
  out.set(payloadBytes, 0);
  out[payloadBytes.byteLength] = 0x80;
  // Остальные байты уже 0x00
  return out;
}

/** Снимает ISO/IEC 7816-4 паддинг и проверяет корректность маркера 0x80 */
export function unpadPayload(paddedBytes) {
  if (!(paddedBytes instanceof Uint8Array) || paddedBytes.byteLength === 0) {
    throw new Error('Некорректный буфер при снятии паддинга');
  }
  let idx = paddedBytes.byteLength - 1;
  while (idx >= 0 && paddedBytes[idx] === 0x00) {
    idx--;
  }
  if (idx < 0 || paddedBytes[idx] !== 0x80) {
    throw new Error('Нарушена целостность ISO/IEC 7816-4 паддинга');
  }
  return paddedBytes.slice(0, idx);
}
