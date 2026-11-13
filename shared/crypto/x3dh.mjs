// Протокол установки сессии X3DH (Extended Triple Diffie-Hellman) поверх NIST P-256.
// Гарантирует взаимную аутентификацию личностей, прямую секретность с первого сообщения
// и защиту от MITM при подмене PreKey на сервере.

import {
  utf8ToBytes,
  concatBytes,
  u32be,
  wipe,
  toBase64Url,
  fromBase64Url,
  generateEcdhKeyPair,
  generateEcdsaKeyPair,
  exportRawPublicKey,
  exportPkcs8PrivateKey,
  importEcdhPrivateKeyPkcs8,
  importEcdsaPrivateKeyPkcs8,
  ecdhSharedSecret,
  ecdsaSign,
  ecdsaVerify,
  hkdfDeriveBytes,
} from './primitives.mjs';

const DOMAIN_IK_BIND = utf8ToBytes('MSG-IK-BIND-v1:');
const DOMAIN_SPK_SIGN = utf8ToBytes('MSG-X3DH-SPK-v1:');
const X3DH_INFO = utf8ToBytes('MSG-X3DH-SHARED-SECRET-v1');
const X3DH_FF_PREFIX = new Uint8Array(32).fill(0xff); // Согласно спецификации X3DH для P-256 / X25519
const ZERO_SALT_32 = new Uint8Array(32);

/** Данные, подписываемые ключом личности для криптографической связки (userId + IK_DH_Pub) */
function buildIdentityBindInput(userId, ikDhPubRaw) {
  return concatBytes(DOMAIN_IK_BIND, utf8ToBytes(String(userId)), utf8ToBytes(':'), ikDhPubRaw);
}

/** Данные, подписываемые ключом личности для SignedPreKey (keyId + SPK_Pub) */
function buildSignedPreKeyInput(keyId, spkPubRaw) {
  return concatBytes(DOMAIN_SPK_SIGN, u32be(keyId), spkPubRaw);
}

/**
 * Генерирует долгосрочную пару ключей личности пользователя:
 * - ikSign (ECDSA P-256) и ikDh (ECDH P-256) с extractable = false по умолчанию.
 * Если задан exportForRecovery = true, возвращает одноразовый PKCS#8 слепок для зашифрованного Recovery Kit
 * и сразу переимпортирует рабочие ключи как extractable = false.
 */
export async function generateIdentity(userId, { exportForRecovery = false } = {}) {
  const rawSign = await generateEcdsaKeyPair({ extractable: exportForRecovery });
  const rawDh = await generateEcdhKeyPair({ extractable: exportForRecovery });

  const ikSignPub = await exportRawPublicKey(rawSign.publicKey);
  const ikDhPub = await exportRawPublicKey(rawDh.publicKey);
  const ikBindSig = await ecdsaSign(rawSign.privateKey, buildIdentityBindInput(userId, ikDhPub));

  let recoveryMaterial = null;
  let ikSignPriv = rawSign.privateKey;
  let ikDhPriv = rawDh.privateKey;

  if (exportForRecovery) {
    const signPkcs8 = await exportPkcs8PrivateKey(rawSign.privateKey);
    const dhPkcs8 = await exportPkcs8PrivateKey(rawDh.privateKey);
    recoveryMaterial = {
      userId,
      ikSignPub: toBase64Url(ikSignPub),
      ikDhPub: toBase64Url(ikDhPub),
      ikBindSig: toBase64Url(ikBindSig),
      ikSignPrivPkcs8: toBase64Url(signPkcs8),
      ikDhPrivPkcs8: toBase64Url(dhPkcs8),
    };
    // Переимпортируем рабочие экземпляры строго с extractable = false!
    ikSignPriv = await importEcdsaPrivateKeyPkcs8(signPkcs8, { extractable: false });
    ikDhPriv = await importEcdhPrivateKeyPkcs8(dhPkcs8, { extractable: false });
    wipe(signPkcs8);
    wipe(dhPkcs8);
  }

  return {
    userId,
    privateKeys: {
      ikSignPriv,
      ikDhPriv,
    },
    publicIdentity: {
      userId,
      ikSignPub: toBase64Url(ikSignPub),
      ikDhPub: toBase64Url(ikDhPub),
      ikBindSig: toBase64Url(ikBindSig),
    },
    recoveryMaterial,
  };
}

