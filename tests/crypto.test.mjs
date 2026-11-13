// Автотесты криптографического ядра (node:test):
// KDF (Argon2id + scrypt N=2^17), X3DH, Double Ratchet (включая рассинхрон и replay),
// Sealed Sender, паддинг против анализа трафика, E2E-файлы, Safety Numbers и изоляция CryptoEngine.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  utf8ToBytes,
  bytesToUtf8,
  padPayload,
  unpadPayload,
  toBase64Url,
  fromBase64Url,
  deriveAccountKeys,
  computeAuthChallengeProof,
  generateRecoveryKey,
  encryptRecoveryBundle,
  decryptRecoveryBundle,
  generateIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  x3dhInitiate,
  x3dhRespond,
  DoubleRatchetSession,
  sealSenderEnvelope,
  unsealSenderEnvelope,
  encryptFileForUpload,
  decryptDownloadedFile,
  encryptAnonymousQuestion,
  decryptAnonymousQuestion,
  computeSafetyNumber,
} from '../shared/crypto/index.mjs';
import { CryptoEngine } from '../public/js/crypto/crypto.worker.mjs';
import { CryptoKeyStore } from '../public/js/crypto/keystore-idb.mjs';

test('1. Паддинг ISO/IEC 7816-4 скрывает реальную длину коротких и средних сообщений', () => {
  const shortMsg = padPayload(utf8ToBytes('ок'));
  const mediumMsg = padPayload(utf8ToBytes('Встречаемся у северного выхода ровно в 19:30, никому не пиши.'));
  assert.equal(shortMsg.byteLength, 512);
  assert.equal(mediumMsg.byteLength, 512);
  assert.equal(bytesToUtf8(unpadPayload(shortMsg)), 'ок');
  assert.equal(
    bytesToUtf8(unpadPayload(mediumMsg)),
    'Встречаемся у северного выхода ровно в 19:30, никому не пиши.'
  );
});

test('2. KDF: Argon2id (64 MiB) и scrypt (N=2^17) выводят независимые authKey/localWrapKey + Recovery Kit', async () => {
  const a1 = await deriveAccountKeys('Alice_Anon', 'Correct-Horse-Battery-99!', { algorithm: 'argon2id' });
  const a2 = await deriveAccountKeys('@alice_anon', 'Correct-Horse-Battery-99!', { algorithm: 'argon2id' });

  assert.equal(a1.kdfInfo.algorithm, 'argon2id');
  assert.deepEqual(a1.authKey, a2.authKey, 'Нормализация username должна давать идентичный ключ');
  assert.notDeepEqual(a1.authKey, a1.localWrapKey, 'authKey и localWrapKey обязаны быть независимыми');

  const proof = await computeAuthChallengeProof(a1.authKey, 'server_nonce_12345', 'alice_anon');
  assert.equal(typeof proof, 'string');
  assert.ok(proof.length >= 40);

  // Проверка резервного scrypt с N=2^17, r=8, p=1
  const s1 = await deriveAccountKeys('bob_tor', 'Tor-Browser-Safest-Pass-2026', { algorithm: 'scrypt' });
  assert.equal(s1.kdfInfo.algorithm, 'scrypt');
  assert.equal(s1.kdfInfo.N, 131072);
  assert.equal(s1.authKey.byteLength, 32);

  // Проверка шифрования и восстановления Recovery Kit
  const rk = generateRecoveryKey();
  const encrypted = await encryptRecoveryBundle({ secretSeed: 'demo-123' }, rk);
  const restored = await decryptRecoveryBundle(encrypted, rk);
  assert.deepEqual(restored, { secretSeed: 'demo-123' });
});

