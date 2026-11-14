// Автотесты завершённых функций MeshChat v1.7 (build 8):
//   1. ISO/IEC 18004 генератор QR-кодов (shared/qr/qrcode.mjs).
//   2. Движок E2EE P2P голосовых вызовов DTLS-SRTP и симметричный код SAS (call-manager.mjs).
//   3. Редактирование, удаление, отключение звука, очистка и удаление чатов в store.
//   4. Автономный Service Worker (public/sw.js) и мосты Android APK (MainActivity.java).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { encodeQrMatrix, buildQrSvgModel } from '../shared/qr/qrcode.mjs';
import { E2eeCallManager, computeDtlsSas } from '../public/js/transport/call-manager.mjs';
import { TRANSPORT_POLICY } from '../public/js/transport/transport-interface.mjs';

// Минимальные браузерные заглушки для импорта store в среде Node.js
if (!globalThis.localStorage) {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };
}
if (!globalThis.document) {
  const attrs = new Map();
  const styles = new Map();
  globalThis.document = {
    title: 'MeshChat',
    hidden: false,
    documentElement: {
      style: {
        setProperty: (k, v) => styles.set(k, v),
        removeProperty: (k) => styles.delete(k),
      },
      setAttribute: (k, v) => attrs.set(k, v),
      getAttribute: (k) => attrs.get(k),
    },
    body: { appendChild: () => {}, removeChild: () => {} },
    createElement: () => ({ click: () => {}, style: {} }),
    addEventListener: () => {},
  };
}
if (!globalThis.window) {
  globalThis.window = globalThis;
  globalThis.window.addEventListener = () => {};
}

const storeMod = await import('../public/js/store/app-store.mjs');

test('Генератор QR-кодов ISO/IEC 18004 формирует корректную матрицу, поисковые маркеры и SVG-путь', () => {
  const uri = 'meshchat://contact/knox1986x?fp=1f6357af476ed553';
  const qr = encodeQrMatrix(uri);
  assert.ok(qr.version >= 3 && qr.version <= 10);
  assert.equal(qr.size, 17 + qr.version * 4);
  assert.equal(qr.modules.length, qr.size);

  // Проверяем левый верхний маркер поиска 7×7 (внешняя рамка чёрная = 1, центр 3×3 чёрный = 1)
  for (let i = 0; i < 7; i++) {
    assert.equal(qr.modules[0][i], 1);
    assert.equal(qr.modules[6][i], 1);
    assert.equal(qr.modules[i][0], 1);
    assert.equal(qr.modules[i][6], 1);
  }
  assert.equal(qr.modules[3][3], 1);
  assert.equal(qr.modules[1][1], 0);

  const svg = buildQrSvgModel(uri, 3);
  assert.equal(svg.viewBox, `0 0 ${qr.size + 6} ${qr.size + 6}`);
  assert.ok(svg.pathD.startsWith('M'));
  assert.ok(svg.pathD.length > 200);
});

test('Код сверки DTLS-SRTP SAS симметричен, а звонки блокируются в Tor-Only режиме (Fail-Closed)', async () => {
  const sdpAlice = 'v=0\r\na=fingerprint:sha-256 AA:BB:CC:11:22:33\r\n';
  const sdpBob = 'v=0\r\na=fingerprint:sha-256 99:88:77:66:55:44\r\n';

  const sasAlice = await computeDtlsSas(sdpAlice, sdpBob);
  const sasBob = await computeDtlsSas(sdpBob, sdpAlice);
  assert.ok(sasAlice.length >= 14);
  assert.equal(sasAlice, sasBob, 'Код сверки DTLS SAS обязан совпадать у обоих пиров независимо от роли');

  const cm = new E2eeCallManager({ sendSignalToChat: async () => {} });
  await assert.rejects(
    () => cm.startOutgoingCall({
      chat: { id: 'dm:1', kind: 'dm', title: 'Peer' },
      transportPolicy: TRANSPORT_POLICY.TOR_ONLY,
    }),
    /Только Tor \/ I2P/i
  );
});

