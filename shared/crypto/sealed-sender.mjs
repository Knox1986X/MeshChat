// Скрытие метаданных отправителя (Sealed Sender), сквозное шифрование файлов (AES-256-GCM)
// и клиентское E2E-шифрование анонимных вопросов («Голая правда»).

import {
  utf8ToBytes,
  bytesToUtf8,
  concatBytes,
  randomBytes,
  constantTimeEqual,
  wipe,
  toBase64Url,
  fromBase64Url,
  sha256,
  hkdfDeriveBytes,
  generateEcdhKeyPair,
  exportRawPublicKey,
  ecdhSharedSecret,
  aesGcmEncrypt,
  aesGcmDecrypt,
  padPayload,
  unpadPayload,
} from './primitives.mjs';
import { verifyPublicIdentity } from './x3dh.mjs';

const SEALED_SENDER_INFO = utf8ToBytes('MSG-SEALED-SENDER-v1');
const ANON_ASK_INFO = utf8ToBytes('MSG-ANON-QUESTION-v1');

// ─────────────────────── 1. Sealed Sender («Сервер не знает, кто отправитель») ───────────────────────

/**
 * Оборачивает пакет Double Ratchet (и опциональный заголовок X3DH первого контакта)
 * во внешний анонимный конверт ECIES к публичному ключу личности получателя.
 * На выходе: бинарный буфер [version(1B) || ephemeralPub(65B) || aesGcmCiphertext].
 * Сервер видит только адрес почтового ящика Боба и случайный эфемерный ключ.
 */
export async function sealSenderEnvelope({
  recipientIkDhPubB64,
  senderIdentity,
  innerObject,
  minBlockBytes = 0,
}) {
  const recipientPubRaw = fromBase64Url(recipientIkDhPubB64);
  const ephemeral = await generateEcdhKeyPair({ extractable: false });
  const ephemeralPubRaw = await exportRawPublicKey(ephemeral.publicKey);

  const shared = await ecdhSharedSecret(ephemeral.privateKey, recipientPubRaw);
  const keyMaterial = await hkdfDeriveBytes(shared, ephemeralPubRaw, SEALED_SENDER_INFO, 44);
  wipe(shared);

  const encKey = keyMaterial.slice(0, 32);
  const iv = keyMaterial.slice(32, 44);
  wipe(keyMaterial);

  const envelopePlain = utf8ToBytes(JSON.stringify({
    v: 1,
    sender: senderIdentity,
    sentAt: Date.now(),
    body: innerObject,
  }));
  const padded = padPayload(envelopePlain, minBlockBytes);
  wipe(envelopePlain);

  try {
    const aad = concatBytes(utf8ToBytes('MSG-SEAL-AAD-v1:'), recipientPubRaw, ephemeralPubRaw);
    const ct = await aesGcmEncrypt(encKey, iv, padded, aad);
    return concatBytes(new Uint8Array([0x01]), ephemeralPubRaw, ct);
  } finally {
    wipe(encKey);
    wipe(iv);
    wipe(padded);
  }
}

/**
 * Вскрывает внешний конверт Sealed Sender приватным ключом личности получателя (ikDhPriv)
 * и криптографически проверяет связку личности отправителя внутри конверта.
 */
export async function unsealSenderEnvelope({ recipientIkDhPriv, recipientIkDhPubB64, sealedBytes }) {
  const buf = sealedBytes instanceof Uint8Array ? sealedBytes : new Uint8Array(sealedBytes);
  if (buf.byteLength < 1 + 65 + 17 || buf[0] !== 0x01) {
    throw new Error('Некорректный формат конверта Sealed Sender');
  }
  const ephemeralPubRaw = buf.subarray(1, 66);
  const ct = buf.subarray(66);
  const recipientPubRaw = fromBase64Url(recipientIkDhPubB64);

  const shared = await ecdhSharedSecret(recipientIkDhPriv, ephemeralPubRaw);
  const keyMaterial = await hkdfDeriveBytes(shared, ephemeralPubRaw, SEALED_SENDER_INFO, 44);
  wipe(shared);

  const encKey = keyMaterial.slice(0, 32);
  const iv = keyMaterial.slice(32, 44);
  wipe(keyMaterial);

  try {
    const aad = concatBytes(utf8ToBytes('MSG-SEAL-AAD-v1:'), recipientPubRaw, ephemeralPubRaw);
    const padded = await aesGcmDecrypt(encKey, iv, ct, aad);
    const plain = unpadPayload(padded);
    wipe(padded);
    const parsed = JSON.parse(bytesToUtf8(plain));
    wipe(plain);

    if (!parsed || parsed.v !== 1 || !(await verifyPublicIdentity(parsed.sender))) {
      throw new Error('Отправитель внутри Sealed Sender не прошёл проверку подписи личности');
    }
    return {
      sender: parsed.sender,
      sentAt: parsed.sentAt,
      body: parsed.body,
    };
  } finally {
    wipe(encKey);
    wipe(iv);
  }
}

// ─────────────────────── 2. Обязательное клиентское E2E-шифрование файлов ───────────────────────

/**
 * Шифрует любой файл на клиенте ДО отправки на сервер одноразовым ключом AES-256-GCM.
 * На сервер уходит только безликий шифртекст (application/octet-stream).
 * Ключ, IV, SHA-256 шифртекста, имя и MIME передаются строго внутри Double Ratchet!
 */
