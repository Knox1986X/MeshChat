// Автотесты мультитранспортного стека (node:test):
//   1. TorTransport (.onion v3) и I2PTransport (.b32.i2p) через реальный RFC 1928 SOCKS5-мост
//      (проверка удалённого резолвинга ATYP=0x03 без утечки DNS и отклонения некорректных адресов).
//   2. WebRTCTransport: P2P Mesh, нарезка/сборка больших пакетов (100 КБ -> чанки по 16 КБ) и лимит 8 пиров.
//   3. FallbackTransport: автоматический обход блокировки WS -> Tor, переключение при деградации
//      и жёсткий fail-closed запрет выхода в клирнет при политике TOR_ONLY.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';

import { MinimalWsServer, MinimalWsClient } from '../server/ws-server.mjs';
import { createLocalProxyBridge } from '../tools/local-proxy-bridge.mjs';
import {
  BaseTransport,
  TRANSPORT_STATE,
  TRANSPORT_POLICY,
} from '../public/js/transport/transport-interface.mjs';
import { TransportRegistry } from '../public/js/transport/transport-registry.mjs';
import { WebSocketTransport } from '../public/js/transport/ws-transport.mjs';
import { TorTransport, isValidOnionWsUrl } from '../public/js/transport/tor-transport.mjs';
import { I2PTransport } from '../public/js/transport/i2p-transport.mjs';
import { WebRTCTransport, MAX_MESH_PEERS } from '../public/js/transport/webrtc-transport.mjs';
import { FallbackTransport } from '../public/js/transport/fallback-transport.mjs';

const VALID_V3_ONION = `ws://${'a'.repeat(56)}.onion/ws`;
const VALID_I2P_URL = 'ws://veilhiddenrelay777777777777777777777777777777777.b32.i2p/ws';