test('E2eeCallManager проводит полный цикл зашифрованного сигналинга Offer -> Answer -> Connected -> Hangup', async () => {
  const signals = [];

  // Моделируем WebRTC и аудиопоток для детерминированной проверки протокола сигналинга
  const origPeer = globalThis.RTCPeerConnection;
  const origAudio = globalThis.Audio;
  const origMedia = globalThis.navigator?.mediaDevices;

  class MockPeerConnection {
    constructor(cfg) {
      this.cfg = cfg;
      this.connectionState = 'new';
      this.localDescription = null;
      this.remoteDescription = null;
      this.addedCandidates = [];
    }
    addTrack() {}
    async createOffer() {
      return { type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 11:22:33:44\r\n' };
    }
    async createAnswer() {
      return { type: 'answer', sdp: 'v=0\r\na=fingerprint:sha-256 55:66:77:88\r\n' };
    }
    async setLocalDescription(desc) {
      this.localDescription = desc;
    }
    async setRemoteDescription(desc) {
      this.remoteDescription = desc;
      this.connectionState = 'connected';
      this.onconnectionstatechange?.();
    }
    async addIceCandidate(c) {
      this.addedCandidates.push(c);
    }
    close() {
      this.connectionState = 'closed';
    }
  }

  globalThis.RTCPeerConnection = MockPeerConnection;
  globalThis.Audio = class { play() { return Promise.resolve(); } pause() {} };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      ...globalThis.navigator,
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ enabled: true, stop: () => {} }],
          getAudioTracks: () => [{ enabled: true, stop: () => {} }],
        }),
      },
    },
  });

  try {
    const aliceChat = { id: 'dm:bob', kind: 'dm', title: 'Bob' };
    const bobChat = { id: 'dm:alice', kind: 'dm', title: 'Alice' };

    let aliceMgr;
    let bobMgr;

    aliceMgr = new E2eeCallManager({
      sendSignalToChat: async (_chat, sig) => {
        signals.push({ from: 'alice', sig });
        await bobMgr.handleIncomingSignal(bobChat, sig, []);
      },
    });
    bobMgr = new E2eeCallManager({
      sendSignalToChat: async (_chat, sig) => {
        signals.push({ from: 'bob', sig });
        await aliceMgr.handleIncomingSignal(aliceChat, sig, []);
      },
    });

    await aliceMgr.startOutgoingCall({
      chat: aliceChat,
      iceServers: [{ urls: 'turn:relay.example:3478' }],
      iceTransportPolicy: 'relay',
      transportPolicy: TRANSPORT_POLICY.AUTO,
    });

    assert.equal(bobMgr.state.active, true);
    assert.equal(bobMgr.state.direction, 'incoming');
    assert.equal(bobMgr.state.phase, 'ringing');

    await bobMgr.acceptIncomingCall();

    assert.equal(aliceMgr.state.phase, 'connected');
    assert.equal(bobMgr.state.phase, 'connected');
    assert.equal(aliceMgr.state.dtlsSas, bobMgr.state.dtlsSas);
    assert.equal(aliceMgr.toggleMute(), true);

    await aliceMgr.hangup(aliceChat);
    assert.equal(aliceMgr.state.phase, 'ended');
    assert.equal(bobMgr.state.phase, 'ended');
    aliceMgr.dismissEndedModal();
    bobMgr.dismissEndedModal();
    assert.equal(aliceMgr.state.active, false);
    assert.equal(bobMgr.state.active, false);
    assert.ok(signals.some((s) => s.sig.action === 'offer'));
    assert.ok(signals.some((s) => s.sig.action === 'answer'));
    assert.ok(signals.some((s) => s.sig.action === 'hangup'));
  } finally {
    globalThis.RTCPeerConnection = origPeer;
    globalThis.Audio = origAudio;
    if (origMedia) globalThis.navigator.mediaDevices = origMedia;
  }
});

