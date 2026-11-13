// Автотесты слоя транспортов (node:test):
//   1. Бинарный кодек кадров (RPC_REQ / RPC_RES / EVENT / COVER).
//   2. Плагинный реестр transportRegistry и fail-closed фильтрация политик (TOR_ONLY / I2P_ONLY).
//   3. Реальный цикл WebSocketTransport + MinimalWsServer + TransportRpcChannel с передачей
//      бинарных конвертов, замером RTT (PING/PONG) и обработкой ошибок.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  FRAME_TYPE,
  encodeFrame,
  decodeFrame,
  createCoverFrame,
} from '../shared/codec/binary-frame.mjs';
import {
  BaseTransport,
  TRANSPORT_STATE,
  TRANSPORT_POLICY,
  TransportRpcChannel,
} from '../public/js/transport/transport-interface.mjs';
import { TransportRegistry, transportRegistry } from '../public/js/transport/transport-registry.mjs';
import { WebSocketTransport } from '../public/js/transport/ws-transport.mjs';
import { MinimalWsServer, MinimalWsClient } from '../server/ws-server.mjs';

test('1. Бинарный кодек кадров сохраняет JSON-метаданные и сырой Uint8Array без Base64', () => {
  const binaryEnvelope = new Uint8Array([0x01, 0xfe, 0xaa, 0x00, 0x99]);
  const encoded = encodeFrame({
    type: FRAME_TYPE.RPC_REQ,
    id: 42,
    meta: { m: 'relay.drop', p: { mailboxId: 'mb_123', ttl: 86400 } },
    body: binaryEnvelope,
  });

  const decoded = decodeFrame(encoded);
  assert.equal(decoded.type, FRAME_TYPE.RPC_REQ);
  assert.equal(decoded.id, 42);
  assert.equal(decoded.meta.m, 'relay.drop');
  assert.equal(decoded.meta.p.mailboxId, 'mb_123');
  assert.deepEqual(decoded.body, binaryEnvelope);

  const cover = createCoverFrame(512);
  assert.equal(cover.byteLength, 512);
  assert.equal(decodeFrame(cover).type, FRAME_TYPE.COVER);
});

test('2. TransportRegistry регистрирует плагины и блокирует утечку IP в режиме TOR_ONLY', () => {
  const reg = new TransportRegistry();

  reg.register({
    id: 'ws',
    title: 'Direct WS',
    kind: 'direct',
    exposesIp: true,
    priority: 10,
    create: () => new BaseTransport({ id: 'ws', kind: 'direct', exposesIp: true }),
  });

  reg.register({
    id: 'tor',
    title: 'Tor Hidden Service',
    kind: 'tor',
    exposesIp: false,
    priority: 30,
    create: () => new BaseTransport({ id: 'tor', kind: 'tor', exposesIp: false }),
  });

  // Попытка зарегистрировать «сломанный» Tor-плагин с exposesIp: true не должна попасть в TOR_ONLY
  reg.register({
    id: 'leaky-tor',
    title: 'Misconfigured Tor',
    kind: 'tor',
    exposesIp: true,
    priority: 5,
    create: () => new BaseTransport({ id: 'leaky-tor', kind: 'tor', exposesIp: true }),
  });

  const torCandidates = reg.resolveForPolicy(TRANSPORT_POLICY.TOR_ONLY);
  assert.equal(torCandidates.length, 1);
  assert.equal(torCandidates[0].id, 'tor');

  const autoCandidates = reg.resolveForPolicy(TRANSPORT_POLICY.AUTO);
  assert.deepEqual(autoCandidates.map((c) => c.id), ['leaky-tor', 'ws', 'tor']);
});

test('3. WebSocketTransport + MinimalWsServer: бинарный RPC, события и замер RTT', async () => {
  assert.equal(transportRegistry.has('ws'), true, 'Плагин ws должен автоматически регистрироваться');

  const httpServer = http.createServer();
  const wss = new MinimalWsServer({ path: '/ws' });
  wss.attach(httpServer);

  wss.on('connection', (conn) => {
    conn.on('message', (bytes, isBinary) => {
      if (!isBinary) return;
      const frame = decodeFrame(bytes);

      // Отвечаем на прикладной PING клиента для расчёта RTT
      if (frame.type === FRAME_TYPE.PING) {
        conn.sendBinary(encodeFrame({ type: FRAME_TYPE.PONG, id: frame.id, meta: frame.meta }));
        return;
      }

      if (frame.type === FRAME_TYPE.RPC_REQ && frame.meta.m === 'echo.envelope') {
        // Возвращаем RPC-ответ с перевёрнутым бинарным конвертом + асинхронное событие
        const reversed = new Uint8Array([...frame.body].reverse());
        conn.sendBinary(
          encodeFrame({
            type: FRAME_TYPE.RPC_RES,
            id: frame.id,
            meta: { ok: true, r: { accepted: true, byteLen: frame.body.byteLength } },
            body: reversed,
          })
        );
        setTimeout(() => {
          conn.sendBinary(
            encodeFrame({
              type: FRAME_TYPE.EVENT,
              id: 0,
              meta: { ev: 'mailbox.new', d: { id: 'env_777' } },
              body: frame.body,
            })
          );
        }, 20);
      }
    });
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();

  const states = [];
  const transport = transportRegistry.create('ws', {
    url: `ws://127.0.0.1:${port}/ws`,
    WebSocketImpl: MinimalWsClient,
    pingIntervalMs: 120,
    pongTimeoutMs: 1000,
  });
  transport.onStateChange((st) => states.push(st));

  await transport.connect();
  assert.equal(transport.state, TRANSPORT_STATE.CONNECTED);

  const rpc = new TransportRpcChannel(transport);
  let pushedEvent = null;
  const eventPromise = new Promise((resolve) => {
    rpc.onEvent('mailbox.new', (data, body) => {
      pushedEvent = { data, body };
      resolve();
    });
  });

  const sampleSealed = new Uint8Array([10, 20, 30, 40, 50]);
  const res = await rpc.request('echo.envelope', { ttl: 300 }, { body: sampleSealed });

  assert.equal(res.data.accepted, true);
  assert.equal(res.data.byteLen, 5);
  assert.deepEqual(res.body, new Uint8Array([50, 40, 30, 20, 10]));

  await eventPromise;
  assert.equal(pushedEvent.data.id, 'env_777');
  assert.deepEqual(pushedEvent.body, sampleSealed);

  // Дожидаемся первого замера RTT
  await new Promise((r) => setTimeout(r, 90));
  assert.ok(Number.isFinite(transport.rttMs) && transport.rttMs >= 1, `Ожидался rttMs >= 1, получено ${transport.rttMs}`);

  rpc.destroy();
  await transport.close();
  assert.equal(transport.state, TRANSPORT_STATE.CLOSED);
  assert.deepEqual(states.slice(0, 2), [TRANSPORT_STATE.CONNECTING, TRANSPORT_STATE.CONNECTED]);

  await new Promise((resolve) => httpServer.close(resolve));
});
