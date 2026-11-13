// Ручная сверка ключей безопасности (Safety Number + Эмодзи-код + QR-отпечаток),
// аналогичная механизму Signal Safety Numbers (5200 итераций SHA-512).

import {
  utf8ToBytes,
  concatBytes,
  u32be,
  sha512,
  fromBase64Url,
  toBase64Url,
} from './primitives.mjs';

const FINGERPRINT_VERSION = 1;
const HASH_ITERATIONS = 5200;

// Таблица из 64 визуально различимых эмодзи (ровно 6 бит энтропии на каждый символ)
export const SAFETY_EMOJIS = Object.freeze([
  '🔒', '🔑', '🛡️', '⚡', '🔥', '❄️', '🌊', '🌿',
  '🍀', '🍎', '🍋', '🍇', '🍉', '🍒', '🥑', '🌶️',
  '🦊', '🐺', '🦁', '🐯', '🐴', '🦄', '🐝', '🦋',
  '🐢', '🐬', '🐳', '🐙', '🦉', '🦅', '🐧', '🐸',
  '🌙', '☀️', '⭐', '☄️', '🌈', '🌋', '🏔️', '🏝️',
  '💎', '🧭', '⚓', '🚀', '🛸', '⛵', '🚂', '🚲',
  '🎸', '🎺', '🥁', '🎻', '🎯', '🎲', '🧩', '🏆',
  '👑', '🎩', '🕶️', '⏳', '🔮', '🧲', '🔭', '🕯️',
]);

/** Вычисляет 5200-кратный итеративный SHA-512 дайджест для одной стороны диалога */
async function iteratedIdentityDigest(publicIdentity) {
  const ikBytes = concatBytes(
    fromBase64Url(publicIdentity.ikSignPub),
    fromBase64Url(publicIdentity.ikDhPub)
  );
  const seed = concatBytes(
    u32be(FINGERPRINT_VERSION),
    ikBytes,
    utf8ToBytes(String(publicIdentity.userId))
  );

  let current = seed;
  for (let i = 0; i < HASH_ITERATIONS; i++) {
    current = await sha512(concatBytes(current, ikBytes));
  }
  return current; // 64 байта
}

/** Превращает 5 байт дайджеста в 5-значную десятичную группу (как в Signal: uint40 mod 100000) */
function chunkToFiveDigits(bytes, offset) {
  let val = 0n;
  for (let i = 0; i < 5; i++) {
    val = (val << 8n) | BigInt(bytes[offset + i]);
  }
  return String(val % 100000n).padStart(5, '0');
}

/** Превращает 30 байт в 6 блоков по 5 цифр (30 цифр на участника) */
function digestTo30Digits(digest64) {
  const groups = [];
  for (let i = 0; i < 6; i++) {
    groups.push(chunkToFiveDigits(digest64, i * 5));
  }
  return groups;
}

/** Лексикографическое сравнение двух массивов байтов для симметричной сортировки Алисы и Боба */
function compareBytes(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Вычисляет код безопасности между локальным пользователем и собеседником.
 * Результат гарантированно одинаков и у Алисы, и у Боба:
 * - digits: строка из 60 цифр (12 групп по 5 цифр)
 * - emojis: массив из 8 эмодзи (48 бит объединённого отпечатка)
 * - qrPayload: компактная строка для мгновенной сверки через камеру
 */
export async function computeSafetyNumber(identityA, identityB) {
  const [digestA, digestB] = await Promise.all([
    iteratedIdentityDigest(identityA),
    iteratedIdentityDigest(identityB),
  ]);

  const ordered = compareBytes(digestA, digestB) <= 0
    ? [digestA, digestB]
    : [digestB, digestA];

  const blocks = [
    ...digestTo30Digits(ordered[0]),
    ...digestTo30Digits(ordered[1]),
  ];

  const combinedHash = await sha512(concatBytes(ordered[0], ordered[1]));
  const emojis = [];
  for (let i = 0; i < 8; i++) {
    emojis.push(SAFETY_EMOJIS[combinedHash[i] & 63]);
  }

  // Строгий 128-битный шестнадцатеричный отпечаток (8 групп по 4 HEX-символа) для верификации ключей
  const hexBlocks = [];
  for (let i = 0; i < 16; i += 2) {
    const word = ((combinedHash[i] << 8) | combinedHash[i + 1]).toString(16).toUpperCase().padStart(4, '0');
    hexBlocks.push(word);
  }

  return {
    digits: blocks.join(' '),
    blocks,
    hexBlocks,
    hexText: hexBlocks.join('-'),
    emojis,
    emojiText: emojis.join(' '),
    qrPayload: `meshchat-sn:v1:${toBase64Url(combinedHash.subarray(0, 32))}`,
  };
}