export async function encryptFileForUpload(plainBytes, meta = {}) {
  const input = plainBytes instanceof Uint8Array ? plainBytes : new Uint8Array(plainBytes);
  const fileKey = randomBytes(32);
  const iv = randomBytes(12);
  const aad = utf8ToBytes('MSG-FILE-E2E-v1');

  const encryptedBytes = await aesGcmEncrypt(fileKey, iv, input, aad);
  const ctHash = await sha256(encryptedBytes);

  const descriptor = {
    v: 1,
    key: toBase64Url(fileKey),
    iv: toBase64Url(iv),
    sha256: toBase64Url(ctHash),
    size: input.byteLength,
    mime: String(meta.mime || 'application/octet-stream').slice(0, 120),
    name: String(meta.name || 'attachment.bin').slice(0, 200),
    once: Boolean(meta.once),
    width: meta.width || undefined,
    height: meta.height || undefined,
    duration: meta.duration || undefined,
  };
  wipe(fileKey);

  return { encryptedBytes, descriptor };
}

/**
 * Проверяет целостность SHA-256 скачанного блоба и расшифровывает файл на клиенте.
 * Защищает от подмены зашифрованного блоба на стороне сервера или S3.
 */
export async function decryptDownloadedFile(encryptedBytes, descriptor) {
  if (!descriptor || descriptor.v !== 1) {
    throw new Error('Неподдерживаемый дескриптор зашифрованного файла');
  }
  const ct = encryptedBytes instanceof Uint8Array ? encryptedBytes : new Uint8Array(encryptedBytes);
  const actualHash = await sha256(ct);
  const expectedHash = fromBase64Url(descriptor.sha256);

  if (!constantTimeEqual(actualHash, expectedHash)) {
    throw new Error('Контрольная сумма зашифрованного файла не совпала (возможна подмена на сервере)');
  }

  const fileKey = fromBase64Url(descriptor.key);
  const iv = fromBase64Url(descriptor.iv);
  const aad = utf8ToBytes('MSG-FILE-E2E-v1');
  try {
    return await aesGcmDecrypt(fileKey, iv, ct, aad);
  } finally {
    wipe(fileKey);
    wipe(iv);
  }
}

// ─────────────────────── 3. E2E «Голая правда» (анонимные вопросы без аккаунта) ───────────────────────

/**
 * Гость на странице /q/<username> шифрует свой вопрос в браузере публичным ключом получателя.
 * Даже сервер не видит текст вопроса!
 */
export async function encryptAnonymousQuestion({ recipientIkDhPubB64, text }) {
  const cleanText = String(text || '').trim().slice(0, 1000);
  if (cleanText.length < 2) throw new Error('Вопрос слишком короткий');

  const recipientPubRaw = fromBase64Url(recipientIkDhPubB64);
  const eph = await generateEcdhKeyPair({ extractable: false });
  const ephPubRaw = await exportRawPublicKey(eph.publicKey);
  const shared = await ecdhSharedSecret(eph.privateKey, recipientPubRaw);
  const km = await hkdfDeriveBytes(shared, ephPubRaw, ANON_ASK_INFO, 44);
  wipe(shared);

  const encKey = km.slice(0, 32);
  const iv = km.slice(32, 44);
  wipe(km);

  const padded = padPayload(utf8ToBytes(JSON.stringify({ v: 1, text: cleanText })));
  try {
    const aad = concatBytes(utf8ToBytes('MSG-ASK-AAD-v1:'), recipientPubRaw, ephPubRaw);
    const ct = await aesGcmEncrypt(encKey, iv, padded, aad);
    return toBase64Url(concatBytes(new Uint8Array([0x01]), ephPubRaw, ct));
  } finally {
    wipe(encKey);
    wipe(iv);
    wipe(padded);
  }
}

/** Расшифровка анонимного вопроса «Голой правды» на устройстве получателя */
export async function decryptAnonymousQuestion({ recipientIkDhPriv, recipientIkDhPubB64, payloadB64 }) {
  const buf = fromBase64Url(payloadB64);
  if (buf.byteLength < 1 + 65 + 17 || buf[0] !== 0x01) {
    throw new Error('Повреждён шифртекст анонимного вопроса');
  }
  const ephPubRaw = buf.subarray(1, 66);
  const ct = buf.subarray(66);
  const recipientPubRaw = fromBase64Url(recipientIkDhPubB64);

  const shared = await ecdhSharedSecret(recipientIkDhPriv, ephPubRaw);
  const km = await hkdfDeriveBytes(shared, ephPubRaw, ANON_ASK_INFO, 44);
  wipe(shared);

  const encKey = km.slice(0, 32);
  const iv = km.slice(32, 44);
  wipe(km);

  try {
    const aad = concatBytes(utf8ToBytes('MSG-ASK-AAD-v1:'), recipientPubRaw, ephPubRaw);
    const padded = await aesGcmDecrypt(encKey, iv, ct, aad);
    const plain = unpadPayload(padded);
    wipe(padded);
    const data = JSON.parse(bytesToUtf8(plain));
    wipe(plain);
    return data.text;
  } finally {
    wipe(encKey);
    wipe(iv);
  }
}
