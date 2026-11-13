// Центральное реактивное состояние мессенджера (Offline-First Store).
// Связывает изолированный CryptoWorker, мультитранспортный канал, зашифрованную IndexedDB,
// последовательную очередь обработки конвертов, гарантированную доставку Outbox и жнец TTL.

import { useReducer, useEffect } from '../../vendor/preact.mjs';
import {
  utf8ToBytes,
  randomBytes,
  toBase64Url,
  fromBase64Url,
  hmacSha256,
} from '../../../shared/crypto/primitives.mjs';
import { CryptoWorkerClient } from '../crypto/worker-client.mjs';
import {
  TRANSPORT_STATE,
  TRANSPORT_POLICY,
  TransportRpcChannel,
} from '../transport/transport-interface.mjs';
import { transportRegistry } from '../transport/transport-registry.mjs';
import '../transport/ws-transport.mjs';
import '../transport/tor-transport.mjs';
import '../transport/i2p-transport.mjs';
import '../transport/webrtc-transport.mjs';
import { FallbackTransport } from '../transport/fallback-transport.mjs';
import { EncryptedClientDb } from './idb-messages.mjs';
import { playSfx } from '../ui/boss-screen.mjs';

// Строгая приглушённая палитра идентификаторов контактов (графит, сталь, тёмный кобальт, хвоя)
const AVATAR_PALETTE = [
  '#1E3A5F', '#1E40AF', '#0F4C5C', '#334155',
  '#14532D', '#1E293B', '#1D4ED8', '#115E59',
];

