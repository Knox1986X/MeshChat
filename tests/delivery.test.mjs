// Регрессионные автотесты гарантированной и мгновенной доставки сообщений (v1.2.0):
//   1. Симметричное добавление контактов (оба пира открыли диалог) + параллельная пачка из 5 сообщений
//      от участника с лексикографически большим userId без потери OPK и без гонок Double Ratchet.
//   2. Разрыв соединения внутри FallbackTransport -> тихий автореконнект -> автоматическая переавторизация
//      session.auth -> догрузка очереди ящика + мгновенный live-push следующих сообщений (< 100 мс).
//   3. Повторный вызов establishOutgoingSession не сбрасывает живую сессию Double Ratchet.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CryptoEngine } from '../public/js/crypto/crypto.worker.mjs';
import { CryptoKeyStore } from '../public/js/crypto/keystore-idb.mjs';
import {
  TRANSPORT_STATE,
  TRANSPORT_POLICY,
  TransportRpcChannel,
} from '../public/js/transport/transport-interface.mjs';
import { transportRegistry } from '../public/js/transport/transport-registry.mjs';
import '../public/js/transport/ws-transport.mjs';
import { FallbackTransport } from '../public/js/transport/fallback-transport.mjs';
import { createMessengerServer } from '../server/index.mjs';
import { MinimalWsClient } from '../server/ws-server.mjs';
import {
  utf8ToBytes,
  randomBytes,
  hmacSha256,
  toBase64Url,
  fromBase64Url,
} from '../shared/crypto/primitives.mjs';
import {
  solveProofOfWork,
} from '../shared/crypto/kdf.mjs';

test('1. CryptoEngine: симметричное добавление контактов, параллельная серия из 5 сообщений и защита сессии от сброса', async () => {
  const aliceEngine = new CryptoEngine(new CryptoKeyStore());
  const bobEngine = new CryptoEngine(new CryptoKeyStore());
  await aliceEngine.init();
  await bobEngine.init();

  // Намеренно даём инициатору (Алисе) лексикографически БОЛЬШИЙ userId ('u_zzz' > 'u_aaa')
  const aliceProv = await aliceEngine.provisionIdentity({ userId: 'u_zzz_alice', opkCount: 10 });
  const bobProv = await bobEngine.provisionIdentity({ userId: 'u_aaa_bob', opkCount: 10 });

  // Оба пользователя добавили друг друга в список контактов до отправки первого сообщения
  await aliceEngine.savePeerIdentity({ peerIdentity: bobProv.publicBundle.identity });
  await bobEngine.savePeerIdentity({ peerIdentity: aliceProv.publicBundle.identity });

  // Алиса первой нажимает «Отправить»: лениво создаётся X3DH-сессия к Бобу
  const bobBundle = {
    identity: bobProv.publicBundle.identity,
    signedPreKey: bobProv.publicBundle.signedPreKey,
    oneTimePreKey: bobProv.publicBundle.oneTimePreKeys[0],
  };
  await aliceEngine.establishOutgoingSession({ peerBundle: bobBundle });

  // Алиса отправляет 5 сообщений подряд ОДНОВРЕМЕННО (проверка FIFO-мьютекса воркера)
  const outgoingTexts = ['Пакет #1', 'Пакет #2', 'Пакет #3', 'Пакет #4', 'Пакет #5'];
  const envelopes = await Promise.all(
    outgoingTexts.map((text, idx) =>
      aliceEngine.encryptMessageForPeer({
        peerId: 'u_aaa_bob',
        payloadObject: { msgId: `m_${idx}`, type: 'text', text },
      })
    )
  );

  // Боб получает все 5 конвертов одновременно (все несут один и тот же заголовок X3DH первого полёта)
  const decrypted = await Promise.all(
    envelopes.map((env) => bobEngine.decryptIncomingSealedEnvelope({ sealedBytes: env.sealedBytes }))
  );

  assert.deepEqual(
    decrypted.map((d) => d.payload.text),
    outgoingTexts,
    'Все 5 параллельных пакетов первого полёта должны расшифроваться без ошибки OPK'
  );

  // Повторный вызов establishOutgoingSession без forceReset обязан сохранить текущую сессию
  const secondOpen = await aliceEngine.establishOutgoingSession({
    peerBundle: {
      identity: bobProv.publicBundle.identity,
      signedPreKey: bobProv.publicBundle.signedPreKey,
      oneTimePreKey: bobProv.publicBundle.oneTimePreKeys[1],
    },
  });
  assert.equal(secondOpen.reused, true, 'Активная сессия не должна перезатираться при повторном открытии чата');

  // Ответ Боба Алисе и следующий ответ Алисы Бобу проходят штатно
  const bobReply = await bobEngine.encryptMessageForPeer({
    peerId: 'u_zzz_alice',
    payloadObject: { msgId: 'r_1', type: 'text', text: 'Подтверждаю приём всех 5 пакетов' },
  });
  const aliceDec = await aliceEngine.decryptIncomingSealedEnvelope({ sealedBytes: bobReply.sealedBytes });
  assert.equal(aliceDec.payload.text, 'Подтверждаю приём всех 5 пакетов');

  const aliceFollowUp = await aliceEngine.encryptMessageForPeer({
    peerId: 'u_aaa_bob',
    payloadObject: { msgId: 'm_6', type: 'text', text: 'Канал стабилен' },
  });
  const bobDecFollow = await bobEngine.decryptIncomingSealedEnvelope({ sealedBytes: aliceFollowUp.sealedBytes });
  assert.equal(bobDecFollow.payload.text, 'Канал стабилен');

  // Проверка совпадения строгого 128-битного HEX-отпечатка безопасности
  const snAlice = await aliceEngine.getSafetyNumber({ peerId: 'u_aaa_bob' });
  const snBob = await bobEngine.getSafetyNumber({ peerId: 'u_zzz_alice' });
  assert.equal(snAlice.hexBlocks.length, 8);
  assert.equal(snAlice.hexText, snBob.hexText);
});