/** Восстанавливает неизвлекаемые (extractable: false) CryptoKey личности из расшифрованного Recovery Kit */
export async function restoreIdentityFromRecovery(material) {
  const signPkcs8 = fromBase64Url(material.ikSignPrivPkcs8);
  const dhPkcs8 = fromBase64Url(material.ikDhPrivPkcs8);
  try {
    const ikSignPriv = await importEcdsaPrivateKeyPkcs8(signPkcs8, { extractable: false });
    const ikDhPriv = await importEcdhPrivateKeyPkcs8(dhPkcs8, { extractable: false });
    const publicIdentity = {
      userId: material.userId,
      ikSignPub: material.ikSignPub,
      ikDhPub: material.ikDhPub,
      ikBindSig: material.ikBindSig,
    };
    const valid = await verifyPublicIdentity(publicIdentity);
    if (!valid) throw new Error('Контрольная проверка восстановленных ключей не пройдена');
    return {
      userId: material.userId,
      privateKeys: { ikSignPriv, ikDhPriv },
      publicIdentity,
    };
  } finally {
    wipe(signPkcs8);
    wipe(dhPkcs8);
  }
}

/** Проверяет криптографическую связку публичного ключа личности (защита от подмены DH-половины) */
export async function verifyPublicIdentity(publicIdentity) {
  if (!publicIdentity || !publicIdentity.userId || !publicIdentity.ikSignPub || !publicIdentity.ikDhPub || !publicIdentity.ikBindSig) {
    return false;
  }
  try {
    const signPub = fromBase64Url(publicIdentity.ikSignPub);
    const dhPub = fromBase64Url(publicIdentity.ikDhPub);
    const sig = fromBase64Url(publicIdentity.ikBindSig);
    return await ecdsaVerify(signPub, buildIdentityBindInput(publicIdentity.userId, dhPub), sig);
  } catch {
    return false;
  }
}

/** Генерирует подписанный среднесрочный ключ (SignedPreKey, ротация раз в 7 дней) */
export async function generateSignedPreKey(ikSignPriv, keyId, { extractable = false } = {}) {
  const kp = await generateEcdhKeyPair({ extractable });
  const pubRaw = await exportRawPublicKey(kp.publicKey);
  const sig = await ecdsaSign(ikSignPriv, buildSignedPreKeyInput(keyId, pubRaw));
  return {
    keyId,
    privateKey: kp.privateKey,
    publicKeyRaw: pubRaw,
    publicPreKey: {
      keyId,
      pub: toBase64Url(pubRaw),
      sig: toBase64Url(sig),
      createdAt: Date.now(),
    },
  };
}

/** Генерирует пачку одноразовых ключей (One-Time PreKeys) */
export async function generateOneTimePreKeys(startKeyId, count = 50, { extractable = false } = {}) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const keyId = startKeyId + i;
    const kp = await generateEcdhKeyPair({ extractable });
    const pubRaw = await exportRawPublicKey(kp.publicKey);
    items.push({
      keyId,
      privateKey: kp.privateKey,
      publicPreKey: {
        keyId,
        pub: toBase64Url(pubRaw),
      },
    });
  }
  return items;
}

/** Канонический Associated Data (AD) сессии из публичных ключей обеих сторон */
export function buildSessionAssociatedData(initiatorIdentity, responderIdentity) {
  return concatBytes(
    utf8ToBytes('MSG-SESSION-AD-v1:'),
    utf8ToBytes(initiatorIdentity.userId),
    utf8ToBytes(':'),
    fromBase64Url(initiatorIdentity.ikSignPub),
    fromBase64Url(initiatorIdentity.ikDhPub),
    utf8ToBytes('|'),
    utf8ToBytes(responderIdentity.userId),
    utf8ToBytes(':'),
    fromBase64Url(responderIdentity.ikSignPub),
    fromBase64Url(responderIdentity.ikDhPub)
  );
}

/**
 * Сторона инициатора (Алиса): выполняет X3DH по PreKeyBundle Боба.
 * Проверяет подписи Боба, вычисляет DH1..DH4 и формирует начальный заголовок рукопожатия.
 */