function pickColor(seedStr = '') {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export const APP_VERSION = '1.2.0';
export const APP_VERSION_CODE = 3;
export const GITHUB_REPO = 'Knox1986X/MeshChat';
export const DEFAULT_CLOUD_URL = 'https://meshchat-6a11.onrender.com';

function compareSemver(a = '0.0.0', b = '0.0.0') {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export const store = {
  booting: true,
  busy: false,
  authError: '',
  me: null, // { userId, username, token, mailboxId, mailboxWriteToken }
  recoveryModalKey: null,

  // Состояние автообновления (Web Hot-Swap + Android APK SHA-256 Installer)
  update: {
    currentVersion: APP_VERSION,
    bootBuildHash: null,
    checking: false,
    available: false,
    dismissed: false,
    remoteVersion: null,
    remoteBuildHash: null,
    apkUrl: null,
    apkSha256: null,
    releaseNotes: '',
    downloading: false,
    progress: 0,
    statusText: '',
    lastCheckedAt: 0,
  },

  // Состояние сети, мультитранспорта и Android Mesh-узла
  transportState: TRANSPORT_STATE.DISCONNECTED,
  sessionAuthenticated: false,
  activeTransportId: 'ws',
  rttMs: null,
  serverEndpoints: { onion: null, i2p: null },
  android: {
    isApk: Boolean(globalThis.MeshChatAndroid),
    lanMeshRunning: false,
    lanUrl: '',
  },
  settings: {
    serverUrl: globalThis.MeshChatAndroid ? DEFAULT_CLOUD_URL : '',
    autoUpdateCheck: true,
    transportPolicy: TRANSPORT_POLICY.AUTO,
    onionUrl: '',
    i2pUrl: '',
    localBridgeUrl: 'ws://127.0.0.1:17700',
    coverTraffic: false,
    sound: true,
    strictBossWipe: false,
    bossDocTitle: 'Финансовая_модель_Q4_консолидация.xlsx',
  },

  // Данные чатов и сообщений (расшифровываются из IndexedDB только в ОЗУ)
  chats: {},              // chatId -> chatObj
  messages: {},           // chatId -> msgObj[]
  outbox: [],             // очередь зашифрованных конвертов для гарантированной досылки
  decryptedMediaUrls: {}, // blobId -> objectURL

  // Состояние интерфейса (Desktop 3-pane и Mobile)
  ui: {
    spaceFilter: 'all', // 'all' | 'rooms' | 'ask'
    mobileTab: 'chats',
    activeChatId: null,
    inspectorOpen: true,
    searchQuery: '',
    replyTo: null,
    onceMode: false,
    bossActive: false,
    modal: null,        // null | 'new-chat' | 'safety' | 'settings' | 'once-viewer' | 'call'
    modalData: null,
    toasts: [],
  },
};

const listeners = new Set();
let rafScheduled = false;

export function notifyStore() {
  if (rafScheduled) return;
  rafScheduled = true;
  const run = () => {
    rafScheduled = false;
    for (const fn of listeners) fn();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

export function useAppStore() {
  const [, rerender] = useReducer((c) => c + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    return () => listeners.delete(rerender);
  }, []);
  return store;
}

export function showToast(text, kind = 'info') {
  const id = toBase64Url(randomBytes(6));
  store.ui.toasts = [...store.ui.toasts.slice(-3), { id, text, kind }];
  notifyStore();
  setTimeout(() => {
    store.ui.toasts = store.ui.toasts.filter((t) => t.id !== id);
    notifyStore();
  }, 4200);
}

// ─────────────────────── Инициализация сервисов клиента ───────────────────────

const clientDb = new EncryptedClientDb();
const cryptoWorker = new CryptoWorkerClient('/js/crypto/crypto.worker.mjs');

let activeTransport = null;
let rpcChannel = null;
let customTransportBuilder = null;
let reconnectTimer = null;
let authSyncPromise = null;
let syncLoopTimer = null;
let flushInFlight = false;

// Строго последовательная очередь входящих конвертов + защита от двойной обработки (push + pull)
let incomingQueue = Promise.resolve();
const processedEnvelopeIds = new Set();

function rememberProcessedEnvelope(envId) {
  if (!envId) return;
  processedEnvelopeIds.add(envId);
  if (processedEnvelopeIds.size > 1500) {
    const oldest = processedEnvelopeIds.values().next().value;
    processedEnvelopeIds.delete(oldest);
  }
}

function enqueueIncomingTask(fn) {
  const next = incomingQueue.then(fn, fn);
  incomingQueue = next.catch(() => {});
  return next;
}

/** Позволяет подключить внешний оркестратор транспорта (для автотестов и кастомных сборок) */
export function registerTransportOrchestrator(builderFn) {
  customTransportBuilder = builderFn;
}

async function computeMailboxWriteProof(writeToken, bytes) {
  const mac = await hmacSha256(utf8ToBytes(writeToken), bytes);
  return toBase64Url(mac);
}

/** Вычисляет полный HTTP URL для API с учётом выбранного узла MeshChat */
export function resolveApiUrl(pathname) {
  const raw = (store.settings.serverUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return pathname;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (u.hostname.endsWith('.onion') && globalThis.MeshChatAndroid) {
      return pathname;
    }
    return `${u.origin}${pathname}`;
  } catch {
    return pathname;
  }
}

/** Вычисляет WebSocket URL для прямого канала на основе выбранного узла MeshChat */
function resolveDirectWsUrl() {
  const raw = (store.settings.serverUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return undefined;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (u.hostname.endsWith('.onion') || u.hostname.endsWith('.i2p')) return undefined;
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${u.host}/ws`;
  } catch {
    return undefined;
  }
}

function syncAndroidNativeBridge() {
  if (!globalThis.MeshChatAndroid) return;
  try {
    store.android.isApk = true;
    const raw = (store.settings.serverUrl || '').trim();
    if (typeof globalThis.MeshChatAndroid.setUpstreamServer === 'function') {
      globalThis.MeshChatAndroid.setUpstreamServer(raw);
    }
    if (typeof globalThis.MeshChatAndroid.getLanStatusJson === 'function') {
      const st = JSON.parse(globalThis.MeshChatAndroid.getLanStatusJson() || '{}');
      store.android.lanMeshRunning = Boolean(st.running);
      store.android.lanUrl = st.url || '';
    }
  } catch { /* ignore */ }
}

export function toggleAndroidLanMesh() {
  if (!globalThis.MeshChatAndroid?.toggleLanMesh) return;
  try {
    const next = !store.android.lanMeshRunning;
    const st = JSON.parse(globalThis.MeshChatAndroid.toggleLanMesh(next) || '{}');
    store.android.lanMeshRunning = Boolean(st.running);
    store.android.lanUrl = st.url || '';
    showToast(
      store.android.lanMeshRunning
        ? `Локальный ретранслятор запущен: ${store.android.lanUrl}`
        : 'Локальный ретранслятор остановлен'
    );
    notifyStore();
  } catch (err) {
    showToast(err.message, 'err');
  }
}

/** Нормализует устаревшие названия системного чата при загрузке из локальной БД */
function normalizeStoredChats(chatsObj) {
  if (!chatsObj || typeof chatsObj !== 'object') return {};
  if (chatsObj['ask:inbox']) {
    chatsObj['ask:inbox'].title = 'Входящий шлюз E2E';
    chatsObj['ask:inbox'].avatarColor = '#1E3A5F';
    if (typeof chatsObj['ask:inbox'].lastPreview === 'string') {
      chatsObj['ask:inbox'].lastPreview = chatsObj['ask:inbox'].lastPreview.replace(/^🎭\s*/, '');
    }
  }
  for (const c of Object.values(chatsObj)) {
    if (c && typeof c.lastPreview === 'string') {
      c.lastPreview = c.lastPreview
        .replace(/^🔥\s*Одноразовое медиа/u, '[1×] Вложение')
        .replace(/^📎\s*/u, '[Файл] ')
        .replace(/^🎭\s*/u, '');
    }
  }
  return chatsObj;
}

export async function bootClientApp() {
  try {
    await clientDb.open();
    await cryptoWorker.call('init');

    const savedSettings = await clientDb.get('settings', null);
    if (savedSettings) Object.assign(store.settings, savedSettings);
    syncAndroidNativeBridge();

    // Опрашиваем узел о зеркалах .onion / .i2p и хеше текущей сборки
    fetch(resolveApiUrl('/api/health'))
      .then((r) => r.json())
      .then((h) => {
        if (h?.buildHash && !store.update.bootBuildHash) {
          store.update.bootBuildHash = h.buildHash;
        }
        if (h?.transports) {
          store.serverEndpoints = h.transports;
          if (h.transports.onion && !store.settings.onionUrl) {
            store.settings.onionUrl = `ws://${h.transports.onion}/ws`;
          }
          if (h.transports.i2p && !store.settings.i2pUrl) {
            store.settings.i2pUrl = `ws://${h.transports.i2p}/ws`;
          }
          notifyStore();
        }
      })
      .catch(() => {});

    if (typeof globalThis !== 'undefined') {
      globalThis.__onMeshChatUpdateProgress = (pct, statusText, errMsg) => {
        store.update.progress = Number(pct) || 0;
        store.update.statusText = statusText || '';
        if (errMsg) {
          store.update.downloading = false;
          showToast(errMsg, 'err');
        } else if (pct >= 100) {
          store.update.downloading = false;
        }
        notifyStore();
      };
    }

    const me = await clientDb.get('me', null);
    if (me?.token) {
      store.me = me;
      store.chats = normalizeStoredChats((await clientDb.get('chats', {})) || {});
      store.messages = (await clientDb.get('messages', {})) || {};
      store.outbox = (await clientDb.get('outbox', [])) || [];
      const firstId = Object.keys(store.chats)[0] || null;
      if (firstId && (typeof innerWidth === 'undefined' || innerWidth > 860)) {
        store.ui.activeChatId = firstId;
      }
      await connectActiveTransport();
    }
  } catch (err) {
    console.error('[boot]', err);
  } finally {
    store.booting = false;
    notifyStore();
  }

  // Ежесекундный жнец TTL + страховочная фоновая синхронизация ящика и очереди Outbox каждые 6 секунд
  setInterval(purgeExpiredMessagesTick, 1000);
  clearInterval(syncLoopTimer);
  syncLoopTimer = setInterval(() => {
    if (!store.me) return;
    if (!activeTransport?.isConnected) {
      connectActiveTransport().catch(() => {});
      return;
    }
    if (!store.sessionAuthenticated) {
      authenticateAndSyncTransport().catch(() => {});
      return;
    }
    syncMailbox().catch(() => {});
    if (store.outbox.length > 0) flushOutbox().catch(() => {});
  }, 6000);

  if (typeof window !== 'undefined') {
    const onWakeUp = () => {
      if (store.me) {
        syncNow().catch(() => {});
      }
      if (store.settings.autoUpdateCheck !== false) {
        checkForUpdates({ silent: true });
      }
    };

    setTimeout(() => {
      if (store.settings.autoUpdateCheck !== false) checkForUpdates({ silent: true });
    }, 3500);
    setInterval(() => {
      if (store.settings.autoUpdateCheck !== false) checkForUpdates({ silent: true });
    }, 5 * 60 * 1000);

    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible') onWakeUp();
    });
    window.addEventListener?.('online', onWakeUp);
    window.addEventListener?.('focus', onWakeUp);
    window.addEventListener?.('meshchat:resume', onWakeUp);
  }
}

/** Принудительная немедленная проверка канала, догрузка ящика и отправка очереди Outbox */
export async function syncNow() {
  if (!store.me) return;
  if (!activeTransport || !activeTransport.isConnected) {
    await connectActiveTransport();
    return;
  }
  await authenticateAndSyncTransport();
}