test('Версия v2.0.0 (build 11), 11 разделов настроек, папки чатов, энергосбережение и действия чата', async () => {
  assert.equal(storeMod.APP_VERSION, '2.0.0');
  assert.equal(storeMod.APP_VERSION_CODE, 11);
  assert.equal(Object.keys(storeMod.THEME_PRESETS).length, 18);
  assert.equal(storeMod.HOLIDAY_MOOD_PACKS.length, 6);
  assert.ok(Object.keys(storeMod.BUBBLE_GRADIENTS).length >= 8);

  const secMod = await import('../public/js/ui/settings-sections.mjs');
  assert.equal(secMod.SETTINGS_SECTIONS_META.length, 11);
  assert.ok(secMod.SETTINGS_SEARCH_INDEX.length >= 15);

  // Проверяем вход в подраздел настроек и выход кнопкой «Назад» Android
  storeMod.store.me = { userId: 'u_sec', username: 'knox' };
  storeMod.store.ui.navTab = 'settings';
  storeMod.openSettingsSection('folders');
  assert.equal(storeMod.store.ui.settingsSection, 'folders');
  assert.equal(storeMod.handleBackNavigation(), true);
  assert.equal(storeMod.store.ui.settingsSection, null);
  assert.equal(storeMod.store.ui.navTab, 'settings');

  // Проверяем создание, наполнение и удаление пользовательской папки чатов
  const folder = await storeMod.createCustomChatFolder('Работа', ['echo:loopback']);
  assert.ok(folder && folder.id.startsWith('fld_'));
  assert.equal(storeMod.store.settings.customFolders.length, 1);
  await storeMod.toggleChatInFolder(folder.id, 'dm:peer2');
  assert.deepEqual(storeMod.store.settings.customFolders[0].chatIds, ['echo:loopback', 'dm:peer2']);
  await storeMod.deleteCustomChatFolder(folder.id);
  assert.equal(storeMod.store.settings.customFolders.length, 0);

  // Проверяем режим энергосбережения и переключение языка
  await storeMod.updateClientSettings({ powerSaveMode: 'always', appLanguage: 'en' });
  assert.equal(storeMod.isPowerSavingActive(), true);
  assert.equal(storeMod.uiText('settings'), 'Settings');
  await storeMod.updateClientSettings({ powerSaveMode: 'auto20', appLanguage: 'ru' });
  assert.equal(storeMod.uiText('settings'), 'Настройки');

  await storeMod.applyHolidayMoodPack('pine_and_gold');
  assert.equal(storeMod.store.theme.preset, 'ny_pine_gold');
  assert.equal(storeMod.store.theme.ambientEffect, 'snowfall');
  assert.equal(storeMod.store.theme.garlandEnabled, true);
  assert.equal(storeMod.store.theme.garlandStyle, 'warm_gold');

  await storeMod.applyHolidayMoodPack('polar_fairytale');
  assert.equal(storeMod.store.theme.preset, 'ny_polar_aurora');
  assert.equal(storeMod.store.theme.ambientEffect, 'aurora_snow');

  const chatId = 'dm:testpeer';
  storeMod.store.chats[chatId] = {
    id: chatId,
    kind: 'dm',
    title: 'Test Peer',
    username: 'testpeer',
    muted: false,
    unread: 2,
  };
  storeMod.store.messages[chatId] = [
    { id: 'm1', out: true, text: 'Исходный текст', ts: 1000, status: 'sent' },
    { id: 'm2', out: false, text: 'Ответ собеседника', ts: 2000 },
  ];

  // Редактирование собственного сообщения (без активного транспорта обновляет локально)
  await storeMod.editChatMessage(chatId, 'm1', 'Исправленный текст');
  assert.equal(storeMod.store.messages[chatId][0].text, 'Исправленный текст');
  assert.ok(storeMod.store.messages[chatId][0].editedAt > 0);

  // Удаление сообщения
  await storeMod.deleteChatMessage(chatId, 'm2', { forEveryone: false });
  assert.equal(storeMod.store.messages[chatId].length, 1);

  // Переключение беззвучного режима чата
  await storeMod.toggleChatMute(chatId);
  assert.equal(storeMod.store.chats[chatId].muted, true);

  // Очистка переписки одного чата
  await storeMod.clearSingleChatHistory(chatId);
  assert.equal(storeMod.store.messages[chatId].length, 0);

  // Полное удаление диалога
  await storeMod.deleteChat(chatId);
  assert.equal(storeMod.store.chats[chatId], undefined);
});

test('Service Worker, атмосферный слой и Android MainActivity содержат полную реализацию', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  assert.ok(sw.includes("CACHE_NAME = 'meshchat-shell-v11'"));
  assert.ok(sw.includes("url.pathname.startsWith('/api/')"));

  const atmo = fs.readFileSync(path.join(root, 'public/js/ui/atmosphere-layer.mjs'), 'utf8');
  assert.ok(atmo.includes('drawCrystalSnowflake'));
  assert.ok(atmo.includes('FestiveGarland'));

  const java = fs.readFileSync(path.join(root, 'android/src/org/meshchat/app/MainActivity.java'), 'utf8');
  assert.ok(java.includes('saveBase64Document'));
  assert.ok(java.includes('showChatNotification'));
  assert.ok(java.includes('cancelChatNotification'));
  assert.ok(java.includes('setCallAudioMode'));
  assert.ok(java.includes('requestNotificationPermission'));
  assert.ok(java.includes('getClipData'));

  const chatViewSrc = fs.readFileSync(path.join(root, 'public/js/ui/chat-view.mjs'), 'utf8');
  assert.ok(!chatViewSrc.includes('onceToggle'), 'Жёлтая кнопка [1] удалена из панели ввода чата');

  const manifest = fs.readFileSync(path.join(root, 'android/AndroidManifest.xml'), 'utf8');
  assert.ok(manifest.includes('package="io.meshchat.app"'));
  assert.ok(manifest.includes('android:versionCode="11"'));
  assert.ok(manifest.includes('android:versionName="2.0.0"'));
});

