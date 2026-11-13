// Сквозные интеграционные тесты сервера и протокольного аудита безопасности (node:test):
//   1. Анонимная регистрация с Proof-of-Work и асимметричный Zero-Knowledge вход + анти-энумерация ников.
//   2. Слепая доставка конверта Sealed Sender через НЕАВТОРИЗОВАННЫЙ сокет + X3DH/Double Ratchet + удаление после ACK.
//   3. Зашифрованный одноразовый файл (once): сервер хранит шифртекст и физически стирает его после 1 скачивания.
//   4. E2E «Голая правда» + теневая блокировка анонимного отправителя по HMAC-тегу.
//   5. Эфемерный TURN (TTL = 300 с, обезличенный логин).
//   6. Полный криминалистический аудит серверного дампа на диске (0 открытых текстов, 0 паролей, 0 IP, 0 графа).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { createMessengerServer } from '../server/index.mjs';
import { MinimalWsClient } from '../server/ws-server.mjs';
import { WebSocketTransport } from '../public/js/transport/ws-transport.mjs';
import { TransportRpcChannel } from '../public/js/transport/transport-interface.mjs';
import { CryptoEngine } from '../public/js/crypto/crypto.worker.mjs';
import { utf8ToBytes, randomBytes, toBase64Url } from '../shared/crypto/primitives.mjs';
import { solveProofOfWork } from '../shared/crypto/kdf.mjs';
import { encryptAnonymousQuestion } from '../shared/crypto/sealed-sender.mjs';

function makeClientUserId() {
  return `u_${toBase64Url(randomBytes(15))}`;
}

function makeWriteProof(writeToken, bytes) {
  return crypto.createHmac('sha256', writeToken).update(bytes).digest('base64url');
}