/**
 * Проверяет наличие новой версии на активном узле (/api/version) и в GitHub Releases.
 * В режимах TOR_ONLY / I2P_ONLY внешние запросы к GitHub заблокированы ради защиты IP (Fail-Closed).
 */
export async function checkForUpdates({ silent = false } = {}) {
  if (store.update.checking) return;
  store.update.checking = true;
  if (!silent) notifyStore();

  try {
    let foundUpdate = false;

    try {
      const res = await fetch(resolveApiUrl('/api/version'), { cache: 'no-store' });
      if (res.ok) {
        const v = await res.json();
        if (v?.buildHash && !store.update.bootBuildHash) {
          store.update.bootBuildHash = v.buildHash;
        }
        const newerSemver = v?.version && compareSemver(v.version, APP_VERSION) > 0;
        const newerWebHash =
          !store.android.isApk &&
          store.update.bootBuildHash &&
          v?.buildHash &&
          v.buildHash !== store.update.bootBuildHash;

        if (newerSemver || newerWebHash) {
          store.update.available = true;
          store.update.dismissed = false;
          store.update.remoteVersion = v.version || APP_VERSION;
          store.update.remoteBuildHash = v.buildHash || null;
          if (v.apkAvailable && v.apkUrl) {
            store.update.apkUrl = v.apkUrl.startsWith('http') ? v.apkUrl : resolveApiUrl(v.apkUrl);
            store.update.apkSha256 = v.apkSha256 || null;
          }
          foundUpdate = true;
        }
      }
    } catch { /* узел временно недоступен */ }

    const strictAnon =
      store.settings.transportPolicy === TRANSPORT_POLICY.TOR_ONLY ||
      store.settings.transportPolicy === TRANSPORT_POLICY.I2P_ONLY;

    if (!foundUpdate && !strictAnon && typeof fetch === 'function') {
      try {
        const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          headers: { accept: 'application/vnd.github+json' },
          cache: 'no-store',
        });
        if (ghRes.ok) {
          const rel = await ghRes.json();
          const tagVer = String(rel.tag_name || '').replace(/^v/i, '');
          if (tagVer && compareSemver(tagVer, APP_VERSION) > 0) {
            const apkAsset = (rel.assets || []).find((a) => String(a.name || '').endsWith('.apk'));
            const shaMatch = String(rel.body || '').match(/SHA-?256:\s*`?([a-f0-9]{64})`?/i);
            store.update.available = true;
            store.update.dismissed = false;
            store.update.remoteVersion = tagVer;
            store.update.releaseNotes = String(rel.name || '').slice(0, 120);
            if (apkAsset?.browser_download_url) {
              store.update.apkUrl = apkAsset.browser_download_url;
              store.update.apkSha256 = shaMatch ? shaMatch[1].toLowerCase() : null;
            }
            foundUpdate = true;
          }
        }
      } catch { /* GitHub API недоступен */ }
    }

    store.update.lastCheckedAt = Date.now();
    if (!silent) {
      showToast(
        foundUpdate
          ? `Доступно обновление MeshChat v${store.update.remoteVersion}`
          : `Установлена актуальная версия MeshChat v${APP_VERSION}`
      );
    }
  } finally {
    store.update.checking = false;
    notifyStore();
  }
}

export async function applyAppUpdate() {
  if (store.android.isApk && globalThis.MeshChatAndroid?.downloadAndInstallUpdate) {
    const url = store.update.apkUrl || `https://github.com/${GITHUB_REPO}/releases/latest/download/MeshChat.apk`;
    store.update.downloading = true;
    store.update.progress = 2;
    store.update.statusText = 'Подключение к серверу обновлений…';
    notifyStore();
    globalThis.MeshChatAndroid.downloadAndInstallUpdate(url, store.update.apkSha256 || '');
    return;
  }

  try {
    store.update.downloading = true;
    store.update.statusText = 'Обновление кеша оболочки…';
    notifyStore();
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update().catch(() => {});
        reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    }
    location.reload();
  } catch (err) {
    store.update.downloading = false;
    showToast(err.message, 'err');
    notifyStore();
  }
}

export function dismissUpdateBanner() {
  store.update.dismissed = true;
  notifyStore();
}

// ─────────────────────── Управление транспортом и синхронизацией ───────────────────────

/**
 * Повторно авторизует сессию на активном сокете (подписывая mailboxId на мгновенные пуши),
 * пополняет одноразовые ключи, выгружает входящий ящик и отправляет очередь Outbox.
 * Вызывается при КАЖДОМ переходе транспорта в состояние CONNECTED (включая тихий реконнект FallbackTransport).
 */
async function authenticateAndSyncTransport(pendingBundleUpload = null) {
  if (!rpcChannel || !activeTransport?.isConnected || !store.me?.token) return;
  if (authSyncPromise) return authSyncPromise;

  authSyncPromise = (async () => {
    try {
      const sessionInfo = (await rpcChannel.request('session.auth', { token: store.me.token })).data;
      store.sessionAuthenticated = true;
      store.me.mailboxId = sessionInfo.mailboxId;
      store.me.mailboxWriteToken = sessionInfo.mailboxWriteToken;
      await clientDb.set('me', store.me);

      if (pendingBundleUpload) {
        if (pendingBundleUpload.signedPreKey) {
          await rpcChannel.request('keys.rotateSpk', { signedPreKey: pendingBundleUpload.signedPreKey });
        }
        if (pendingBundleUpload.oneTimePreKeys?.length) {
          await rpcChannel.request('keys.replenishOpk', { oneTimePreKeys: pendingBundleUpload.oneTimePreKeys });
        }
      } else if (sessionInfo.remainingOpks < 20) {
        const moreOpks = await cryptoWorker.call('replenishOneTimePreKeys', { count: 50 });
        await rpcChannel.request('keys.replenishOpk', { oneTimePreKeys: moreOpks });
      }

      await syncMailbox();
      await flushOutbox();
      notifyStore();
    } catch (err) {
      store.sessionAuthenticated = false;
      const msg = String(err?.message || '');
      // Если токен отвергнут сервером (например, холодный перезапуск без S3 или отзыв сессии) — возвращаем на экран входа
      if (msg.includes('Сессия недействительна') || msg.includes('401')) {
        store.me = null;
        await clientDb.set('me', null);
        store.authError = 'Сессия на узле истекла или узел был перезапущен. Выполните вход повторно.';
        notifyStore();
      }
    } finally {
      authSyncPromise = null;
    }
  })();

  return authSyncPromise;
}