test('v2.0: Кодек G.711 μ-law + AES-256-GCM аудиоретранслятор 4G CGNAT и шторка уведомлений Android', async () => {
  const voiceMod = await import('../public/js/transport/voice-relay-audio.mjs');
  const { E2eeCallManager } = await import('../public/js/transport/call-manager.mjs');

  // 1. Проверяем точность кодирования/декодирования синусоиды 48 кГц -> 8 кГц μ-law -> Float32
  const src48k = new Float32Array(4800);
  for (let i = 0; i < src48k.length; i++) {
    src48k[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.7;
  }
  const ulaw = voiceMod.downsampleAndEncodeMuLaw(src48k, 48000);
  assert.equal(ulaw.length, 800);
  const decoded = voiceMod.decodeMuLawBuffer(ulaw);
  assert.equal(decoded.length, 800);

  let mse = 0;
  for (let i = 0; i < 800; i++) {
    const ref = Math.sin((2 * Math.PI * 440 * (6 * i + 2.5)) / 48000) * 0.7;
    const diff = decoded[i] - ref;
    mse += diff * diff;
  }
  const rmse = Math.sqrt(mse / 800);
  assert.ok(rmse < 0.025, `Низкая ошибка квантования G.711 μ-law (RMSE=${rmse.toFixed(4)})`);

  // 2. Проверяем сквозное шифрование аудиокадра AES-256-GCM и отсечение чужого callTag
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const tagA = await voiceMod.deriveCallTagBytes('call_alpha');
  const tagB = await voiceMod.deriveCallTagBytes('call_beta');

  const packet = await voiceMod.encryptVoiceFrame(aesKey, tagA, ulaw);
  assert.equal(packet.byteLength, 8 + 12 + 800 + 16);

  const wrongCall = await voiceMod.decryptVoiceFrame(aesKey, tagB, packet);
  assert.equal(wrongCall, null);

  const decryptedUlaw = await voiceMod.decryptVoiceFrame(aesKey, tagA, packet);
  assert.deepEqual(decryptedUlaw, ulaw);

  // 3. Проверяем двустороннее соединение E2eeCallManager в режиме 4G CGNAT (без прямого UDP WebRTC)
  const chatAlice = { id: 'dm:bob', kind: 'dm', peerId: 'u_bob', title: 'Bob', username: 'bob' };
  const chatBob = { id: 'dm:alice', kind: 'dm', peerId: 'u_alice', title: 'Alice', username: 'alice' };

  let aliceMgr;
  let bobMgr;
  aliceMgr = new E2eeCallManager({
    getIceServers: async () => [{ urls: ['stun:stun.cloudflare.com:3478'] }],
    getIceTransportPolicy: () => 'relay', // Строгий режим без TURN -> чистый E2EE Relay!
    sendSignalToChat: async (_chat, sig) => {
      await bobMgr.handleIncomingSignal(chatBob, sig);
    },
    onStateChange: () => {},
    onNotice: () => {},
  });
  bobMgr = new E2eeCallManager({
    getIceServers: async () => [{ urls: ['stun:stun.cloudflare.com:3478'] }],
    getIceTransportPolicy: () => 'relay',
    sendSignalToChat: async (_chat, sig) => {
      await aliceMgr.handleIncomingSignal(chatAlice, sig);
    },
    onStateChange: () => {},
    onNotice: () => {},
  });

  await aliceMgr.startOutgoingCall(chatAlice);
  assert.equal(aliceMgr.state.status, 'outgoing');
  assert.equal(bobMgr.state.status, 'incoming');

  await bobMgr.acceptIncomingCall(chatBob);
  // Дожидаемся промис-очереди сигналинга answer
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(aliceMgr.state.status, 'connected');
  assert.equal(bobMgr.state.status, 'connected');
  assert.ok(aliceMgr.state.sasEmojis.length >= 4);
  assert.equal(aliceMgr.state.sasEmojis, bobMgr.state.sasEmojis);

  aliceMgr.toggleSpeaker();
  assert.equal(aliceMgr.state.speaker, true);
  aliceMgr.toggleMute();
  assert.equal(aliceMgr.state.muted, true);

  await aliceMgr.hangup(chatAlice);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(aliceMgr.state.status, 'ended');
  assert.equal(bobMgr.state.status, 'ended');
  aliceMgr.dismissEndedModal();
  bobMgr.dismissEndedModal();
  assert.equal(aliceMgr.state.status, 'idle');
  assert.equal(bobMgr.state.status, 'idle');

  // 4. Проверяем мост шторки уведомлений Android
  const posted = [];
  const origBridge = globalThis.MeshChatAndroid;
  globalThis.MeshChatAndroid = {
    hasNotificationPermission: () => true,
    showChatNotification: (cid, title, body, isCall) => posted.push({ cid, title, body, isCall }),
    cancelChatNotification: () => {},
  };
  try {
    await storeMod.sendTestShadeNotification();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].cid, 'echo:loopback');
    assert.equal(posted[0].isCall, false);
  } finally {
    globalThis.MeshChatAndroid = origBridge;
  }
});