/** Поднимает минимальный тестовый SOCKS5-сервер (RFC 1928), перенаправляющий скрытый домен на targetPort */
function startMockSocks5Server(targetPort, seenDomains = []) {
  const server = net.createServer((client) => {
    client.once('data', (greet) => {
      if (greet[0] !== 0x05) return client.destroy();
      client.write(Buffer.from([0x05, 0x00])); // Выбираем NO AUTH

      client.once('data', (req) => {
        // Проверяем, что клиент передал ATYP=0x03 (DOMAINNAME), а не резолвил DNS локально!
        assert.equal(req[0], 0x05);
        assert.equal(req[1], 0x01);
        assert.equal(req[3], 0x03, 'SOCKS5 обязан использовать ATYP=0x03 против утечки DNS');

        const domainLen = req[4];
        const domain = req.subarray(5, 5 + domainLen).toString('ascii');
        seenDomains.push(domain);

        const upstream = net.createConnection({ host: '127.0.0.1', port: targetPort }, () => {
          // Ответ SOCKS5: VER=5, REP=0 (succeeded), RSV=0, ATYP=1, BND.ADDR=0.0.0.0, BND.PORT=0
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on('error', () => client.destroy());
        client.on('error', () => upstream.destroy());
      });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('1. TorTransport и I2PTransport работают через SOCKS5-мост без утечки DNS и отвергают клирнет-URL', async () => {
  assert.equal(isValidOnionWsUrl(VALID_V3_ONION), true);
  assert.equal(isValidOnionWsUrl('ws://shortv2onion1234.onion/ws'), false, 'Устаревший v2 onion должен отклоняться');
  assert.equal(isValidOnionWsUrl('wss://example.com/ws'), false, 'Клирнет-домен в TorTransport недопустим');

  // Поднимаем целевой скрытый WS-сервер
  const hiddenHttp = http.createServer();
  const hiddenWss = new MinimalWsServer({ path: '/ws' });
  hiddenWss.attach(hiddenHttp);
  const seenHeaders = [];
  hiddenWss.on('connection', (conn, req) => {
    seenHeaders.push(req.headers['x-veil-transport']);
    conn.on('message', (bytes) => conn.sendBinary(bytes)); // эхо бинарного кадра
  });
  await new Promise((r) => hiddenHttp.listen(0, '127.0.0.1', r));
  const hiddenPort = hiddenHttp.address().port;

  // Поднимаем тестовый SOCKS5 демон и локальный мост
  const socksDomains = [];
  const socks = await startMockSocks5Server(hiddenPort, socksDomains);
  const bridge = createLocalProxyBridge({
    torSocksPorts: [socks.port],
    i2pSocksPorts: [socks.port],
    allowedOriginPattern: null,
  });
  const bridgeAddr = await bridge.listen(0);
  const bridgeUrl = `ws://127.0.0.1:${bridgeAddr.port}`;

  try {
    // 1A. Проверяем TorTransport (.onion)
    const tor = new TorTransport({
      onionUrl: VALID_V3_ONION,
      localBridgeUrl: bridgeUrl,
      WebSocketImpl: MinimalWsClient,
      pingIntervalMs: 0,
    });
    await tor.connect();
    assert.equal(tor.connectionMode, 'local-socks5-bridge');

    const receivedTor = new Promise((resolve) => tor.onMessage(resolve));
    const sample = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    await tor.send(sample);
    assert.deepEqual(await receivedTor, sample);
    await tor.close();

    // 1B. Проверяем I2PTransport (.b32.i2p)
    const i2p = new I2PTransport({
      i2pUrl: VALID_I2P_URL,
      localBridgeUrl: bridgeUrl,
      WebSocketImpl: MinimalWsClient,
      pingIntervalMs: 0,
    });
    await i2p.connect();
    const receivedI2p = new Promise((resolve) => i2p.onMessage(resolve));
    await i2p.send(new Uint8Array([1, 2, 3, 4]));
    assert.deepEqual(await receivedI2p, new Uint8Array([1, 2, 3, 4]));
    await i2p.close();

    assert.equal(socksDomains.length, 2);
    assert.ok(socksDomains[0].endsWith('.onion'));
    assert.ok(socksDomains[1].endsWith('.b32.i2p'));
    assert.deepEqual(seenHeaders, ['tor', 'i2p']);
  } finally {
    await bridge.close();
    await new Promise((r) => socks.server.close(r));
    await new Promise((r) => hiddenHttp.close(r));
  }
});

test('2. WebRTCTransport: P2P Mesh рукопожатие, чанкинг пакета 100 КБ по 16 КБ и потолок 8 пиров', async () => {
  // Легковесная пара связанных DataChannel в памяти для детерминированного теста SCTP-сборки в Node.js
  class LinkedMockPeerConnection {
    static registry = new Map();
    constructor(cfg) {
      this.cfg = cfg;
      this.localDescription = null;
      this.remoteDescription = null;
      this.ondatachannel = null;
      this._dc = null;
      this._id = Math.random().toString(36).slice(2);
      LinkedMockPeerConnection.registry.set(this._id, this);
    }
    createDataChannel(label) {
      this._dc = { label, readyState: 'connecting', send: null, close: () => { this._dc.readyState = 'closed'; } };
      return this._dc;
    }
    async createOffer() { return { type: 'offer', peerRef: this._id }; }
    async setLocalDescription(desc) { this.localDescription = desc; }
    async setRemoteDescription(desc) {
      this.remoteDescription = desc;
      if (desc.type === 'offer') {
        this._remotePc = LinkedMockPeerConnection.registry.get(desc.peerRef);
      } else if (desc.type === 'answer') {
        const responderPc = LinkedMockPeerConnection.registry.get(desc.peerRef);
        const initDc = this._dc;
        const respDc = responderPc._responderDc;
        initDc.readyState = 'open';
        respDc.readyState = 'open';
        initDc.send = (chunk) => queueMicrotask(() => respDc.onmessage?.({ data: new Uint8Array(chunk) }));
        respDc.send = (chunk) => queueMicrotask(() => initDc.onmessage?.({ data: new Uint8Array(chunk) }));
        initDc.onopen?.();
        respDc.onopen?.();
      }
    }
    async createAnswer() {
      this._responderDc = { label: 'veil-mesh-v1', readyState: 'connecting', close: () => {} };
      this.ondatachannel?.({ channel: this._responderDc });
      return { type: 'answer', peerRef: this._id };
    }
    close() {}
  }

  let aliceRtc;
  let bobRtc;

  aliceRtc = new WebRTCTransport({
    RTCPeerConnectionImpl: LinkedMockPeerConnection,
    sendSignal: async (_peerId, sig) => bobRtc.handleIncomingSignal('u_alice', sig),
  });
  bobRtc = new WebRTCTransport({
    RTCPeerConnectionImpl: LinkedMockPeerConnection,
    sendSignal: async (_peerId, sig) => aliceRtc.handleIncomingSignal('u_bob', sig),
  });

  const connectedPromise = new Promise((resolve) => {
    bobRtc.onStateChange((st) => { if (st === TRANSPORT_STATE.CONNECTED) resolve(); });
  });

  await aliceRtc.connectToPeer('u_bob');
  await connectedPromise;
  assert.equal(aliceRtc.state, TRANSPORT_STATE.CONNECTED);
  assert.equal(bobRtc.state, TRANSPORT_STATE.CONNECTED);

  // Передаём крупный пакет 100 КБ (разрезается на 7 чанков по 16 КБ и собирается у Боба байт-в-байт)
  const bigPayload = new Uint8Array(100 * 1024);
  for (let i = 0; i < bigPayload.length; i++) bigPayload[i] = (i * 17) & 0xff;

  const receivedAtBob = new Promise((resolve) => bobRtc.onMessage(resolve));
  await aliceRtc.send(bigPayload);
  const reassembled = await receivedAtBob;
  assert.equal(reassembled.byteLength, 100 * 1024);
  assert.deepEqual(reassembled, bigPayload);

  // Проверяем жёсткое ограничение MAX_MESH_PEERS = 8
  for (let i = 2; i <= MAX_MESH_PEERS; i++) {
    aliceRtc.peers.set(`dummy_${i}`, { pc: { close() {} }, dc: { readyState: 'open', close() {} }, reassembly: new Map() });
  }
  await assert.rejects(() => aliceRtc.connectToPeer('u_overflow_9'), /предел WebRTC Mesh/);

  await aliceRtc.close();
  await bobRtc.close();
});

test('3. FallbackTransport: автопереключение WS -> Tor при блокировке, уход с DEGRADED и строгий fail-closed в TOR_ONLY', async () => {
  // Поднимаем резервный «Tor» узел
  const backupHttp = http.createServer();
  const backupWss = new MinimalWsServer({ path: '/ws' });
  backupWss.attach(backupHttp);
  backupWss.on('connection', (conn) => conn.on('message', (b) => conn.sendBinary(b)));
  await new Promise((r) => backupHttp.listen(0, '127.0.0.1', r));
  const backupPort = backupHttp.address().port;

  const socks = await startMockSocks5Server(backupPort);
  const bridge = createLocalProxyBridge({
    torSocksPorts: [socks.port],
    allowedOriginPattern: null,
  });
  const bridgeAddr = await bridge.listen(0);

  let clearnetAttempts = 0;
  const reg = new TransportRegistry();

  // 1) Прямой WS направлен на закрытый порт (имитация DPI/блокировки провайдера)
  reg.register({
    id: 'ws',
    title: 'Blocked Clearnet WS',
    kind: 'direct',
    exposesIp: true,
    priority: 10,
    connectTimeoutMs: 400,
    create: () => {
      clearnetAttempts += 1;
      return new WebSocketTransport({
        url: 'ws://127.0.0.1:1/ws',
        connectTimeoutMs: 250,
        WebSocketImpl: MinimalWsClient,
      });
    },
  });

  // 2) Рабочий Tor транспорт через локальный SOCKS5-мост
  reg.register({
    id: 'tor',
    title: 'Working Tor Onion',
    kind: 'tor',
    exposesIp: false,
    priority: 30,
    connectTimeoutMs: 5000,
    create: (cfg) =>
      new TorTransport({
        onionUrl: cfg.onionUrl,
        localBridgeUrl: cfg.localBridgeUrl,
        WebSocketImpl: MinimalWsClient,
        pingIntervalMs: 0,
      }),
  });

  try {
    // Сценарий A: режим AUTO — прямой WS заблокирован, FallbackTransport автоматически поднимает Tor!
    const autoFb = new FallbackTransport({
      registry: reg,
      policy: TRANSPORT_POLICY.AUTO,
      transportConfig: {
        onionUrl: VALID_V3_ONION,
        localBridgeUrl: `ws://127.0.0.1:${bridgeAddr.port}`,
      },
    });

    await autoFb.connect();
    assert.equal(clearnetAttempts, 1);
    assert.equal(autoFb.activeTransportId, 'tor');

    const echoPromise = new Promise((resolve) => autoFb.onMessage(resolve));
    await autoFb.send(new Uint8Array([7, 7, 7]));
    assert.deepEqual(await echoPromise, new Uint8Array([7, 7, 7]));
    await autoFb.close();

    // Сценарий B: строгий TOR_ONLY при полностью упавшем Tor — прямой WS НЕ вызывается НИ РАЗУ (0 утечек IP!)
    clearnetAttempts = 0;
    const deadTorFb = new FallbackTransport({
      registry: reg,
      policy: TRANSPORT_POLICY.TOR_ONLY,
      transportConfig: {
        onionUrl: VALID_V3_ONION,
        localBridgeUrl: 'ws://127.0.0.1:1', // заведомо недоступный мост Tor
      },
    });

    await assert.rejects(() => deadTorFb.connect(), /Все транспорты недоступны/);
    assert.equal(clearnetAttempts, 0, 'В режиме TOR_ONLY попытки прямого выхода в сеть строго запрещены!');
    await deadTorFb.close();

    // Сценарий C: автоматический уход с DEGRADED канала на здоровый резервный канал
    let degradeTrigger = null;
    const regDeg = new TransportRegistry();
    regDeg.register({
      id: 'primary',
      kind: 'direct',
      exposesIp: true,
      priority: 10,
      create: () => {
        const t = new BaseTransport({ id: 'primary', kind: 'direct', exposesIp: true });
        t.connect = async () => {
          t._setState(TRANSPORT_STATE.CONNECTED);
          degradeTrigger = () => t._setState(TRANSPORT_STATE.DEGRADED, { rttMs: 5000 });
        };
        t.send = async () => true;
        return t;
      },
    });
    regDeg.register({
      id: 'secondary',
      kind: 'direct',
      exposesIp: true,
      priority: 20,
      create: () => {
        const t = new BaseTransport({ id: 'secondary', kind: 'direct', exposesIp: true });
        t.connect = async () => t._setState(TRANSPORT_STATE.CONNECTED);
        t.send = async () => true;
        return t;
      },
    });

    const degFb = new FallbackTransport({ registry: regDeg, degradedGraceMs: 60 });
    await degFb.connect();
    assert.equal(degFb.activeTransportId, 'primary');

    degradeTrigger();
    await new Promise((r) => setTimeout(r, 140));
    assert.equal(degFb.activeTransportId, 'secondary', 'При затяжной деградации должен включиться резервный транспорт');
    await degFb.close();
  } finally {
    await bridge.close();
    await new Promise((r) => socks.server.close(r));
    await new Promise((r) => backupHttp.close(r));
  }
});