test('3. X3DH: успешное рукопожатие, совпадение секретов и защита от MITM подмены SPK', async () => {
  const alice = await generateIdentity('u_alice');
  const bob = await generateIdentity('u_bob');
  assert.equal(alice.privateKeys.ikSignPriv.extractable, false);
  assert.equal(alice.privateKeys.ikDhPriv.extractable, false);

  const bobSpk = await generateSignedPreKey(bob.privateKeys.ikSignPriv, 7);
  const bobOpks = await generateOneTimePreKeys(100, 2);

  const bobBundle = {
    identity: bob.publicIdentity,
    signedPreKey: bobSpk.publicPreKey,
    oneTimePreKey: bobOpks[0].publicPreKey,
  };

  const initOut = await x3dhInitiate({
    aliceIdentity: alice.publicIdentity,
    alicePrivateKeys: alice.privateKeys,
    bobPreKeyBundle: bobBundle,
  });

  const respOut = await x3dhRespond({
    bobIdentity: bob.publicIdentity,
    bobPrivateKeys: bob.privateKeys,
    bobSignedPreKey: bobSpk,
    bobOneTimePreKey: bobOpks[0],
    handshake: initOut.handshake,
  });

  assert.deepEqual(initOut.sharedSecret, respOut.sharedSecret);
  assert.deepEqual(initOut.associatedData, respOut.associatedData);

  // Сценарий атаки: вредоносный сервер подменяет публичный ключ SPK Боба своим ключом
  const mallory = await generateIdentity('u_mallory');
  const mallorySpk = await generateSignedPreKey(mallory.privateKeys.ikSignPriv, 7);
  const tamperedBundle = {
    identity: bob.publicIdentity,
    signedPreKey: {
      keyId: 7,
      pub: mallorySpk.publicPreKey.pub,
      sig: bobSpk.publicPreKey.sig, // старая подпись Боба не подойдёт к ключу Мэллори
    },
  };
  await assert.rejects(
    () =>
      x3dhInitiate({
        aliceIdentity: alice.publicIdentity,
        alicePrivateKeys: alice.privateKeys,
        bobPreKeyBundle: tamperedBundle,
      }),
    /MITM/
  );
});

test('4. Double Ratchet: двусторонний диалог, доставка не по порядку и защита от Replay-атак', async () => {
  const alice = await generateIdentity('u_alice');
  const bob = await generateIdentity('u_bob');
  const bobSpk = await generateSignedPreKey(bob.privateKeys.ikSignPriv, 1);

  const initX3dh = await x3dhInitiate({
    aliceIdentity: alice.publicIdentity,
    alicePrivateKeys: alice.privateKeys,
    bobPreKeyBundle: { identity: bob.publicIdentity, signedPreKey: bobSpk.publicPreKey },
  });
  const respX3dh = await x3dhRespond({
    bobIdentity: bob.publicIdentity,
    bobPrivateKeys: bob.privateKeys,
    bobSignedPreKey: bobSpk,
    handshake: initX3dh.handshake,
  });

  const aliceDr = await DoubleRatchetSession.initAsInitiator({
    sharedSecret: initX3dh.sharedSecret,
    associatedData: initX3dh.associatedData,
    remoteRatchetPubRaw: initX3dh.remoteRatchetPubRaw,
  });
  const bobDr = await DoubleRatchetSession.initAsResponder({
    sharedSecret: respX3dh.sharedSecret,
    associatedData: respX3dh.associatedData,
    localRatchetPrivateKey: bobSpk.privateKey,
    localRatchetPubRaw: bobSpk.publicKeyRaw,
  });

  // Алиса отправляет 3 сообщения подряд; они приходят Бобу в порядке 3 -> 1 -> 2 (переключение WS -> Tor)
  const m1 = await aliceDr.encrypt('Первое сообщение');
  const m2 = await aliceDr.encrypt('Второе сообщение');
  const m3 = await aliceDr.encrypt('Третье сообщение');

  assert.equal(bytesToUtf8(await bobDr.decrypt(m3)), 'Третье сообщение');
  assert.equal(bytesToUtf8(await bobDr.decrypt(m1)), 'Первое сообщение');
  assert.equal(bytesToUtf8(await bobDr.decrypt(m2)), 'Второе сообщение');

  // Повторная отправка перехваченного пакета m2 должна быть отвергнута (Forward Secrecy: ключ уже стёрт)
  await assert.rejects(() => bobDr.decrypt(m2), /отвергнута|Не удалось|decrypt/i);

  // Боб отвечает Алисе -> происходит полный шаг DH-храповика (Post-Compromise Security)
  const reply1 = await bobDr.encrypt('Ответ Боба через Tor');
  assert.equal(bytesToUtf8(await aliceDr.decrypt(reply1)), 'Ответ Боба через Tor');
});