export async function connectActiveTransport(pendingBundleUpload = null) {
  clearTimeout(reconnectTimer);
  store.sessionAuthenticated = false;

  if (activeTransport) {
    await activeTransport.close('reconfigure').catch(() => {});
    activeTransport = null;
  }

  const transport = customTransportBuilder
    ? customTransportBuilder(store.settings)
    : new FallbackTransport({
        registry: transportRegistry,
        policy: store.settings.transportPolicy,
        transportConfig: {
          url: resolveDirectWsUrl(),
          pingIntervalMs: 18000,
          onionUrl: store.settings.onionUrl,
          i2pUrl: store.settings.i2pUrl,
          localBridgeUrl: store.settings.localBridgeUrl,
          coverTrafficIntervalMs: store.settings.coverTraffic ? 25000 : 0,
          getIceServers: async () => {
            if (!rpcChannel) return [];
            try {
              const { data } = await rpcChannel.request('turn.credentials', {});
              return data.iceServers || [];
            } catch {
              return [];
            }
          },
          sendSignal: async (peerId, signalObject) => {
            const chat = store.chats[`dm:${peerId}`];
            if (!chat || !rpcChannel) throw new Error('Контакт для P2P-сигналинга не открыт');
            await ensureOutgoingSessionForChat(chat);
            const { sealedBytes } = await cryptoWorker.call('encryptMessageForPeer', {
              peerId,
              payloadObject: { kind: 'rtc-signal', signal: signalObject },
            });
            const writeProof = await computeMailboxWriteProof(chat.mailboxWriteToken, sealedBytes);
            await rpcChannel.request(
              'webrtc.signal',
              { mailboxId: chat.mailboxId, writeProof },
              { body: sealedBytes }
            );
          },
        },
      });

  activeTransport = transport;
  store.activeTransportId = transport.id;

  if (!rpcChannel) {
    rpcChannel = new TransportRpcChannel(transport);
    bindServerPushEvents(rpcChannel);
  } else {
    rpcChannel.attachTransport(transport);
  }

  transport.onStateChange((state, detail) => {
    if (activeTransport !== transport) return;
    store.transportState = state;
    if (detail?.activeId) store.activeTransportId = detail.activeId;
    if (detail?.rttMs || transport.rttMs) store.rttMs = detail?.rttMs || transport.rttMs;

    if (state === TRANSPORT_STATE.CONNECTED && store.me?.token) {
      // Критично: при каждом внутреннем переподключении FallbackTransport заново привязываем mailboxId на сервере
      store.sessionAuthenticated = false;
      authenticateAndSyncTransport().catch(() => {});
    } else if (state === TRANSPORT_STATE.DISCONNECTED && store.me) {
      store.sessionAuthenticated = false;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => connectActiveTransport().catch(() => {}), 2200);
    }
    notifyStore();
  });

  try {
    await transport.connect();
    store.rttMs = transport.rttMs;
    if (store.me?.token) {
      await authenticateAndSyncTransport(pendingBundleUpload);
    }
  } catch {
    store.transportState = TRANSPORT_STATE.DISCONNECTED;
    store.sessionAuthenticated = false;
    notifyStore();
    if (store.me) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => connectActiveTransport().catch(() => {}), 3000);
    }
  }
}

function bindServerPushEvents(rpc) {
  rpc.onEvent('mailbox.envelope', (meta, sealedBytes) => {
    const copy = new Uint8Array(sealedBytes);
    enqueueIncomingTask(async () => {
      if (meta?.id && processedEnvelopeIds.has(meta.id)) {
        rpc.request('mailbox.ack', { ids: [meta.id] }).catch(() => {});
        return;
      }
      await processIncomingEnvelope(meta?.id, copy);
    });
  });

  rpc.onEvent('ask.new', (askItem) => {
    enqueueIncomingTask(() => processIncomingAsk(askItem));
  });

  rpc.onEvent('webrtc.signal', (_meta, sealedBytes) => {
    const copy = new Uint8Array(sealedBytes);
    enqueueIncomingTask(async () => {
      try {
        const dec = await cryptoWorker.call('decryptIncomingSealedEnvelope', { sealedBytes: copy });
        if (dec?.payload?.kind === 'rtc-signal') {
          const inner = activeTransport?.activeTransport || activeTransport;
          if (inner && typeof inner.handleIncomingSignal === 'function') {
            await inner.handleIncomingSignal(dec.senderId, dec.payload.signal);
          }
        }
      } catch { /* игнорируем устаревший пакет ICE */ }
    });
  });

  rpc.onEvent('keys.lowOpk', async () => {
    try {
      const moreOpks = await cryptoWorker.call('replenishOneTimePreKeys', { count: 50 });
      await rpc.request('keys.replenishOpk', { oneTimePreKeys: moreOpks });
    } catch { /* ignore */ }
  });
}

async function syncMailbox() {
  if (!rpcChannel || !store.me || !activeTransport?.isConnected) return;
  const { data } = await rpcChannel.request('mailbox.pull', { limit: 100 });

  return enqueueIncomingTask(async () => {
    const ackIds = [];
    for (const env of data.envelopes || []) {
      if (processedEnvelopeIds.has(env.id)) {
        ackIds.push(env.id);
        continue;
      }
      try {
        const bytes = fromBase64Url(env.blobB64);
        await processIncomingEnvelope(env.id, bytes, { skipImmediateAck: true });
        ackIds.push(env.id);
      } catch (err) {
        console.warn('[mailbox] ошибка обработки конверта:', err.message);
        ackIds.push(env.id);
      }
    }

    const askAckIds = [];
    for (const ask of data.asks || []) {
      await processIncomingAsk(ask, { skipImmediateAck: true });
      askAckIds.push(ask.id);
    }

    if (ackIds.length || askAckIds.length) {
      await rpcChannel.request('mailbox.ack', { ids: ackIds, askIds: askAckIds }).catch(() => {});
    }
  });
}