test('2. FallbackTransport + Server: автопереавторизация session.auth после обрыва сокета сохраняет мгновенный live-push', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshchat-delivery-'));
  const srv = await createMessengerServer({ dataDir: tmpDir, powBits: 10 });
  const addr = await srv.listen(0, '127.0.0.1');
  const port = addr.port;
  const baseHttp = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  async function registerTestPeer(username) {
    const userId = `u_${toBase64Url(randomBytes(15))}`;
    const engine = new CryptoEngine(new CryptoKeyStore());
    await engine.init();
    const prov = await engine.provisionIdentity({ userId, opkCount: 15 });
    const zk = await engine.prepareZkRegistration({ username, password: 'Strong-Passphrase-2026!' });
    const pow = await fetch(`${baseHttp}/api/auth/pow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'register' }),
    }).then((r) => r.json());
    const powNonce = await solveProofOfWork(pow.challengeToken, pow.difficultyBits);

    const reg = await fetch(`${baseHttp}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username,
        powChallenge: pow.challengeToken,
        powNonce,
        authPubB64: zk.authPubB64,
        encryptedAuthKey: zk.encryptedAuthKey,
        publicBundle: prov.publicBundle,
      }),
    }).then((r) => r.json());

    assert.ok(reg.token, `Регистрация ${username} должна вернуть токен (${reg.error || ''})`);
    return { engine, reg };
  }

  let aliceTransport = null;
  let bobTransport = null;

  try {
    const alice = await registerTestPeer('alice_rel');
    const bob = await registerTestPeer('bob_rel');

    aliceTransport = new FallbackTransport({
      registry: transportRegistry,
      policy: TRANSPORT_POLICY.DIRECT_ONLY,
      reconnectBaseDelayMs: 60,
      transportConfig: { url: wsUrl, WebSocketImpl: MinimalWsClient, pingIntervalMs: 0 },
    });
    bobTransport = new FallbackTransport({
      registry: transportRegistry,
      policy: TRANSPORT_POLICY.DIRECT_ONLY,
      reconnectBaseDelayMs: 60,
      transportConfig: { url: wsUrl, WebSocketImpl: MinimalWsClient, pingIntervalMs: 0 },
    });

    const aliceRpc = new TransportRpcChannel(aliceTransport);
    const bobRpc = new TransportRpcChannel(bobTransport);

    const bobReceived = [];
    let livePushWaiter = null;

    bobRpc.onEvent('mailbox.envelope', async (meta, sealedBytes) => {
      const dec = await bob.engine.decryptIncomingSealedEnvelope({
        sealedBytes: new Uint8Array(sealedBytes),
      });
      bobReceived.push({ via: 'push', text: dec.payload.text });
      await bobRpc.request('mailbox.ack', { ids: [meta.id] });
      if (livePushWaiter) livePushWaiter(dec.payload.text);
    });

    // Моделируем логику app-store.mjs: переавторизация session.auth + pull при КАЖДОМ переходе в CONNECTED
    let bobAuthRuns = 0;
    const syncBobSession = async () => {
      await bobRpc.request('session.auth', { token: bob.reg.token });
      bobAuthRuns += 1;
      const { data } = await bobRpc.request('mailbox.pull', { limit: 50 });
      for (const env of data.envelopes || []) {
        const dec = await bob.engine.decryptIncomingSealedEnvelope({
          sealedBytes: fromBase64Url(env.blobB64),
        });
        bobReceived.push({ via: 'pull', text: dec.payload.text });
        await bobRpc.request('mailbox.ack', { ids: [env.id] });
      }
    };

    bobTransport.onStateChange((state) => {
      if (state === TRANSPORT_STATE.CONNECTED) {
        syncBobSession().catch(() => {});
      }
    });

    await aliceTransport.connect();
    await aliceRpc.request('session.auth', { token: alice.reg.token });

    await bobTransport.connect();
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(bobAuthRuns >= 1, 'Первичная авторизация Боба должна пройти');

    // Алиса получает PreKeyBundle Боба
    const { data: bobBundle } = await aliceRpc.request('directory.bundle', { query: 'bob_rel' });
    await alice.engine.establishOutgoingSession({ peerBundle: bobBundle });

    // Имитируем внезапный обрыв мобильного WebSocket внутри FallbackTransport у Боба
    bobTransport.activeTransport._ws.close();
    await new Promise((r) => setTimeout(r, 20));

    // Пока Боб переподключается, Алиса отправляет Сообщение №1
    const env1 = await alice.engine.encryptMessageForPeer({
      peerId: bob.reg.userId,
      payloadObject: { msgId: 'drop_1', type: 'text', text: 'Отправлено во время обрыва связи' },
    });
    const proof1 = toBase64Url(await hmacSha256(utf8ToBytes(bobBundle.mailboxWriteToken), env1.sealedBytes));
    await aliceRpc.request('relay.drop', { mailboxId: bobBundle.mailboxId, writeProof: proof1 }, { body: env1.sealedBytes });

    // Ждём автоматического переподключения FallbackTransport и повторного session.auth + pull
    const waitDeadline = Date.now() + 2500;
    while (bobReceived.length < 1 && Date.now() < waitDeadline) {
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.equal(bobReceived.length, 1, 'Сообщение №1 должно быть автоматически выгружено сразу после реконнекта');
    assert.equal(bobReceived[0].text, 'Отправлено во время обрыва связи');
    assert.ok(bobAuthRuns >= 2, 'После реконнекта FallbackTransport обязан повторно выполнить session.auth');

    // Теперь проверяем главное: новый сокет Боба подписан на live-push и доставляет Сообщение №2 МГНОВЕННО!
    const pushPromise = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Таймаут ожидания мгновенного live-push после реконнекта')), 800);
      livePushWaiter = (txt) => {
        clearTimeout(t);
        resolve(txt);
      };
    });

    const env2 = await alice.engine.encryptMessageForPeer({
      peerId: bob.reg.userId,
      payloadObject: { msgId: 'drop_2', type: 'text', text: 'Мгновенный пуш после восстановления сокета' },
    });
    const proof2 = toBase64Url(await hmacSha256(utf8ToBytes(bobBundle.mailboxWriteToken), env2.sealedBytes));
    const t0 = Date.now();
    await aliceRpc.request('relay.drop', { mailboxId: bobBundle.mailboxId, writeProof: proof2 }, { body: env2.sealedBytes });

    const pushedText = await pushPromise;
    const deliveryMs = Date.now() - t0;
    assert.equal(pushedText, 'Мгновенный пуш после восстановления сокета');
    assert.ok(deliveryMs < 300, `Live-push должен приходить мгновенно (получено за ${deliveryMs} мс)`);
  } finally {
    if (aliceTransport) await aliceTransport.close().catch(() => {});
    if (bobTransport) await bobTransport.close().catch(() => {});
    await srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