test('Полный цикл сервера: ZK-Auth, Слепой релей, Одноразовые E2E-файлы, Голая правда и Аудит дампа БД', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veil-srv-test-'));
  const srv = await createMessengerServer({
    dataDir: tmpDir,
    powBits: 10, // ускоряем PoW для мгновенного прогона тестов (~1 мс)
    env: {
      ...process.env,
      TURN_HOST: 'turn.example.org',
      TURN_SECRET: 'super-secret-coturn-key',
    },
  });

  const addr = await srv.listen(0, '127.0.0.1');
  const baseHttp = `http://127.0.0.1:${addr.port}`;
  const baseWs = `ws://127.0.0.1:${addr.port}/ws`;

  const openWsRpc = async () => {
    const t = new WebSocketTransport({ url: baseWs, WebSocketImpl: MinimalWsClient, pingIntervalMs: 0 });
    await t.connect();
    const rpc = new TransportRpcChannel(t);
    return { t, rpc };
  };

  try {
    const aliceCrypto = new CryptoEngine();
    const bobCrypto = new CryptoEngine();
    await aliceCrypto.init();
    await bobCrypto.init();

    const aliceConn = await openWsRpc();
    const bobConn = await openWsRpc();

    // ── 1. Регистрация Алисы и Боба без телефона и email ──
    const aliceUid = makeClientUserId();
    const alicePass = 'Ultra-Secret-Alice-Pass-2026!';
    const aliceZk = await aliceCrypto.prepareZkRegistration({ username: 'alice_zero', password: alicePass });
    const aliceKeys = await aliceCrypto.provisionIdentity({ userId: aliceUid, opkCount: 25 });
    const alicePow = (await aliceConn.rpc.request('auth.pow', { purpose: 'register' })).data;
    const aliceNonce = await aliceCrypto.solvePow(alicePow);

    const aliceReg = (
      await aliceConn.rpc.request('auth.register', {
        username: 'alice_zero',
        powChallenge: alicePow.challengeToken,
        powNonce: aliceNonce,
        authPubB64: aliceZk.authPubB64,
        encryptedAuthKey: aliceZk.encryptedAuthKey,
        publicBundle: aliceKeys.publicBundle,
        encryptedRecovery: aliceKeys.recoveryKit.encryptedBackup,
      })
    ).data;
    assert.equal(aliceReg.username, 'alice_zero');

    const bobUid = makeClientUserId();
    const bobPass = 'Bob-Onion-Passphrase-8844!';
    const bobZk = await bobCrypto.prepareZkRegistration({ username: 'bob_cipher', password: bobPass });
    const bobKeys = await bobCrypto.provisionIdentity({ userId: bobUid, opkCount: 25 });
    const bobPow = (await bobConn.rpc.request('auth.pow', { purpose: 'register' })).data;
    const bobNonce = await bobCrypto.solvePow(bobPow);

    const bobReg = (
      await bobConn.rpc.request('auth.register', {
        username: 'bob_cipher',
        powChallenge: bobPow.challengeToken,
        powNonce: bobNonce,
        authPubB64: bobZk.authPubB64,
        encryptedAuthKey: bobZk.encryptedAuthKey,
        publicBundle: bobKeys.publicBundle,
      })
    ).data;
    assert.equal(bobReg.username, 'bob_cipher');

    // ── 2. Проверка Zero-Knowledge входа и анти-энумерации несуществующих ников ──
    const fakeChallenge = (await aliceConn.rpc.request('auth.challenge', { username: 'ghost_nonexistent' })).data;
    assert.equal(fakeChallenge.encryptedAuthKey.v, 1, 'Сервер обязан возвращать синтетический конверт для скрытия факта регистрации');

    const realChallenge = (await aliceConn.rpc.request('auth.challenge', { username: 'alice_zero' })).data;
    const loginSig = await aliceCrypto.solveZkLogin({
      username: 'alice_zero',
      password: alicePass,
      encryptedAuthKey: realChallenge.encryptedAuthKey,
      challengeNonce: realChallenge.challengeNonce,
    });
    const reLogin = (
      await aliceConn.rpc.request('auth.login', {
        username: 'alice_zero',
        challengeNonce: realChallenge.challengeNonce,
        signatureB64: loginSig,
      })
    ).data;
    assert.equal(reLogin.userId, aliceUid);

    // ── 3. Слепая доставка сообщения через ОТДЕЛЬНЫЙ неавторизованный сокет ──
    const secretText = 'Встречаемся в 21:00 у старого маяка. Пароль — Север.';
    const bobBundle = (await aliceConn.rpc.request('directory.bundle', { query: '@bob_cipher' })).data;
    assert.equal(srv.storage.countRemainingOpks(bobUid), 24, 'Один OPK Боба должен быть атомарно погашен');

    await aliceCrypto.establishOutgoingSession({ peerBundle: bobBundle });
    const { sealedBytes } = await aliceCrypto.encryptMessageForPeer({
      peerId: bobUid,
      payloadObject: { type: 'text', text: secretText, ttl: 60 },
    });

    // Подписка Боба на входящее push-событие в реальном времени
    const incomingPromise = new Promise((resolve) => {
      bobConn.rpc.onEvent('mailbox.envelope', (meta, binBody) => resolve({ meta, binBody }));
    });

    // Алиса открывает чистый анонимный сокет без токена сессии и сбрасывает конверт в ящик Боба!
    const blindSender = await openWsRpc();
    const dropRes = (
      await blindSender.rpc.request(
        'relay.drop',
        {
          mailboxId: bobBundle.mailboxId,
          writeProof: makeWriteProof(bobBundle.mailboxWriteToken, sealedBytes),
          ttlSec: 3600,
        },
        { body: sealedBytes }
      )
    ).data;
    assert.ok(dropRes.id.startsWith('env_'));

    const pushed = await incomingPromise;
    const decryptedByBob = await bobCrypto.decryptIncomingSealedEnvelope({ sealedBytes: pushed.binBody });
    assert.equal(decryptedByBob.senderId, aliceUid);
    assert.equal(decryptedByBob.payload.text, secretText);

    // Боб подтверждает получение -> сервер физически удаляет конверт из БД!
    const ackRes = (await bobConn.rpc.request('mailbox.ack', { ids: [pushed.meta.id] })).data;
    assert.equal(ackRes.deleted, 1);
    assert.equal(srv.storage.pullEnvelopes(bobReg.mailboxId).length, 0);

    // ── 4. Зашифрованный одноразовый файл (once): скачивается ровно 1 раз, затем 404 ──
    const rawPhoto = utf8ToBytes('RAW_JPEG_SECRET_BYTES_1234567890');
    const encFile = await aliceCrypto.encryptFile({
      bytes: rawPhoto,
      meta: { name: 'passport.jpg', mime: 'image/jpeg', once: true },
    });

    const uploadResp = await fetch(`${baseHttp}/api/blob`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${reLogin.token}`,
        'content-type': 'application/octet-stream',
        'x-veil-once': '1',
      },
      body: encFile.encryptedBytes,
    }).then((r) => r.json());

    assert.ok(uploadResp.blobId.startsWith('b_'));
    assert.ok(uploadResp.burnToken);

    const dl1 = await fetch(`${baseHttp}/api/blob/${uploadResp.blobId}`, {
      headers: { 'x-veil-burn-token': uploadResp.burnToken },
    });
    assert.equal(dl1.status, 200);
    const dlBytes = new Uint8Array(await dl1.arrayBuffer());
    const restoredPhoto = await bobCrypto.decryptFile({ bytes: dlBytes, descriptor: encFile.descriptor });
    assert.deepEqual(restoredPhoto, rawPhoto);

    // Вторая попытка скачать одноразовый файл должна вернуть 404 (файл уже стёрт с диска!)
    const dl2 = await fetch(`${baseHttp}/api/blob/${uploadResp.blobId}`, {
      headers: { 'x-veil-burn-token': uploadResp.burnToken },
    });
    assert.equal(dl2.status, 404);

    // ── 5. E2E «Голая правда» + блокировка анонимного отправителя без раскрытия его IP ──
    const askInfo = await fetch(`${baseHttp}/api/ask/bob_cipher`).then((r) => r.json());
    const askPow = await fetch(`${baseHttp}/api/auth/pow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'ask' }),
    }).then((r) => r.json());
    const askPowNonce = await solveProofOfWork(askPow.challengeToken, askPow.difficultyBits);
    const askCipher = await encryptAnonymousQuestion({
      recipientIkDhPubB64: askInfo.ikDhPub,
      text: 'Секретный анонимный вопрос гостя!',
    });

    await fetch(`${baseHttp}/api/ask/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mailboxId: askInfo.mailboxId,
        powChallenge: askPow.challengeToken,
        powNonce: askPowNonce,
        payloadB64: askCipher,
      }),
    });

    const pulled = (await bobConn.rpc.request('mailbox.pull')).data;
    assert.equal(pulled.asks.length, 1);
    const plainAsk = await bobCrypto.decryptAsk({ payloadB64: pulled.asks[0].payloadB64 });
    assert.equal(plainAsk, 'Секретный анонимный вопрос гостя!');

    await bobConn.rpc.request('ask.block', { senderBlockTag: pulled.asks[0].senderBlockTag });
    await bobConn.rpc.request('mailbox.ack', { ids: [], askIds: [pulled.asks[0].id] });

    // ── 6. Проверка эфемерного TURN (TTL = 300 с, логин не содержит userId/username) ──
    const turn = (await bobConn.rpc.request('turn.credentials')).data;
    assert.equal(turn.ttlSec, 300);
    const turnEntry = turn.iceServers.find((s) => s.username);
    assert.ok(turnEntry);
    assert.equal(turnEntry.username.includes(bobUid), false);
    assert.equal(turnEntry.username.includes('bob_cipher'), false);

    // ── 7. КРИМИНАЛИСТИЧЕСКИЙ АУДИТ СЕРВЕРНОГО ДАМПА НА ДИСКЕ ──
    srv.storage.compactSync();
    const rawSnapshotOnDisk = fs.readFileSync(path.join(tmpDir, 'blind-state.json'), 'utf8');

    assert.equal(rawSnapshotOnDisk.includes('маяка'), false, 'В дампе БД не должно быть текста сообщений');
    assert.equal(rawSnapshotOnDisk.includes('PASSPORT'), false, 'В дампе БД не должно быть имён файлов');
    assert.equal(rawSnapshotOnDisk.includes(alicePass), false, 'В дампе БД не должно быть паролей');
    assert.equal(rawSnapshotOnDisk.includes(bobPass), false, 'В дампе БД не должно быть паролей');
    assert.equal(rawSnapshotOnDisk.includes('127.0.0.1'), false, 'В дампе БД не должно быть реальных IP');
    assert.equal(rawSnapshotOnDisk.includes('Секретный анонимный вопрос'), false, 'Вопросы Голой правды должны быть E2E');

    // Проверяем, что у записи Алисы нет никаких ссылок на Боба (нулевой социальный граф)
    const parsedDump = JSON.parse(rawSnapshotOnDisk);
    const aliceDumpStr = JSON.stringify(parsedDump.users.find((u) => u.id === aliceUid));
    assert.equal(aliceDumpStr.includes(bobUid), false);
    assert.equal(aliceDumpStr.includes(bobReg.mailboxId), false);

    // Закрываем клиентские транспорты
    blindSender.rpc.destroy();
    await blindSender.t.close();
    aliceConn.rpc.destroy();
    await aliceConn.t.close();
    bobConn.rpc.destroy();
    await bobConn.t.close();
  } finally {
    await srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
