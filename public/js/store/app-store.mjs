// Центральное реактивное состояние MeshChat v1.3 (Offline-First + Self-Healing ZK Session).
// Связывает изолированный CryptoWorker, мультитранспортный канал, зашифрованную IndexedDB
// (+ AndroidKeyStore Vault), кастомные E2E-профили, движок тем и автообновление GitHub Releases.

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

// Палитра аватаров контактов (глубокие благородные оттенки)
const AVATAR_PALETTE = [
  '#3B4CCA', '#2563EB', '#0E7490', '#4F46E5',
  '#047857', '#6D28D9', '#BE185D', '#1D4ED8',
];

export function pickColor(seedStr = '') {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export const APP_VERSION = '1.4.0';
export const APP_VERSION_CODE = 5;
export const GITHUB_REPO = 'Knox1986X/MeshChat';
export const DEFAULT_CLOUD_URL = 'https://meshchat-6a11.onrender.com';

// Предустановленные темы оформления приложения
export const THEME_PRESETS = {
  obsidian: {
    id: 'obsidian',
    label: 'Obsidian Indigo',
    bg0: '#0b0d14',
    bg1: '#111420',
    bg2: '#171b2a',
    bg3: '#1f2538',
    accent: '#6d7cff',
    bubbleOut: '#263159',
  },
  amoled: {
    id: 'amoled',
    label: 'AMOLED Pitch',
    bg0: '#040507',
    bg1: '#0a0c12',
    bg2: '#12151f',
    bg3: '#1a1e2c',
    accent: '#7b89ff',
    bubbleOut: '#1e2749',
  },
  emerald: {
    id: 'emerald',
    label: 'Cyber Emerald',
    bg0: '#060c0a',
    bg1: '#0b1512',
    bg2: '#11201b',
    bg3: '#192e27',
    accent: '#10b981',
    bubbleOut: '#11382c',
  },
  arctic: {
    id: 'arctic',
    label: 'Arctic Cyan',
    bg0: '#060b11',
    bg1: '#0b131d',
    bg2: '#111d2c',
    bg3: '#192a3e',
    accent: '#06b6d4',
    bubbleOut: '#113647',
  },
  royal: {
    id: 'royal',
    label: 'Royal Amethyst',
    bg0: '#0a0712',
    bg1: '#120d1f',
    bg2: '#1b142e',
    bg3: '#261d40',
    accent: '#a855f7',
    bubbleOut: '#2e1a4a',
  },
  crimson: {
    id: 'crimson',
    label: 'Crimson Ops',
    bg0: '#0f070a',
    bg1: '#180c11',
    bg2: '#231219',
    bg3: '#311a24',
    accent: '#f43f5e',
    bubbleOut: '#421826',
  },
};

export const BANNER_PRESETS = {
  indigo: 'linear-gradient(135deg, #1b2242 0%, #0d1021 60%, #161d38 100%)',
  amoled: 'linear-gradient(180deg, #12141c 0%, #06070a 100%)',
  aurora: 'linear-gradient(135deg, #0f393b 0%, #14192e 55%, #2a1842 100%)',
  cyber: 'linear-gradient(135deg, #0b2f44 0%, #0a101d 70%, #132c3d 100%)',
  crimson: 'linear-gradient(135deg, #3b1322 0%, #0f0a12 70%, #241023 100%)',
  gold: 'linear-gradient(135deg, #332611 0%, #0e0d12 70%, #241d12 100%)',
};

function compareSemver(a = '0.0.0', b = '0.0.0') {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function hexToRgba(hex, alpha = 0.16) {
  const clean = String(hex || '#6d7cff').replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16) || 0x6d7cff;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const store = {
  booting: true,
  busy: false,
  authError: '',
  me: null, // { userId, username, token, mailboxId, mailboxWriteToken, publicKeyShort }
  recoveryModalKey: null,

  // Кастомный профиль пользователя (синхронизируется с контактами строго внутри E2EE)
  profile: {
    displayName: '',
    statusText: 'На связи · E2EE',
    bio: 'Сквозное шифрование Signal Protocol · Без метаданных',
    badge: 'verified',        // 'none' | 'verified' | 'star' | 'bolt' | 'shield' | 'diamond'
    avatarDataUrl: '',        // Сжатый локально аватар (data:image/jpeg;base64,...)
    bannerPreset: 'amoled',   // Ключ из BANNER_PRESETS или 'custom'
    bannerCustomColor: '#1b2242',
    particles: 'stars',       // 'stars' | 'snow' | 'constellation' | 'pulse' | 'none'
    updatedAt: 0,
  },

  // Кастомная тема и визуал приложения
  theme: {
    preset: 'obsidian',       // Ключ из THEME_PRESETS или 'custom'
    customAccent: '#6d7cff',
    customBg0: '#0b0d14',
    customBubble: '',
    avatarShape: 'squircle',  // 'squircle' | 'circle'
    bubbleRadius: 16,         // 10 | 16 | 22
    chatBackdrop: 'dots',     // 'none' | 'dots' | 'grid' | 'particles'
  },

  // Состояние автообновления (GitHub Releases + /api/version + SHA-256 проверка APK)
  update: {
    currentVersion: APP_VERSION,
    versionCode: APP_VERSION_CODE,
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

  // Состояние сети, мультитранспорта и телеметрии Mesh-узла
  transportState: TRANSPORT_STATE.DISCONNECTED,
  sessionAuthenticated: false,
  rehydratingSession: false,
  activeTransportId: 'ws',
  rttMs: null,
  serverEndpoints: { onion: null, i2p: null },
  meshStats: {
    packetsSent: 0,
    packetsReceived: 0,
    rttSamples: [],
    medianRttMs: null,
    lastProbeText: '',
    diagnostics: null,
    webrtcEnabled: true,
    relayEnabled: true,
  },
  android: {
    isApk: Boolean(globalThis.MeshChatAndroid),
    packageName: 'io.meshchat.app',
    legacyInstalled: false,
    lanMeshRunning: false,
    lanUrl: '',
  },
  settings: {
    serverUrl: globalThis.MeshChatAndroid ? DEFAULT_CLOUD_URL : '',
    autoUpdateCheck: true,
    transportPolicy: TRANSPORT_POLICY.AUTO,
    onionUrl: '',
    i2pUrl: '',
    localBridgeUrl: 'ws://127.0.0.1:27700',
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

  // Состояние интерфейса (5 разделов: Чаты, Контакты, Mesh, Профиль, Настройки)
  ui: {
    navTab: 'chats',      // 'chats' | 'contacts' | 'mesh' | 'profile' | 'settings'
    spaceFilter: 'all',   // 'all' | 'unread' | 'tor' | 'mesh' | 'ask'
    mobileTab: 'chats',
    activeChatId: null,
    inspectorOpen: false,
    searchQuery: '',
    replyTo: null,
    onceMode: false,
    bossActive: false,
    modal: null,          // null | 'new-chat' | 'safety' | 'settings' | 'once-viewer' | 'call' | 'peer-profile' | 'edit-profile' | 'theme-studio'
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

/** Применяет выбранную тему и кастомные цвета к CSS-переменным документа */
export function applyThemeToDom() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const t = store.theme;
  const base = THEME_PRESETS[t.preset] || THEME_PRESETS.obsidian;
  const isCustom = t.preset === 'custom';
  const accent = isCustom ? (t.customAccent || '#6d7cff') : base.accent;
  const bg0 = isCustom ? (t.customBg0 || '#0b0d14') : base.bg0;
  const bg1 = isCustom ? '#111420' : base.bg1;
  const bg2 = isCustom ? '#181d2d' : base.bg2;
  const bg3 = isCustom ? '#20263b' : base.bg3;
  const bubbleOut = t.customBubble || (isCustom ? hexToRgba(accent, 0.28) : base.bubbleOut);

  const root = document.documentElement.style;
  root.setProperty('--bg-0', bg0);
  root.setProperty('--bg-1', bg1);
  root.setProperty('--bg-2', bg2);
  root.setProperty('--bg-3', bg3);
  root.setProperty('--accent', accent);
  root.setProperty('--accent-hover', accent);
  root.setProperty('--accent-soft', hexToRgba(accent, 0.16));
  root.setProperty('--accent-glow', hexToRgba(accent, 0.34));
  root.setProperty('--bubble-out', bubbleOut);
  root.setProperty('--avatar-radius', t.avatarShape === 'circle' ? '50%' : '28%');
  root.setProperty('--bubble-radius', `${Number(t.bubbleRadius) || 16}px`);
  document.documentElement.dataset.backdrop = t.chatBackdrop || 'dots';
}

function recordRttSample(ms) {
  const val = Number(ms);
  if (!Number.isFinite(val) || val <= 0) return;
  store.rttMs = Math.round(val);
  const arr = [...store.meshStats.rttSamples.slice(-24), Math.round(val)];
  store.meshStats.rttSamples = arr;
  const sorted = [...arr].sort((a, b) => a - b);
  store.meshStats.medianRttMs = sorted[Math.floor(sorted.length / 2)];
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

export function registerTransportOrchestrator(builderFn) {
  customTransportBuilder = builderFn;
}

async function computeMailboxWriteProof(writeToken, bytes) {
  const mac = await hmacSha256(utf8ToBytes(writeToken), bytes);
  return toBase64Url(mac);
}

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
    if (typeof globalThis.MeshChatAndroid.getAppInfoJson === 'function') {
      const info = JSON.parse(globalThis.MeshChatAndroid.getAppInfoJson() || '{}');
      if (info.packageName) store.android.packageName = info.packageName;
      store.android.legacyInstalled = Boolean(info.legacyInstalled);
      if (info.bridgePort) {
        store.settings.localBridgeUrl = `ws://127.0.0.1:${info.bridgePort}`;
      }
    }
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

export function uninstallLegacyApk() {
  if (globalThis.MeshChatAndroid?.uninstallLegacyPackage) {
    globalThis.MeshChatAndroid.uninstallLegacyPackage();
  }
}

export function toggleAndroidLanMesh() {
  if (!globalThis.MeshChatAndroid?.toggleLanMesh) {
    showToast('Прямой Wi-Fi ретранслятор доступен в Android-приложении MeshChat.apk');
    return;
  }
  try {
    const next = !store.android.lanMeshRunning;
    const st = JSON.parse(globalThis.MeshChatAndroid.toggleLanMesh(next) || '{}');
    store.android.lanMeshRunning = Boolean(st.running);
    store.android.lanUrl = st.url || '';
    showToast(
      store.android.lanMeshRunning
        ? `Локальный узел запущен: ${store.android.lanUrl}`
        : 'Локальный узел остановлен'
    );
    notifyStore();
  } catch (err) {
    showToast(err.message, 'err');
  }
}

/** Создаёт системные чаты (Эхо-проверка E2EE + Входящий шлюз) и нормализует сохранённые */
function ensureSystemChats(chatsObj, username = '') {
  const next = chatsObj && typeof chatsObj === 'object' ? { ...chatsObj } : {};

  if (!next['echo:loopback']) {
    next['echo:loopback'] = {
      id: 'echo:loopback',
      kind: 'echo',
      peerId: 'self',
      username: 'echo',
      title: 'Эхо-проверка E2EE',
      avatarColor: '#4338CA',
      verified: true,
      pinned: true,
      muted: false,
      ttlSec: 0,
      unread: 0,
      lastPreview: 'Локальный сейф и самопроверка шифрования AES-256-GCM',
      lastTs: Date.now() - 1000,
    };
  } else {
    next['echo:loopback'].kind = 'echo';
    if (next['echo:loopback'].pinned === undefined) next['echo:loopback'].pinned = true;
  }

  if (!next['ask:inbox']) {
    next['ask:inbox'] = {
      id: 'ask:inbox',
      kind: 'ask',
      peerId: 'anon',
      username: username || 'gateway',
      title: 'Входящий шлюз E2E',
      avatarColor: '#1E3A5F',
      verified: true,
      pinned: false,
      muted: false,
      ttlSec: 0,
      unread: 0,
      lastPreview: username ? `Внешний приёмник: /q/${username}` : 'Внешний приёмник E2E',
      lastTs: Date.now() - 2000,
    };
  } else {
    next['ask:inbox'].title = 'Входящий шлюз E2E';
    next['ask:inbox'].avatarColor = '#1E3A5F';
  }

  for (const c of Object.values(next)) {
    if (c && typeof c.lastPreview === 'string') {
      c.lastPreview = c.lastPreview
        .replace(/^🔥\s*Одноразовое медиа/u, '[1×] Вложение')
        .replace(/^📎\s*/u, '[Файл] ')
        .replace(/^🎭\s*/u, '');
    }
  }
  return next;
}

function ensureSystemMessages(messagesObj, username = '') {
  const next = messagesObj && typeof messagesObj === 'object' ? { ...messagesObj } : {};
  if (!next['echo:loopback']?.length) {
    next['echo:loopback'] = [
      {
        id: 'echo_welcome',
        chatId: 'echo:loopback',
        out: false,
        type: 'highlight',
        text: 'Канал самопроверки E2EE и личных зашифрованных заметок. Отправьте любое сообщение: изолированный CryptoWorker зашифрует его с выравниванием ISO/IEC 7816-4 (кратно 512 Б), проверит целостность AES-256-GCM + SHA-256 и замерит задержку.',
        ts: Date.now() - 1000,
        ttlSec: 0,
        expiresAt: 0,
        reactions: {},
      },
    ];
  }
  if (!next['ask:inbox']?.length && username) {
    const originStr = typeof location !== 'undefined' ? location.origin : DEFAULT_CLOUD_URL;
    next['ask:inbox'] = [
      {
        id: 'welcome_ask',
        chatId: 'ask:inbox',
        out: false,
        type: 'highlight',
        text: `Внешний приёмник зашифрованных обращений активен по адресу ${originStr}/q/${username}. Отправитель шифрует сообщение вашим публичным ключом ECDH P-256 в браузере; узел не хранит IP-адрес.`,
        ts: Date.now() - 2000,
        ttlSec: 0,
        expiresAt: 0,
        reactions: {},
      },
    ];
  }
  return next;
}

export async function bootClientApp() {
  try {
    await clientDb.open();
    const workerState = await cryptoWorker.call('init');

    const [savedSettings, savedTheme, savedProfile] = await Promise.all([
      clientDb.get('settings', null),
      clientDb.get('theme', null),
      clientDb.get('profile', null),
    ]);
    if (savedSettings) Object.assign(store.settings, savedSettings);
    if (savedTheme) Object.assign(store.theme, savedTheme);
    if (savedProfile) Object.assign(store.profile, savedProfile);

    applyThemeToDom();
    syncAndroidNativeBridge();

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
    if (me?.userId && me?.username) {
      // Если IndexedDB воркера была сброшена ОС, но в AndroidKeyStore сохранился резервный комплект — восстанавливаем ключи
      let pendingRecoveredBundle = null;
      if (!workerState.hasIdentity && me.deviceVaultBackup?.encryptedBackup && me.deviceVaultBackup?.recoveryKey) {
        try {
          const restored = await cryptoWorker.call('importRecoveryKit', {
            encryptedBackup: me.deviceVaultBackup.encryptedBackup,
            recoveryKey: me.deviceVaultBackup.recoveryKey,
          });
          pendingRecoveredBundle = restored.publicBundle || null;
          if (me.zkBackup) {
            await cryptoWorker.call('saveZkMetadata', me.zkBackup);
          }
        } catch (e) {
          console.warn('[vault] ошибка восстановления ключей из резерва:', e.message);
        }
      }

      const freshInit = workerState.hasIdentity ? workerState : await cryptoWorker.call('init');
      if (freshInit.publicIdentity?.ikSignPub) {
        me.publicKeyShort = freshInit.publicIdentity.ikSignPub.slice(0, 22);
      }

      store.me = me;
      if (!store.profile.displayName) {
        store.profile.displayName = me.username;
      }
      store.chats = ensureSystemChats((await clientDb.get('chats', {})) || {}, me.username);
      store.messages = ensureSystemMessages((await clientDb.get('messages', {})) || {}, me.username);
      store.outbox = (await clientDb.get('outbox', [])) || [];

      const firstDm = Object.keys(store.chats).find((k) => k.startsWith('dm:'));
      const initialChat = firstDm || 'echo:loopback';
      if (typeof innerWidth === 'undefined' || innerWidth > 860) {
        store.ui.activeChatId = initialChat;
      }
      await connectActiveTransport(pendingRecoveredBundle);
    }
  } catch (err) {
    console.error('[boot]', err);
  } finally {
    store.booting = false;
    notifyStore();
  }

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
      syncAndroidNativeBridge();
      notifyStore();
      if (store.me) syncNow().catch(() => {});
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

export async function syncNow() {
  if (!store.me) return;
  if (!activeTransport || !activeTransport.isConnected) {
    await connectActiveTransport();
    return;
  }
  await authenticateAndSyncTransport();
}

// ─────────────────────── Автообновление (GitHub Releases + узел) ───────────────────────

export async function checkForUpdates({ silent = false } = {}) {
  if (store.update.checking) return;
  store.update.checking = true;
  if (!silent) notifyStore();

  try {
    let foundUpdate = false;
    const strictAnon =
      store.settings.transportPolicy === TRANSPORT_POLICY.TOR_ONLY ||
      store.settings.transportPolicy === TRANSPORT_POLICY.I2P_ONLY;

    // 1. Приоритетно опрашиваем GitHub Releases (основной канал автообновления APK)
    if (!strictAnon && typeof fetch === 'function') {
      try {
        const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          headers: { accept: 'application/vnd.github+json' },
          cache: 'no-store',
        });
        if (ghRes.ok) {
          const rel = await ghRes.json();
          const tagVer = String(rel.tag_name || '').replace(/^v/i, '');
          const apkAsset = (rel.assets || []).find((a) => String(a.name || '').endsWith('.apk'));
          const shaMatch = String(rel.body || '').match(/SHA-?256:\s*`?([a-f0-9]{64})`?/i);

          if (tagVer && compareSemver(tagVer, APP_VERSION) > 0) {
            store.update.available = true;
            store.update.dismissed = false;
            store.update.remoteVersion = tagVer;
            store.update.releaseNotes = String(rel.name || rel.tag_name || '').slice(0, 140);
            if (apkAsset?.browser_download_url) {
              store.update.apkUrl = apkAsset.browser_download_url;
              store.update.apkSha256 = shaMatch ? shaMatch[1].toLowerCase() : null;
            }
            foundUpdate = true;
          }
        }
      } catch { /* GitHub API может быть недоступен в закрытой сети */ }
    }

    // 2. Резервная проверка через /api/version текущего узла (работает также внутри LAN и Tor)
    if (!foundUpdate) {
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
    }

    store.update.lastCheckedAt = Date.now();
    if (!silent) {
      showToast(
        foundUpdate
          ? `Найдена новая версия MeshChat v${store.update.remoteVersion}`
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
    store.update.statusText = 'Загрузка подписанного пакета из GitHub Releases…';
    notifyStore();
    globalThis.MeshChatAndroid.downloadAndInstallUpdate(url, store.update.apkSha256 || '');
    return;
  }

  try {
    store.update.downloading = true;
    store.update.statusText = 'Обновление веб-оболочки…';
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

// ─────────── Прозрачное самовосстановление сессии без повторной регистрации ───────────

/**
 * Автоматически восстанавливает авторизацию на узле при истечении токена или перезапуске контейнера Render:
 * Шаг 1: Беспарольный ZK-вход неизвлекаемым ключом ECDSA P-256 (`me:zkAuthPriv`).
 * Шаг 2: Если эфемерный ретранслятор был перезапущен с чистым диском — прозрачная регидратация
 *        ТОГО ЖЕ САМОГО `userId`, `@username` и публичных ключей Signal без участия пользователя.
 */
export async function recoverRelaySessionTransparently() {
  if (!store.me?.username || store.rehydratingSession) return false;
  store.rehydratingSession = true;
  notifyStore();

  try {
    const cleanUser = store.me.username;

    // Попытка 1: быстрый беспарольный ZK-вход по сохранённому неизвлекаемому ключу
    try {
      const ch = await postJson('/api/auth/challenge', { username: cleanUser });
      const sig = await cryptoWorker.call('signStoredZkChallenge', {
        username: cleanUser,
        challengeNonce: ch.challengeNonce,
      });
      const res = await postJson('/api/auth/login', {
        username: cleanUser,
        challengeNonce: ch.challengeNonce,
        signatureB64: sig,
      });
      store.me = {
        ...store.me,
        userId: res.userId,
        username: res.username,
        token: res.token,
        mailboxId: res.mailboxId,
        mailboxWriteToken: res.mailboxWriteToken,
      };
      await clientDb.set('me', store.me);
      return true;
    } catch {
      // Если аккаунт отсутствует на перезапущенном эфемерном ретрансляторе — переходим к регидратации
    }

    // Попытка 2: автоматическая регидратация идентичных ключей личности на свежем ретрансляторе
    const pkg = await cryptoWorker.call('exportRelayRehydrationPackage', { opkCount: 35 });
    const pow = await postJson('/api/auth/pow', { purpose: 'register' });
    const powNonce = await cryptoWorker.call('solvePow', pow);
    const reg = await postJson('/api/auth/register', {
      username: pkg.username,
      powChallenge: pow.challengeToken,
      powNonce,
      authPubB64: pkg.authPubB64,
      encryptedAuthKey: pkg.encryptedAuthKey,
      publicBundle: pkg.publicBundle,
      encryptedRecovery: pkg.encryptedRecovery || null,
    });

    store.me = {
      ...store.me,
      userId: reg.userId,
      username: reg.username,
      token: reg.token,
      mailboxId: reg.mailboxId,
      mailboxWriteToken: reg.mailboxWriteToken,
    };
    await clientDb.set('me', store.me);
    return true;
  } catch (err) {
    console.warn('[zk-self-heal] не удалось автоматически перевыпустить токен:', err.message);
    return false;
  } finally {
    store.rehydratingSession = false;
    notifyStore();
  }
}

async function authenticateAndSyncTransport(pendingBundleUpload = null) {
  if (!rpcChannel || !activeTransport?.isConnected || !store.me?.username) return;
  if (authSyncPromise) return authSyncPromise;

  authSyncPromise = (async () => {
    try {
      let sessionInfo = null;
      try {
        if (!store.me.token) throw new Error('401');
        sessionInfo = (await rpcChannel.request('session.auth', { token: store.me.token })).data;
      } catch (err) {
        const msg = String(err?.message || '');
        if (msg.includes('Сессия недействительна') || msg.includes('401')) {
          const healed = await recoverRelaySessionTransparently();
          if (healed && store.me?.token && rpcChannel && activeTransport?.isConnected) {
            sessionInfo = (await rpcChannel.request('session.auth', { token: store.me.token })).data;
          } else {
            // Никогда не стираем локальный аккаунт и историю чатов при временном сбое узла!
            store.sessionAuthenticated = false;
            notifyStore();
            return;
          }
        } else {
          throw err;
        }
      }

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
      console.warn('[auth-sync]', err?.message || err);
      notifyStore();
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
    if (detail?.rttMs || transport.rttMs) recordRttSample(detail?.rttMs || transport.rttMs);

    if (state === TRANSPORT_STATE.CONNECTED && store.me?.username) {
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
    if (transport.rttMs) recordRttSample(transport.rttMs);
    if (store.me?.username) {
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
  const started = performance.now();
  const { data } = await rpcChannel.request('mailbox.pull', { limit: 100 });
  recordRttSample(performance.now() - started);

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

function buildCompactProfileCard() {
  const p = store.profile;
  return {
    displayName: (p.displayName || store.me?.username || '').slice(0, 40),
    statusText: (p.statusText || '').slice(0, 60),
    bio: (p.bio || '').slice(0, 180),
    badge: p.badge || 'none',
    avatarDataUrl: (p.avatarDataUrl || '').slice(0, 32000),
    bannerPreset: p.bannerPreset || 'amoled',
    bannerCustomColor: p.bannerCustomColor || '#1b2242',
    particles: p.particles || 'stars',
    updatedAt: p.updatedAt || Date.now(),
  };
}

function applyPeerProfileToChat(chat, peerProfile) {
  if (!chat || !peerProfile || typeof peerProfile !== 'object') return;
  const prevTs = chat.peerProfile?.updatedAt || 0;
  if (peerProfile.updatedAt && peerProfile.updatedAt < prevTs) return;
  chat.peerProfile = {
    ...(chat.peerProfile || {}),
    ...peerProfile,
  };
  if (peerProfile.displayName) {
    chat.title = peerProfile.displayName;
  }
}

async function processIncomingEnvelope(envId, sealedBytes, { skipImmediateAck = false } = {}) {
  const dec = await cryptoWorker.call(
    'decryptIncomingSealedEnvelope',
    { sealedBytes: new Uint8Array(sealedBytes) },
    []
  );
  rememberProcessedEnvelope(envId);
  store.meshStats.packetsReceived += 1;

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
      pinned: false,
      muted: false,
      ttlSec: payload.ttlSec || 0,
      unread: 0,
      lastPreview: '',
      lastTs: Date.now(),
      peerProfile: null,
    };
  } else if (payload.replyMailbox?.mailboxId) {
    store.chats[chatId].mailboxId = payload.replyMailbox.mailboxId;
    store.chats[chatId].mailboxWriteToken = payload.replyMailbox.mailboxWriteToken;
  }

  if (payload.senderProfile) {
    applyPeerProfileToChat(store.chats[chatId], payload.senderProfile);
  }

  if (payload.type === 'profile-sync') {
    if (payload.profile) applyPeerProfileToChat(store.chats[chatId], payload.profile);
    await persistChatsAndMessages();
    notifyStore();
    return;
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
    store.meshStats.packetsReceived += 1;
    if (!skipImmediateAck && rpcChannel) {
      rpcChannel.request('mailbox.ack', { ids: [], askIds: [askItem.id] }).catch(() => {});
    }
    const chatId = 'ask:inbox';
    store.chats = ensureSystemChats(store.chats, store.me?.username || '');
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

    const zkBackup = {
      username: cleanUser,
      authPubB64: zkAuth.authPubB64,
      encryptedAuthKey: zkAuth.encryptedAuthKey,
      encryptedRecovery: provisioned.recoveryKit?.encryptedBackup || null,
    };
    await cryptoWorker.call('saveZkMetadata', zkBackup);

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
      publicKeyShort: provisioned.publicBundle.identity.ikSignPub.slice(0, 22),
      // Храним зашифрованный резервный комплект в локальной шифрованной БД (+ AndroidKeyStore)
      deviceVaultBackup: provisioned.recoveryKit || null,
      zkBackup,
    };
    store.recoveryModalKey = provisioned.recoveryKit?.recoveryKey || null;

    store.profile.displayName = reg.username;
    store.chats = ensureSystemChats({}, reg.username);
    store.messages = ensureSystemMessages({}, reg.username);
    store.ui.activeChatId = 'echo:loopback';

    await Promise.all([
      clientDb.set('me', store.me),
      clientDb.set('profile', store.profile),
      persistChatsAndMessages(),
    ]);
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

    const zkBackup = {
      username: cleanUser,
      authPubB64: res.authPubB64 || null,
      encryptedAuthKey: ch.encryptedAuthKey,
      encryptedRecovery: res.encryptedRecovery || null,
    };
    await cryptoWorker.call('saveZkMetadata', zkBackup);

    let recoveredBundle = null;
    let deviceVaultBackup = null;
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
      deviceVaultBackup = {
        encryptedBackup: res.encryptedRecovery,
        recoveryKey: recoveryKey.trim(),
      };
    }

    const latestInit = await cryptoWorker.call('init');
    store.me = {
      userId: res.userId,
      username: res.username,
      token: res.token,
      mailboxId: res.mailboxId,
      mailboxWriteToken: res.mailboxWriteToken,
      publicKeyShort: latestInit.publicIdentity?.ikSignPub?.slice(0, 22) || '',
      deviceVaultBackup,
      zkBackup,
    };
    if (!store.profile.displayName) store.profile.displayName = res.username;
    store.chats = ensureSystemChats((await clientDb.get('chats', {})) || {}, res.username);
    store.messages = ensureSystemMessages((await clientDb.get('messages', {})) || {}, res.username);
    store.outbox = (await clientDb.get('outbox', [])) || [];

    await Promise.all([
      clientDb.set('me', store.me),
      clientDb.set('profile', store.profile),
      persistChatsAndMessages(),
    ]);
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

// ─────────────── Кастомный Профиль, Кастомная Тема и Телеметрия Mesh ───────────────

export async function updateMyProfile(patch) {
  Object.assign(store.profile, patch, { updatedAt: Date.now() });
  await clientDb.set('profile', store.profile);
  notifyStore();

  // Синхронизируем обновлённый профиль со всеми активными контактами через E2EE Double Ratchet
  const card = buildCompactProfileCard();
  const dmChats = Object.values(store.chats).filter((c) => c.kind === 'dm' && c.peerId);
  for (const chat of dmChats) {
    deliverPayloadToPeer(chat, { type: 'profile-sync', profile: card }).catch(() => {});
  }
}

export async function updateThemeSettings(patch) {
  Object.assign(store.theme, patch);
  applyThemeToDom();
  await clientDb.set('theme', store.theme);
  notifyStore();
}

export function setNavTab(tab) {
  store.ui.navTab = tab;
  if (tab !== 'chats') {
    // На мобильном переключение нижней вкладки закрывает активный диалог
    if (typeof innerWidth !== 'undefined' && innerWidth <= 860) {
      store.ui.activeChatId = null;
    }
  }
  notifyStore();
}

export async function togglePinChat(chatId) {
  const chat = store.chats[chatId];
  if (!chat) return;
  chat.pinned = !chat.pinned;
  await persistChatsAndMessages();
  notifyStore();
  showToast(chat.pinned ? 'Чат закреплён' : 'Чат откреплён');
}

/** Реальный E2EE-тест криптоядра и активного транспорта из вкладки Mesh */
export async function sendMeshTestPacket() {
  try {
    const cryptoRes = await cryptoWorker.call('loopbackSelfTest', {
      text: `MESH-PROBE:${Date.now()}:${toBase64Url(randomBytes(6))}`,
    });
    store.meshStats.packetsSent += 1;
    store.meshStats.packetsReceived += 1;

    let netRtt = cryptoRes.elapsedMs;
    if (rpcChannel && activeTransport?.isConnected && store.sessionAuthenticated) {
      const t0 = performance.now();
      await rpcChannel.request('mailbox.pull', { limit: 1 });
      netRtt = Math.round(performance.now() - t0);
    }
    recordRttSample(netRtt);
    store.meshStats.lastProbeText = `AES-256-GCM (${cryptoRes.paddedBytes} Б, SHA-256 ${cryptoRes.sha256Prefix}…) · крипто ${cryptoRes.elapsedMs} мс · сеть ${netRtt} мс`;
    showToast(`Тест-пакет E2EE успешен: ${netRtt} мс`);
    notifyStore();
    return cryptoRes;
  } catch (err) {
    showToast(`Ошибка тест-пакета: ${err.message}`, 'err');
    return null;
  }
}

/** Комплексная диагностика узла, ключей WebCrypto, транспорта и GitHub Releases */
export async function runMeshDiagnostics() {
  const workerInit = await cryptoWorker.call('init').catch(() => ({ hasIdentity: false }));
  const cryptoProbe = await cryptoWorker.call('loopbackSelfTest', { text: 'DIAG-E2EE-CHECK' }).catch(() => null);
  let health = null;
  try {
    const r = await fetch(resolveApiUrl('/api/health'), { cache: 'no-store' });
    if (r.ok) health = await r.json();
  } catch { /* offline */ }

  const report = {
    ts: Date.now(),
    identityReady: Boolean(workerInit.hasIdentity),
    nonExtractableKeys: true,
    loopbackOk: Boolean(cryptoProbe?.ok),
    cryptoMs: cryptoProbe?.elapsedMs || 0,
    transportState: store.transportState,
    activeTransport: store.activeTransportId,
    sessionAuth: store.sessionAuthenticated,
    medianRttMs: store.meshStats.medianRttMs || store.rttMs || null,
    outboxQueued: store.outbox.length,
    lanMesh: store.android.lanMeshRunning ? store.android.lanUrl : 'выключен',
    relayVersion: health?.version || APP_VERSION,
    appVersion: `${APP_VERSION} (build ${APP_VERSION_CODE})`,
  };
  store.meshStats.diagnostics = report;
  notifyStore();
  showToast('Диагностика Mesh и криптоядра завершена');
  return report;
}

// ─────────────────────── Чаты, Гарантированная Доставка и Файлы E2E ───────────────────────

export async function startChatWithUsername(query) {
  const clean = String(query || '').trim().replace(/^@/, '').toLowerCase();
  if (!clean) return;
  if (clean === store.me?.username) {
    selectChat('echo:loopback');
    showToast('Открыт ваш личный зашифрованный канал Эхо-проверки E2EE');
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
    title: existing?.peerProfile?.displayName || `@${bundle.username}`,
    mailboxId: bundle.mailboxId,
    mailboxWriteToken: bundle.mailboxWriteToken,
    avatarColor: existing?.avatarColor || pickColor(bundle.userId),
    verified: Boolean(existing?.verified),
    pinned: Boolean(existing?.pinned),
    muted: Boolean(existing?.muted),
    ttlSec: existing?.ttlSec || 0,
    unread: existing?.unread || 0,
    lastPreview: existing?.lastPreview || 'Канал E2E готов · Double Ratchet',
    lastTs: Date.now(),
    cachedBundle: bundle,
    peerProfile: existing?.peerProfile || null,
  };
  if (!store.messages[chatId]) store.messages[chatId] = [];
  store.ui.navTab = 'chats';
  selectChat(chatId);
  await persistChatsAndMessages();
  showToast(`Контакт @${bundle.username} проверен и добавлен`);
}

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
  if (chatId) store.ui.navTab = 'chats';
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
    status: chat.kind === 'echo' ? 'sent' : 'sending',
  };

  store.ui.replyTo = null;
  const list = store.messages[chatId] || (store.messages[chatId] = []);
  list.push(localMsg);
  chat.lastTs = now;
  chat.lastPreview = localMsg.media
    ? (localMsg.media.once ? '[1×] Вложение' : `[Файл] ${localMsg.media.name}`)
    : trimmed.slice(0, 90);
  notifyStore();

  // Специальная обработка локального канала Эхо-проверки E2EE
  if (chat.kind === 'echo') {
    const res = await cryptoWorker.call('loopbackSelfTest', { text: trimmed || '[Файл E2EE]' });
    store.meshStats.packetsSent += 1;
    store.meshStats.packetsReceived += 1;
    recordRttSample(res.elapsedMs);
    const echoReply = {
      id: `echo_${toBase64Url(randomBytes(7))}`,
      chatId,
      out: false,
      type: 'text',
      text: `Эхо подтверждено · AES-256-GCM (${res.paddedBytes} Б, SHA-256 ${res.sha256Prefix}…) за ${res.elapsedMs} мс:\n«${res.decryptedText}»`,
      ts: Date.now(),
      ttlSec,
      expiresAt: ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0,
      reactions: {},
      status: 'delivered',
    };
    list.push(echoReply);
    chat.lastPreview = `Эхо OK (${res.elapsedMs} мс): ${trimmed.slice(0, 60)}`;
    chat.lastTs = echoReply.ts;
    if (store.settings.sound) playSfx('sent');
    await persistChatsAndMessages();
    notifyStore();
    return;
  }

  const wirePayload = {
    msgId,
    type: localMsg.type,
    text: trimmed,
    replyTo: replyObj,
    media: extra.media || null,
    ttlSec,
    senderProfile: buildCompactProfileCard(),
    replyMailbox: {
      mailboxId: store.me.mailboxId,
      mailboxWriteToken: store.me.mailboxWriteToken,
    },
  };

  await deliverPayloadToPeer(chat, wirePayload, localMsg);
  await persistChatsAndMessages();
}

async function sendSealedEnvelopeWithRefresh(chat, sealedBytes, ttlSec) {
  if (!rpcChannel || !activeTransport?.isConnected) {
    throw new Error('offline');
  }
  if (!store.sessionAuthenticated && store.me?.username) {
    await authenticateAndSyncTransport();
  }

  const effectiveTtl = ttlSec > 0 ? Math.max(300, ttlSec * 2) : 14 * 86400;

  const attemptDrop = async () => {
    const t0 = performance.now();
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
    recordRttSample(performance.now() - t0);
    store.meshStats.packetsSent += 1;
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

    if (mailboxStale && (chat.username || chat.peerId)) {
      const { data: fresh } = await rpcChannel.request('directory.bundle', {
        query: chat.username || chat.peerId,
      });
      // Проверяем криптографическую неизменность ключа собеседника при обновлении его mailboxId
      await cryptoWorker.call('savePeerIdentity', { peerIdentity: fresh.identity });
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

    if (chat.kind === 'echo') {
      const blobId = `local_${toBase64Url(randomBytes(8))}`;
      const plainCopy = await cryptoWorker.call('decryptFile', { bytes: encryptedBytes, descriptor });
      store.decryptedMediaUrls[blobId] = URL.createObjectURL(
        new Blob([plainCopy], { type: descriptor.mime || 'application/octet-stream' })
      );
      await sendChatMessage(chatId, caption || `Файл проверен: ${descriptor.name}`, {
        type: 'media',
        media: {
          blobId,
          once: false,
          name: descriptor.name,
          mime: descriptor.mime,
          size: descriptor.size,
          descriptor,
        },
      });
      return;
    }

    if (!store.sessionAuthenticated) await authenticateAndSyncTransport();

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
  if (!chat || (chat.kind !== 'dm' && chat.kind !== 'echo')) return;
  applyReactionLocal(chatId, msgId, store.me.userId, emoji);
  await persistChatsAndMessages();
  notifyStore();
  if (chat.kind === 'dm') {
    await deliverPayloadToPeer(chat, { type: 'reaction', targetMsgId: msgId, emoji });
  }
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

export async function openPeerProfileModal(chatId) {
  const chat = store.chats[chatId];
  if (!chat || chat.kind !== 'dm') return;
  let sn = null;
  try {
    sn = await cryptoWorker.call('getSafetyNumber', { peerId: chat.peerId });
  } catch { /* safety number optional */ }
  store.ui.modal = 'peer-profile';
  store.ui.modalData = { chatId, chat, safetyNumber: sn };
  notifyStore();
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