async function processIncomingEnvelope(envId, sealedBytes, { skipImmediateAck = false } = {}) {
  const dec = await cryptoWorker.call(
    'decryptIncomingSealedEnvelope',
    { sealedBytes: new Uint8Array(sealedBytes) },
    []
  );
  rememberProcessedEnvelope(envId);

  if (!skipImmediateAck && envId && rpcChannel) {
    rpcChannel.request('mailbox.ack', { ids: [envId] }).catch(() => {});
  }

  const peerId = dec.senderId;
  const payload = dec.payload || {};
  if (payload.kind === 'rtc-signal') return;

  const chatId = `dm:${peerId}`;

  if (!store.chats[chatId]) {
    let peerInfo = null;
    try {
      peerInfo = (await rpcChannel.request('directory.bundle', { query: peerId })).data;
    } catch { /* профиль может быть недоступен */ }

    const uname = peerInfo?.username || dec.senderIdentity?.username || peerId.slice(0, 12);
    store.chats[chatId] = {
      id: chatId,
      kind: 'dm',
      peerId,
      username: uname,
      title: peerInfo?.username ? `@${peerInfo.username}` : `Контакт ${peerId.slice(2, 8)}`,
      mailboxId: payload.replyMailbox?.mailboxId || peerInfo?.mailboxId || '',
      mailboxWriteToken: payload.replyMailbox?.mailboxWriteToken || peerInfo?.mailboxWriteToken || '',
      avatarColor: pickColor(peerId),
      verified: false,
      muted: false,
      ttlSec: payload.ttlSec || 0,
      unread: 0,
      lastPreview: '',
      lastTs: Date.now(),
    };
  } else if (payload.replyMailbox?.mailboxId) {
    store.chats[chatId].mailboxId = payload.replyMailbox.mailboxId;
    store.chats[chatId].mailboxWriteToken = payload.replyMailbox.mailboxWriteToken;
  }

  if (payload.type === 'reaction' && payload.targetMsgId) {
    applyReactionLocal(chatId, payload.targetMsgId, peerId, payload.emoji);
    await persistChatsAndMessages();
    notifyStore();
    return;
  }

  if (payload.type === 'ttl-update') {
    store.chats[chatId].ttlSec = Number(payload.ttlSec) || 0;
    await persistChatsAndMessages();
    notifyStore();
    return;
  }

  const msgId = payload.msgId || `m_${toBase64Url(randomBytes(8))}`;
  const list = store.messages[chatId] || (store.messages[chatId] = []);
  if (list.some((m) => m.id === msgId)) return;

  const ttlSec = Number(payload.ttlSec || store.chats[chatId].ttlSec || 0);
  const now = Date.now();
  const msg = {
    id: msgId,
    chatId,
    out: false,
    type: payload.type || 'text',
    text: payload.text || '',
    replyTo: payload.replyTo || null,
    media: payload.media || null,
    reactions: {},
    ts: dec.sentAt || now,
    ttlSec,
    expiresAt: ttlSec > 0 ? now + ttlSec * 1000 : 0,
    status: 'delivered',
  };

  list.push(msg);
  const chat = store.chats[chatId];
  chat.lastTs = msg.ts;
  chat.lastPreview = msg.media
    ? (msg.media.once ? '[1×] Вложение' : `[Файл] ${msg.media.name}`)
    : msg.text.slice(0, 90);

  if (store.ui.activeChatId !== chatId) {
    chat.unread = (chat.unread || 0) + 1;
  }
  if (store.settings.sound && !chat.muted && !store.ui.bossActive) {
    playSfx('incoming');
  }

  await persistChatsAndMessages();
  notifyStore();
}

async function processIncomingAsk(askItem, { skipImmediateAck = false } = {}) {
  try {
    const text = await cryptoWorker.call('decryptAsk', { payloadB64: askItem.payloadB64 });
    if (!skipImmediateAck && rpcChannel) {
      rpcChannel.request('mailbox.ack', { ids: [], askIds: [askItem.id] }).catch(() => {});
    }
    const chatId = 'ask:inbox';
    if (!store.chats[chatId]) {
      store.chats[chatId] = {
        id: chatId,
        kind: 'ask',
        peerId: 'anon',
        username: 'gateway',
        title: 'Входящий шлюз E2E',
        avatarColor: '#1E3A5F',
        verified: true,
        muted: false,
        ttlSec: 0,
        unread: 0,
        lastPreview: '',
        lastTs: Date.now(),
      };
    }
    const list = store.messages[chatId] || (store.messages[chatId] = []);
    if (list.some((m) => m.id === askItem.id)) return;
    list.push({
      id: askItem.id,
      chatId,
      out: false,
      type: 'ask',
      text,
      senderBlockTag: askItem.senderBlockTag,
      ts: Date.now(),
      ttlSec: 0,
      expiresAt: 0,
      reactions: {},
    });
    const chat = store.chats[chatId];
    chat.lastPreview = text.slice(0, 80);
    chat.lastTs = Date.now();
    if (store.ui.activeChatId !== chatId) chat.unread = (chat.unread || 0) + 1;
    if (store.settings.sound && !store.ui.bossActive) playSfx('incoming');
    await persistChatsAndMessages();
    notifyStore();
  } catch (err) {
    console.warn('[ask] не удалось расшифровать обращение:', err.message);
  }
}

// ─────────────────────── Регистрация, Вход и Выход ───────────────────────