test('5. Sealed Sender + Safety Numbers + E2E-файлы + «Голая правда» + полный цикл CryptoEngine', async () => {
  const aliceStore = new CryptoKeyStore();
  const bobStore = new CryptoKeyStore();

  // Проверяем, что хранилище запрещает сохранять извлекаемый приватный ключ
  const badExtractable = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  await assert.rejects(() => aliceStore.putNativeKey('bad', badExtractable.privateKey), /extractable=false/);

  const aliceEngine = new CryptoEngine(aliceStore);
  const bobEngine = new CryptoEngine(bobStore);
  await aliceEngine.init();
  await bobEngine.init();

  const aliceProv = await aliceEngine.provisionIdentity({ userId: 'u_alice', opkCount: 5 });
  const bobProv = await bobEngine.provisionIdentity({ userId: 'u_bob', opkCount: 5 });

  // Алиса открывает сессию к Бобу, используя его OPK #1
  const bobBundleForAlice = {
    identity: bobProv.publicBundle.identity,
    signedPreKey: bobProv.publicBundle.signedPreKey,
    oneTimePreKey: bobProv.publicBundle.oneTimePreKeys[0],
  };

  const { safetyNumber: snAlice } = await aliceEngine.establishOutgoingSession({ peerBundle: bobBundleForAlice });

  // Алиса шлёт 2 сообщения подряд до того, как Боб вышел в сеть
  const env1 = await aliceEngine.encryptMessageForPeer({
    peerId: 'u_bob',
    payloadObject: { type: 'text', text: 'Привет! Сервер не знает, что это от меня.' },
  });
  const env2 = await aliceEngine.encryptMessageForPeer({
    peerId: 'u_bob',
    payloadObject: { type: 'text', text: 'И второе сообщение вдогонку.' },
  });

  // Боб расшифровывает оба конверта Sealed Sender
  const dec1 = await bobEngine.decryptIncomingSealedEnvelope({ sealedBytes: env1.sealedBytes });
  const dec2 = await bobEngine.decryptIncomingSealedEnvelope({ sealedBytes: env2.sealedBytes });
  assert.equal(dec1.senderId, 'u_alice');
  assert.equal(dec1.payload.text, 'Привет! Сервер не знает, что это от меня.');
  assert.equal(dec2.payload.text, 'И второе сообщение вдогонку.');

  // Сравниваем Safety Number (60 цифр и 8 эмодзи) у Алисы и Боба
  const snBob = await bobEngine.getSafetyNumber({ peerId: 'u_alice' });
  assert.equal(snAlice.digits, snBob.digits);
  assert.equal(snAlice.emojiText, snBob.emojiText);
  assert.equal(snAlice.digits.replace(/\s+/g, '').length, 60);
  assert.equal(snAlice.emojis.length, 8);

  // Проверяем клиентское E2E-шифрование файла и защиту от подмены байта на сервере
  const sampleFile = utf8ToBytes('Секретный чертёж мессенджера v1.0');
  const { encryptedBytes, descriptor } = await aliceEngine.encryptFile({
    bytes: sampleFile,
    meta: { name: 'blueprint.txt', mime: 'text/plain', once: true },
  });
  assert.notDeepEqual(encryptedBytes, sampleFile);
  const decryptedFile = await bobEngine.decryptFile({ bytes: encryptedBytes, descriptor });
  assert.deepEqual(decryptedFile, sampleFile);

  const corrupted = new Uint8Array(encryptedBytes);
  corrupted[5] ^= 0xff;
  await assert.rejects(() => bobEngine.decryptFile({ bytes: corrupted, descriptor }), /Контрольная сумма/);

  // Проверяем E2E для анонимного вопроса «Голая правда»
  const askCipher = await encryptAnonymousQuestion({
    recipientIkDhPubB64: bobProv.publicBundle.identity.ikDhPub,
    text: 'Кто на самом деле написал этот код?',
  });
  const askPlain = await bobEngine.decryptAsk({ payloadB64: askCipher });
  assert.equal(askPlain, 'Кто на самом деле написал этот код?');
});