export async function x3dhInitiate({ aliceIdentity, alicePrivateKeys, bobPreKeyBundle }) {
  // 1. Проверяем целостность личности Боба
  const bobIdentityOk = await verifyPublicIdentity(bobPreKeyBundle.identity);
  if (!bobIdentityOk) {
    throw new Error('MITM/Ошибка: недействительная связка ключей личности собеседника');
  }

  // 2. Проверяем подпись SignedPreKey Боба
  const bobSignPub = fromBase64Url(bobPreKeyBundle.identity.ikSignPub);
  const bobDhPub = fromBase64Url(bobPreKeyBundle.identity.ikDhPub);
  const bobSpkPub = fromBase64Url(bobPreKeyBundle.signedPreKey.pub);
  const bobSpkSig = fromBase64Url(bobPreKeyBundle.signedPreKey.sig);

  const spkValid = await ecdsaVerify(
    bobSignPub,
    buildSignedPreKeyInput(bobPreKeyBundle.signedPreKey.keyId, bobSpkPub),
    bobSpkSig
  );
  if (!spkValid) {
    throw new Error('MITM/Ошибка: подпись SignedPreKey собеседника не прошла проверку');
  }

  // 3. Генерируем одноразовый эфемерный ключ инициатора EK_A
  const ekPair = await generateEcdhKeyPair({ extractable: false });
  const ekPubRaw = await exportRawPublicKey(ekPair.publicKey);

  // 4. Вычисляем скалярные произведения X3DH:
  // DH1 = DH(IK_A, SPK_B)
  // DH2 = DH(EK_A, IK_B)
  // DH3 = DH(EK_A, SPK_B)
  // DH4 = DH(EK_A, OPK_B) [если сервер выдал одноразовый OPK]
  const dh1 = await ecdhSharedSecret(alicePrivateKeys.ikDhPriv, bobSpkPub);
  const dh2 = await ecdhSharedSecret(ekPair.privateKey, bobDhPub);
  const dh3 = await ecdhSharedSecret(ekPair.privateKey, bobSpkPub);

  let dh4 = null;
  let usedOpkId = null;
  if (bobPreKeyBundle.oneTimePreKey && bobPreKeyBundle.oneTimePreKey.pub) {
    const bobOpkPub = fromBase64Url(bobPreKeyBundle.oneTimePreKey.pub);
    dh4 = await ecdhSharedSecret(ekPair.privateKey, bobOpkPub);
    usedOpkId = bobPreKeyBundle.oneTimePreKey.keyId;
  }

  const ikm = dh4
    ? concatBytes(X3DH_FF_PREFIX, dh1, dh2, dh3, dh4)
    : concatBytes(X3DH_FF_PREFIX, dh1, dh2, dh3);

  try {
    const sharedSecret = await hkdfDeriveBytes(ikm, ZERO_SALT_32, X3DH_INFO, 32);
    const associatedData = buildSessionAssociatedData(aliceIdentity, bobPreKeyBundle.identity);

    return {
      sharedSecret,
      associatedData,
      remoteRatchetPubRaw: bobSpkPub,
      handshake: {
        v: 1,
        initiatorIdentity: aliceIdentity,
        ekPub: toBase64Url(ekPubRaw),
        spkId: bobPreKeyBundle.signedPreKey.keyId,
        opkId: usedOpkId,
      },
    };
  } finally {
    wipe(dh1);
    wipe(dh2);
    wipe(dh3);
    if (dh4) wipe(dh4);
    wipe(ikm);
  }
}

/**
 * Сторона получателя (Боб): принимает заголовок X3DH от Алисы,
 * проверяет её личность и вычисляет идентичный 32-байтный sharedSecret.
 */
export async function x3dhRespond({
  bobIdentity,
  bobPrivateKeys,
  bobSignedPreKey,
  bobOneTimePreKey = null,
  handshake,
}) {
  if (!handshake || handshake.v !== 1) {
    throw new Error('Неподдерживаемая версия заголовка X3DH');
  }
  const aliceIdentityOk = await verifyPublicIdentity(handshake.initiatorIdentity);
  if (!aliceIdentityOk) {
    throw new Error('MITM/Ошибка: недействительная связка ключей личности отправителя');
  }
  if (handshake.spkId !== bobSignedPreKey.keyId) {
    throw new Error(`Неизвестный идентификатор SignedPreKey: ${handshake.spkId}`);
  }
  if (handshake.opkId !== null && handshake.opkId !== undefined) {
    if (!bobOneTimePreKey || bobOneTimePreKey.keyId !== handshake.opkId) {
      throw new Error(`Одноразовый ключ OPK #${handshake.opkId} отсутствует или уже погашен`);
    }
  }

  const aliceIkDhPub = fromBase64Url(handshake.initiatorIdentity.ikDhPub);
  const aliceEkPub = fromBase64Url(handshake.ekPub);

  const dh1 = await ecdhSharedSecret(bobSignedPreKey.privateKey, aliceIkDhPub);
  const dh2 = await ecdhSharedSecret(bobPrivateKeys.ikDhPriv, aliceEkPub);
  const dh3 = await ecdhSharedSecret(bobSignedPreKey.privateKey, aliceEkPub);
  const dh4 = bobOneTimePreKey
    ? await ecdhSharedSecret(bobOneTimePreKey.privateKey, aliceEkPub)
    : null;

  const ikm = dh4
    ? concatBytes(X3DH_FF_PREFIX, dh1, dh2, dh3, dh4)
    : concatBytes(X3DH_FF_PREFIX, dh1, dh2, dh3);

  try {
    const sharedSecret = await hkdfDeriveBytes(ikm, ZERO_SALT_32, X3DH_INFO, 32);
    const associatedData = buildSessionAssociatedData(handshake.initiatorIdentity, bobIdentity);
    return {
      sharedSecret,
      associatedData,
    };
  } finally {
    wipe(dh1);
    wipe(dh2);
    wipe(dh3);
    if (dh4) wipe(dh4);
    wipe(ikm);
  }
}