async function postJson(url, body) {
  const res = await fetch(resolveApiUrl(url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({ error: 'Некорректный ответ сервера' }));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function registerAccount({ username, password, inviteCode = '' }) {
  store.busy = true;
  store.authError = '';
  notifyStore();
  try {
    const cleanUser = username.trim().replace(/^@/, '').toLowerCase();
    const userId = `u_${toBase64Url(randomBytes(15))}`;

    const [pow, zkAuth, provisioned] = await Promise.all([
      postJson('/api/auth/pow', { purpose: 'register' }),
      cryptoWorker.call('prepareZkRegistration', { username: cleanUser, password }),
      cryptoWorker.call('provisionIdentity', { userId, opkCount: 50, createRecoveryKit: true }),
    ]);

    const powNonce = await cryptoWorker.call('solvePow', pow);
    const reg = await postJson('/api/auth/register', {
      username: cleanUser,
      inviteCode,
      powChallenge: pow.challengeToken,
      powNonce,
      authPubB64: zkAuth.authPubB64,
      encryptedAuthKey: zkAuth.encryptedAuthKey,
      publicBundle: provisioned.publicBundle,
      encryptedRecovery: provisioned.recoveryKit?.encryptedBackup || null,
    });

    store.me = {
      userId: reg.userId,
      username: reg.username,
      token: reg.token,
      mailboxId: reg.mailboxId,
      mailboxWriteToken: reg.mailboxWriteToken,
    };
    store.recoveryModalKey = provisioned.recoveryKit?.recoveryKey || null;

    store.chats = {
      'ask:inbox': {
        id: 'ask:inbox',
        kind: 'ask',
        peerId: 'anon',
        username: reg.username,
        title: 'Входящий шлюз E2E',
        avatarColor: '#1E3A5F',
        verified: true,
        muted: false,
        ttlSec: 0,
        unread: 0,
        lastPreview: `Адрес приёма: /q/${reg.username}`,
        lastTs: Date.now(),
      },
    };
    store.messages = {
      'ask:inbox': [
        {
          id: 'welcome_ask',
          chatId: 'ask:inbox',
          out: false,
          type: 'highlight',
          text: `Внешний приёмник зашифрованных обращений активен по адресу ${location.origin}/q/${reg.username}. Отправитель шифрует текст вашим публичным ключом ECDH P-256 без регистрации; сервер не хранит IP-адрес и метаданные.`,
          ts: Date.now(),
          ttlSec: 0,
          expiresAt: 0,
          reactions: {},
        },
      ],
    };
    store.ui.activeChatId = 'ask:inbox';

    await clientDb.set('me', store.me);
    await persistChatsAndMessages();
    await connectActiveTransport();
  } catch (err) {
    store.authError = err.message;
  } finally {
    store.busy = false;
    notifyStore();
  }
}

export async function loginAccount({ username, password, recoveryKey = '' }) {
  store.busy = true;
  store.authError = '';
  notifyStore();
  try {
    const cleanUser = username.trim().replace(/^@/, '').toLowerCase();
    const ch = await postJson('/api/auth/challenge', { username: cleanUser });
    const sig = await cryptoWorker.call('solveZkLogin', {
      username: cleanUser,
      password,
      encryptedAuthKey: ch.encryptedAuthKey,
      challengeNonce: ch.challengeNonce,
    });
    const res = await postJson('/api/auth/login', {
      username: cleanUser,
      challengeNonce: ch.challengeNonce,
      signatureB64: sig,
    });

    let recoveredBundle = null;
    const workerState = await cryptoWorker.call('init');
    if (!workerState.hasIdentity || workerState.publicIdentity?.userId !== res.userId) {
      if (!res.encryptedRecovery || !recoveryKey.trim()) {
        throw new Error('Вход с нового устройства: введите 52-символьный Ключ восстановления (Recovery Key)');
      }
      const imported = await cryptoWorker.call('importRecoveryKit', {
        encryptedBackup: res.encryptedRecovery,
        recoveryKey: recoveryKey.trim(),
      });
      recoveredBundle = imported.publicBundle || null;
    }

    store.me = {
      userId: res.userId,
      username: res.username,
      token: res.token,
      mailboxId: res.mailboxId,
      mailboxWriteToken: res.mailboxWriteToken,
    };
    store.chats = normalizeStoredChats((await clientDb.get('chats', {})) || {});
    store.messages = (await clientDb.get('messages', {})) || {};
    store.outbox = (await clientDb.get('outbox', [])) || [];

    await clientDb.set('me', store.me);
    await connectActiveTransport(recoveredBundle);
  } catch (err) {
    store.authError = err.message;
  } finally {
    store.busy = false;
    notifyStore();
  }
}

export async function logoutAndWipeDevice() {
  clearInterval(syncLoopTimer);
  if (activeTransport) await activeTransport.close('logout').catch(() => {});
  await clientDb.clearAll();
  cryptoWorker.terminate();
  location.reload();
}

// ─────────────────────── Чаты, Гарантированная Доставка и Файлы E2E ───────────────────────

/**
 * Добавляет контакт в список диалогов и фиксирует его ключ безопасности (TOFU),
 * НЕ расходуя OPK и НЕ создавая полуоткрытую сессию до фактической отправки первого сообщения.
 * Это исключает коллизию, когда оба собеседника добавляют друг друга одновременно.
 */
export async function startChatWithUsername(query) {
  const clean = String(query || '').trim().replace(/^@/, '').toLowerCase();
  if (!clean) return;
  if (clean === store.me?.username) {
    showToast('Нельзя открыть внешний диалог с собственным идентификатором', 'err');
    return;
  }

  if (!activeTransport?.isConnected || !store.sessionAuthenticated) {
    await syncNow();
  }

  const { data: bundle } = await rpcChannel.request('directory.bundle', { query: clean });
  await cryptoWorker.call('savePeerIdentity', { peerIdentity: bundle.identity });

  const chatId = `dm:${bundle.userId}`;
  const existing = store.chats[chatId];
  store.chats[chatId] = {
    id: chatId,
    kind: 'dm',
    peerId: bundle.userId,
    username: bundle.username,
    title: `@${bundle.username}`,
    mailboxId: bundle.mailboxId,
    mailboxWriteToken: bundle.mailboxWriteToken,
    avatarColor: existing?.avatarColor || pickColor(bundle.userId),
    verified: Boolean(existing?.verified),
    muted: Boolean(existing?.muted),
    ttlSec: existing?.ttlSec || 0,
    unread: existing?.unread || 0,
    lastPreview: existing?.lastPreview || 'Канал E2E готов · Double Ratchet',
    lastTs: Date.now(),
    cachedBundle: bundle,
  };
  if (!store.messages[chatId]) store.messages[chatId] = [];
  selectChat(chatId);
  await persistChatsAndMessages();
  showToast(`Контакт @${bundle.username} проверен и добавлен`);
}

/** Ленивая инициализация исходящей X3DH-сессии непосредственно перед отправкой первого пакета */
async function ensureOutgoingSessionForChat(chat) {
  const status = await cryptoWorker.call('hasPeerSession', { peerId: chat.peerId });
  if (status.ready) return;

  let bundle = chat.cachedBundle || null;
  if (!bundle && rpcChannel && activeTransport?.isConnected) {
    const res = await rpcChannel.request('directory.bundle', {
      query: chat.username || chat.peerId,
    });
    bundle = res.data;
    chat.mailboxId = bundle.mailboxId;
    chat.mailboxWriteToken = bundle.mailboxWriteToken;
  }
  if (!bundle) {
    throw new Error('Узел недоступен для получения PreKeyBundle собеседника');
  }
  chat.cachedBundle = null;
  await cryptoWorker.call('establishOutgoingSession', { peerBundle: bundle });
}

export function selectChat(chatId) {
  store.ui.activeChatId = chatId;
  store.ui.replyTo = null;
  if (store.chats[chatId]) {
    store.chats[chatId].unread = 0;
    persistChatsAndMessages();
  }
  notifyStore();
}

export async function sendChatMessage(chatId, text, extra = {}) {
  const chat = store.chats[chatId];
  if (!chat || chat.kind === 'ask') return;
  const trimmed = String(text || '').trim();
  if (!trimmed && !extra.media) return;

  const msgId = `m_${toBase64Url(randomBytes(9))}`;
  const ttlSec = extra.ttlSec !== undefined ? extra.ttlSec : (chat.ttlSec || 0);
  const now = Date.now();
  const replyObj = store.ui.replyTo
    ? { id: store.ui.replyTo.id, text: (store.ui.replyTo.text || '').slice(0, 120), out: store.ui.replyTo.out }
    : null;

  const localMsg = {
    id: msgId,
    chatId,
    out: true,
    type: extra.type || (extra.media ? 'media' : 'text'),
    text: trimmed,
    replyTo: replyObj,
    media: extra.media || null,
    reactions: {},
    ts: now,
    ttlSec,
    expiresAt: ttlSec > 0 ? now + ttlSec * 1000 : 0,
    status: 'sending',
  };

  store.ui.replyTo = null;
  const list = store.messages[chatId] || (store.messages[chatId] = []);
  list.push(localMsg);
  chat.lastTs = now;
  chat.lastPreview = localMsg.media
    ? (localMsg.media.once ? '[1×] Вложение' : `[Файл] ${localMsg.media.name}`)
    : trimmed.slice(0, 90);
  notifyStore();

  const wirePayload = {
    msgId,
    type: localMsg.type,
    text: trimmed,
    replyTo: replyObj,
    media: extra.media || null,
    ttlSec,
    replyMailbox: {
      mailboxId: store.me.mailboxId,
      mailboxWriteToken: store.me.mailboxWriteToken,
    },
  };

  await deliverPayloadToPeer(chat, wirePayload, localMsg);
  await persistChatsAndMessages();
}

/**
 * Доставляет полезную нагрузку собеседнику через слепой ретранслятор:
 * 1) Гарантирует сессию X3DH и шифрует пакет ОДИН раз (сохраняя целостность цепочки Double Ratchet).
 * 2) Если ящик собеседника был ротирован (403/404) — автоматически обновляет адрес ящика и повторяет доставку.
 * 3) Если сеть недоступна — сохраняет уже зашифрованный конверт в Outbox для мгновенной досылки при связи.
 */
async function sendSealedEnvelopeWithRefresh(chat, sealedBytes, ttlSec) {
  if (!rpcChannel || !activeTransport?.isConnected) {
    throw new Error('offline');
  }
  if (!store.sessionAuthenticated && store.me?.token) {
    await authenticateAndSyncTransport();
  }

  const effectiveTtl = ttlSec > 0 ? Math.max(300, ttlSec * 2) : 14 * 86400;

  const attemptDrop = async () => {
    const writeProof = await computeMailboxWriteProof(chat.mailboxWriteToken, sealedBytes);
    await rpcChannel.request(
      'relay.drop',
      {
        mailboxId: chat.mailboxId,
        writeProof,
        ttlSec: effectiveTtl,
      },
      { body: sealedBytes }
    );
  };

  try {
    await attemptDrop();
  } catch (err) {
    const msg = String(err?.message || '');
    const mailboxStale =
      msg.includes('Почтовый ящик') ||
      msg.includes('недействительный токен') ||
      msg.includes('Недействительный токен') ||
      msg.includes('404') ||
      msg.includes('403');

    if (mailboxStale && chat.username) {
      const { data: fresh } = await rpcChannel.request('directory.bundle', { query: chat.username });
      chat.mailboxId = fresh.mailboxId;
      chat.mailboxWriteToken = fresh.mailboxWriteToken;
      await persistChatsAndMessages();
      await attemptDrop();
      return;
    }
    throw err;
  }
}

async function deliverPayloadToPeer(chat, wirePayload, localMsg = null) {
  let sealedB64 = null;
  try {
    await ensureOutgoingSessionForChat(chat);
    const { sealedBytes } = await cryptoWorker.call('encryptMessageForPeer', {
      peerId: chat.peerId,
      payloadObject: wirePayload,
    });
    sealedB64 = toBase64Url(sealedBytes);

    await sendSealedEnvelopeWithRefresh(chat, sealedBytes, wirePayload.ttlSec || 0);

    if (localMsg) {
      localMsg.status = 'sent';
      if (store.settings.sound) playSfx('sent');
    }
  } catch {
    if (localMsg) localMsg.status = 'queued';
    store.outbox.push({
      id: toBase64Url(randomBytes(8)),
      chatId: chat.id,
      msgId: localMsg?.id || null,
      peerId: chat.peerId,
      username: chat.username || '',
      mailboxId: chat.mailboxId,
      mailboxWriteToken: chat.mailboxWriteToken,
      sealedB64,
      wirePayload: sealedB64 ? null : wirePayload,
      ttlSec: wirePayload.ttlSec || 0,
    });
    await clientDb.set('outbox', store.outbox);
  }
  notifyStore();
}

async function flushOutbox() {
  if (flushInFlight || !store.outbox.length || !rpcChannel || !activeTransport?.isConnected) return;
  flushInFlight = true;
  try {
    const queue = [...store.outbox];
    const remaining = [];

    for (const item of queue) {
      try {
        const chat = store.chats[item.chatId] || {
          id: item.chatId,
          peerId: item.peerId,
          username: item.username,
          mailboxId: item.mailboxId,
          mailboxWriteToken: item.mailboxWriteToken,
        };

        let sealedBytes;
        if (item.sealedB64) {
          sealedBytes = fromBase64Url(item.sealedB64);
        } else {
          await ensureOutgoingSessionForChat(chat);
          const enc = await cryptoWorker.call('encryptMessageForPeer', {
            peerId: item.peerId,
            payloadObject: item.wirePayload,
          });
          sealedBytes = enc.sealedBytes;
          item.sealedB64 = toBase64Url(sealedBytes);
          item.wirePayload = null;
        }

        await sendSealedEnvelopeWithRefresh(chat, sealedBytes, item.ttlSec || 0);

        const list = store.messages[item.chatId] || [];
        const msg = list.find((x) => x.id === item.msgId);
        if (msg) msg.status = 'sent';
      } catch {
        remaining.push(item);
      }
    }

    store.outbox = remaining;
    await clientDb.set('outbox', store.outbox);
    await persistChatsAndMessages();
    notifyStore();
  } finally {
    flushInFlight = false;
  }
}

/** Шифрует файл в CryptoWorker (AES-256-GCM) до загрузки и передаёт ключи строго внутри Double Ratchet */
export async function sendEncryptedAttachment(chatId, file, { once = false, caption = '' } = {}) {
  const chat = store.chats[chatId];
  if (!chat) return;

  try {
    showToast(`Шифрование "${file.name}" (AES-256-GCM)…`);
    const rawBuf = new Uint8Array(await file.arrayBuffer());
    const { encryptedBytes, descriptor } = await cryptoWorker.call(
      'encryptFile',
      {
        bytes: rawBuf,
        meta: { name: file.name, mime: file.type || 'application/octet-stream', once },
      },
      [rawBuf.buffer]
    );

    const res = await fetch(resolveApiUrl('/api/blob'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${store.me.token}`,
        'content-type': 'application/octet-stream',
        'x-veil-once': once ? '1' : '0',
      },
      body: encryptedBytes,
    });
    const up = await res.json();
    if (!res.ok || up.error) throw new Error(up.error || 'Не удалось загрузить шифроблоб');

    const mediaPayload = {
      blobId: up.blobId,
      burnToken: up.burnToken || null,
      once: Boolean(once),
      name: descriptor.name,
      mime: descriptor.mime,
      size: descriptor.size,
      descriptor,
    };

    await sendChatMessage(chatId, caption, { type: 'media', media: mediaPayload });
  } catch (err) {
    showToast(err.message, 'err');
  }
}

/** Скачивает шифроблоб, проверяет SHA-256 и расшифровывает его внутри CryptoWorker */
export async function openEncryptedMedia(msg) {
  if (!msg?.media?.blobId) return null;
  const { blobId, burnToken, once, descriptor, mime } = msg.media;

  if (!once && store.decryptedMediaUrls[blobId]) {
    return store.decryptedMediaUrls[blobId];
  }

  try {
    const headers = {};
    if (once && burnToken) headers['x-veil-burn-token'] = burnToken;
    const res = await fetch(resolveApiUrl(`/api/blob/${blobId}`), { headers });
    if (res.status === 404) {
      msg.media.burned = true;
      await persistChatsAndMessages();
      notifyStore();
      throw new Error('Вложение однократного просмотра уже было открыто и физически удалено с узла');
    }
    if (!res.ok) throw new Error(`Ошибка загрузки вложения (${res.status})`);

    const encBytes = new Uint8Array(await res.arrayBuffer());
    const plainBytes = await cryptoWorker.call(
      'decryptFile',
      { bytes: encBytes, descriptor },
      [encBytes.buffer]
    );

    const blobUrl = URL.createObjectURL(new Blob([plainBytes], { type: mime || 'application/octet-stream' }));
    if (once) {
      msg.media.burned = true;
      await persistChatsAndMessages();
      store.ui.modal = 'once-viewer';
      store.ui.modalData = { url: blobUrl, mime, name: msg.media.name };
      if (store.settings.sound) playSfx('burn');
      notifyStore();
    } else {
      store.decryptedMediaUrls[blobId] = blobUrl;
      notifyStore();
    }
    return blobUrl;
  } catch (err) {
    showToast(err.message, 'err');
    return null;
  }
}

export async function toggleMessageReaction(chatId, msgId, emoji) {
  const chat = store.chats[chatId];
  if (!chat || chat.kind !== 'dm') return;
  applyReactionLocal(chatId, msgId, store.me.userId, emoji);
  await persistChatsAndMessages();
  notifyStore();
  await deliverPayloadToPeer(chat, { type: 'reaction', targetMsgId: msgId, emoji });
}

function applyReactionLocal(chatId, msgId, actorId, emoji) {
  const list = store.messages[chatId] || [];
  const m = list.find((x) => x.id === msgId);
  if (!m) return;
  m.reactions = m.reactions || {};
  const arr = m.reactions[emoji] || [];
  if (arr.includes(actorId)) {
    m.reactions[emoji] = arr.filter((u) => u !== actorId);
    if (!m.reactions[emoji].length) delete m.reactions[emoji];
  } else {
    m.reactions[emoji] = [...arr, actorId];
  }
}

export async function setChatTtl(chatId, ttlSec) {
  const chat = store.chats[chatId];
  if (!chat) return;
  chat.ttlSec = Number(ttlSec) || 0;
  await persistChatsAndMessages();
  notifyStore();
  if (chat.kind === 'dm') {
    await deliverPayloadToPeer(chat, { type: 'ttl-update', ttlSec: chat.ttlSec });
  }
}

export async function openSafetyVerificationModal(chatId) {
  const chat = store.chats[chatId];
  if (!chat || chat.kind !== 'dm') return;
  try {
    const sn = await cryptoWorker.call('getSafetyNumber', { peerId: chat.peerId });
    store.ui.modal = 'safety';
    store.ui.modalData = { chatId, chat, safetyNumber: sn };
    notifyStore();
  } catch (err) {
    showToast(err.message, 'err');
  }
}

export async function markPeerVerified(chatId, verified = true) {
  const chat = store.chats[chatId];
  if (!chat) return;
  chat.verified = verified;
  await persistChatsAndMessages();
  store.ui.modal = null;
  showToast(verified ? 'Отпечаток безопасности собеседника подтверждён' : 'Отметка верификации снята');
  notifyStore();
}

export async function blockAnonQuestionAuthor(senderBlockTag) {
  if (!rpcChannel || !senderBlockTag) return;
  await rpcChannel.request('ask.block', { senderBlockTag });
  showToast('Отправитель заблокирован по слепому HMAC-идентификатору');
}

export async function rotateBlindMailbox() {
  if (!rpcChannel) return;
  const { data } = await rpcChannel.request('mailbox.rotate');
  store.me.mailboxId = data.mailboxId;
  store.me.mailboxWriteToken = data.mailboxWriteToken;
  await clientDb.set('me', store.me);
  showToast('Адрес слепого почтового ящика перевыпущен. Прежние токены отозваны.');
  notifyStore();
}

export async function updateClientSettings(patch) {
  Object.assign(store.settings, patch);
  if (patch.serverUrl !== undefined) {
    const raw = (patch.serverUrl || '').trim().replace(/\/+$/, '');
    if (raw.includes('.onion')) {
      const host = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      store.settings.onionUrl = `ws://${host}/ws`;
      store.settings.transportPolicy = TRANSPORT_POLICY.TOR_ONLY;
    }
    syncAndroidNativeBridge();
  }
  await clientDb.set('settings', store.settings);
  notifyStore();
  if (
    patch.serverUrl !== undefined ||
    patch.transportPolicy !== undefined ||
    patch.onionUrl !== undefined ||
    patch.i2pUrl !== undefined ||
    patch.coverTraffic !== undefined
  ) {
    if (store.me) await connectActiveTransport();
  }
}

/** Экстренная блокировка экрана (двойной Esc или кнопка в заголовке) */
export function toggleBossMode(forceValue) {
  const next = typeof forceValue === 'boolean' ? forceValue : !store.ui.bossActive;
  store.ui.bossActive = next;
  if (typeof document !== 'undefined') {
    document.title = next ? store.settings.bossDocTitle : 'MeshChat — Защищённый мессенджер';
  }
  if (next && store.settings.strictBossWipe) {
    cryptoWorker.call('lockRamCache').catch(() => {});
  }
  notifyStore();
}

async function purgeExpiredMessagesTick() {
  const now = Date.now();
  let changed = false;
  for (const chatId of Object.keys(store.messages)) {
    const prev = store.messages[chatId];
    if (!prev?.length) continue;
    const next = prev.filter((m) => !m.expiresAt || m.expiresAt > now);
    if (next.length !== prev.length) {
      store.messages[chatId] = next;
      changed = true;
    }
  }
  if (changed) {
    await persistChatsAndMessages();
    notifyStore();
  }
}

async function persistChatsAndMessages() {
  await Promise.all([
    clientDb.set('chats', store.chats),
    clientDb.set('messages', store.messages),
  ]);
}
