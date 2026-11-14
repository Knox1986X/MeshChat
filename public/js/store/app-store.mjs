// Центральное реактивное состояние MeshChat v1.3 (Offline-First + Self-Healing ZK Session).
// Связывает изолированный CryptoWorker, мультитранспортный канал, зашифрованную IndexedDB
// (+ AndroidKeyStore Vault), кастомные E2E-профили, движок тем и автообновление GitHub Releases.

import { useReducer, useEffect } from '../../vendor/preact.mjs';
import {
  utf8ToBytes,
  bytesToUtf8,
  randomBytes,
  toBase64Url,
  fromBase64Url,
  hmacSha256,
  sha256,
  aesGcmEncrypt,
  aesGcmDecrypt,
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
import { E2eeCallManager } from '../transport/call-manager.mjs';
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

export const APP_VERSION = '1.8.0';
export const APP_VERSION_CODE = 9;
export const GITHUB_REPO = 'Knox1986X/MeshChat';
export const DEFAULT_CLOUD_URL = 'https://meshchat-6a11.onrender.com';

// 18 предустановленных тем оформления: 8 новогодних и мультиградиентных + 10 классических
export const THEME_PRESETS = {
  ny_polar_aurora: {
    id: 'ny_polar_aurora',
    category: 'festive',
    label: 'Полярное сияние',
    bg0: '#060b16',
    bg1: '#0b1325',
    bg2: '#111d36',
    bg3: '#192a4c',
    accent: '#38bdf8',
    accent2: '#818cf8',
    bubbleOut: '#16355c',
    appGradient: 'radial-gradient(circle at 16% 12%, rgba(16, 185, 129, 0.16) 0%, transparent 44%), radial-gradient(circle at 84% 16%, rgba(129, 140, 248, 0.2) 0%, transparent 48%), radial-gradient(circle at 50% 92%, rgba(56, 189, 248, 0.12) 0%, transparent 55%), linear-gradient(180deg, #060b16 0%, #091224 100%)',
    accentGradient: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 52%, #a855f7 100%)',
    bubbleGradient: 'linear-gradient(135deg, #0f4c5c 0%, #1e3a8a 52%, #4c1d95 100%)',
  },
  ny_pine_gold: {
    id: 'ny_pine_gold',
    category: 'festive',
    label: 'Хвоя и Золото',
    bg0: '#050f0b',
    bg1: '#0a1913',
    bg2: '#10261d',
    bg3: '#173629',
    accent: '#f59e0b',
    accent2: '#10b981',
    bubbleOut: '#133b2b',
    appGradient: 'radial-gradient(circle at 18% 10%, rgba(16, 185, 129, 0.2) 0%, transparent 46%), radial-gradient(circle at 85% 18%, rgba(245, 158, 11, 0.17) 0%, transparent 45%), linear-gradient(180deg, #050f0b 0%, #091a13 100%)',
    accentGradient: 'linear-gradient(135deg, #10b981 0%, #d97706 52%, #fbbf24 100%)',
    bubbleGradient: 'linear-gradient(135deg, #064e3b 0%, #0f5132 58%, #78350f 100%)',
  },
  ny_velvet_ruby: {
    id: 'ny_velvet_ruby',
    category: 'festive',
    label: 'Праздничный Рубин',
    bg0: '#12060b',
    bg1: '#1c0b13',
    bg2: '#29101c',
    bg3: '#381728',
    accent: '#fb7185',
    accent2: '#fbbf24',
    bubbleOut: '#4c162a',
    appGradient: 'radial-gradient(circle at 20% 14%, rgba(225, 29, 72, 0.22) 0%, transparent 46%), radial-gradient(circle at 84% 12%, rgba(245, 158, 11, 0.16) 0%, transparent 44%), linear-gradient(180deg, #12060b 0%, #1a0811 100%)',
    accentGradient: 'linear-gradient(135deg, #e11d48 0%, #f43f5e 52%, #f59e0b 100%)',
    bubbleGradient: 'linear-gradient(135deg, #7f1d1d 0%, #9f1239 54%, #92400e 100%)',
  },
  ny_ice_palace: {
    id: 'ny_ice_palace',
    category: 'festive',
    label: 'Ледяной Кристалл',
    bg0: '#050c18',
    bg1: '#0a1528',
    bg2: '#10213c',
    bg3: '#183054',
    accent: '#38bdf8',
    accent2: '#c084fc',
    bubbleOut: '#163863',
    appGradient: 'radial-gradient(circle at 22% 10%, rgba(56, 189, 248, 0.22) 0%, transparent 48%), radial-gradient(circle at 82% 24%, rgba(192, 132, 252, 0.16) 0%, transparent 46%), linear-gradient(180deg, #050c18 0%, #09172e 100%)',
    accentGradient: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 50%, #818cf8 100%)',
    bubbleGradient: 'linear-gradient(135deg, #0c4a6e 0%, #1d4ed8 55%, #4338ca 100%)',
  },
  ny_fireplace: {
    id: 'ny_fireplace',
    category: 'festive',
    label: 'Тёплый Камин',
    bg0: '#120a06',
    bg1: '#1c100a',
    bg2: '#281810',
    bg3: '#382217',
    accent: '#fb923c',
    accent2: '#facc15',
    bubbleOut: '#4a2512',
    appGradient: 'radial-gradient(circle at 20% 15%, rgba(234, 88, 12, 0.22) 0%, transparent 46%), radial-gradient(circle at 80% 82%, rgba(245, 158, 11, 0.16) 0%, transparent 50%), linear-gradient(180deg, #120a06 0%, #1b0e08 100%)',
    accentGradient: 'linear-gradient(135deg, #ea580c 0%, #f59e0b 55%, #fde047 100%)',
    bubbleGradient: 'linear-gradient(135deg, #7c2d12 0%, #9a3412 54%, #854d0e 100%)',
  },
  ny_champagne: {
    id: 'ny_champagne',
    category: 'festive',
    label: 'Зимнее Шампанское',
    bg0: '#09090f',
    bg1: '#11111c',
    bg2: '#1a1a2b',
    bg3: '#25253c',
    accent: '#fbbf24',
    accent2: '#f472b6',
    bubbleOut: '#362946',
    appGradient: 'radial-gradient(circle at 20% 12%, rgba(251, 191, 36, 0.17) 0%, transparent 45%), radial-gradient(circle at 82% 20%, rgba(244, 114, 182, 0.15) 0%, transparent 45%), linear-gradient(180deg, #09090f 0%, #10101c 100%)',
    accentGradient: 'linear-gradient(135deg, #d97706 0%, #fbbf24 48%, #f472b6 100%)',
    bubbleGradient: 'linear-gradient(135deg, #4a2c18 0%, #581c4f 56%, #3b1d5e 100%)',
  },
  grad_sunset_cyber: {
    id: 'grad_sunset_cyber',
    category: 'gradient',
    label: 'Закатный Градиент',
    bg0: '#0b0714',
    bg1: '#140d24',
    bg2: '#1e1436',
    bg3: '#2b1d4c',
    accent: '#ec4899',
    accent2: '#6366f1',
    bubbleOut: '#3b1c59',
    appGradient: 'radial-gradient(circle at 15% 15%, rgba(236, 72, 153, 0.2) 0%, transparent 46%), radial-gradient(circle at 85% 20%, rgba(99, 102, 241, 0.22) 0%, transparent 48%), linear-gradient(180deg, #0b0714 0%, #120b22 100%)',
    accentGradient: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 52%, #3b82f6 100%)',
    bubbleGradient: 'linear-gradient(135deg, #831843 0%, #5b21b6 54%, #1e3a8a 100%)',
  },
  grad_ocean_mint: {
    id: 'grad_ocean_mint',
    category: 'gradient',
    label: 'Изумрудный Океан',
    bg0: '#040d10',
    bg1: '#08181e',
    bg2: '#0e252e',
    bg3: '#153542',
    accent: '#14b8a6',
    accent2: '#3b82f6',
    bubbleOut: '#0f3c4c',
    appGradient: 'radial-gradient(circle at 18% 14%, rgba(20, 184, 166, 0.2) 0%, transparent 46%), radial-gradient(circle at 84% 22%, rgba(59, 130, 246, 0.18) 0%, transparent 48%), linear-gradient(180deg, #040d10 0%, #07161d 100%)',
    accentGradient: 'linear-gradient(135deg, #10b981 0%, #06b6d4 52%, #3b82f6 100%)',
    bubbleGradient: 'linear-gradient(135deg, #065f46 0%, #0e7490 54%, #1e40af 100%)',
  },
  obsidian: {
    id: 'obsidian',
    label: 'Obsidian Indigo',
    bg0: '#0b0d14',
    bg1: '#111420',
    bg2: '#171b2a',
    bg3: '#1f2538',
    accent: '#6d7cff',
    bubbleOut: '#263159',
    appGradient: 'radial-gradient(circle at 20% 10%, rgba(109, 124, 255, 0.14) 0%, transparent 45%), linear-gradient(180deg, #0b0d14 0%, #0e111b 100%)',
    accentGradient: 'linear-gradient(135deg, #4f46e5 0%, #6d7cff 55%, #818cf8 100%)',
    bubbleGradient: 'linear-gradient(135deg, #232d54 0%, #312e81 100%)',
  },
  amoled: {
    id: 'amoled',
    label: 'AMOLED Pitch',
    bg0: '#000000',
    bg1: '#07090e',
    bg2: '#10131d',
    bg3: '#181d2b',
    accent: '#7b89ff',
    bubbleOut: '#1c2447',
    appGradient: 'linear-gradient(180deg, #000000 0%, #04050a 100%)',
    accentGradient: 'linear-gradient(135deg, #4f46e5 0%, #7b89ff 100%)',
    bubbleGradient: 'linear-gradient(135deg, #172042 0%, #282566 100%)',
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
    appGradient: 'radial-gradient(circle at 20% 12%, rgba(16, 185, 129, 0.15) 0%, transparent 45%), linear-gradient(180deg, #060c0a 0%, #08120f 100%)',
    accentGradient: 'linear-gradient(135deg, #059669 0%, #10b981 55%, #2dd4bf 100%)',
    bubbleGradient: 'linear-gradient(135deg, #064e3b 0%, #115e59 100%)',
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
    appGradient: 'radial-gradient(circle at 22% 10%, rgba(6, 182, 212, 0.16) 0%, transparent 46%), linear-gradient(180deg, #060b11 0%, #09121c 100%)',
    accentGradient: 'linear-gradient(135deg, #0284c7 0%, #06b6d4 55%, #38bdf8 100%)',
    bubbleGradient: 'linear-gradient(135deg, #0e475e 0%, #155e75 100%)',
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
    appGradient: 'radial-gradient(circle at 80% 14%, rgba(168, 85, 247, 0.18) 0%, transparent 48%), linear-gradient(180deg, #0a0712 0%, #100b1d 100%)',
    accentGradient: 'linear-gradient(135deg, #7e22ce 0%, #a855f7 55%, #ec4899 100%)',
    bubbleGradient: 'linear-gradient(135deg, #3b1764 0%, #581c87 100%)',
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
    appGradient: 'radial-gradient(circle at 20% 12%, rgba(244, 63, 94, 0.17) 0%, transparent 46%), linear-gradient(180deg, #0f070a 0%, #160a0f 100%)',
    accentGradient: 'linear-gradient(135deg, #be123c 0%, #f43f5e 55%, #fb7185 100%)',
    bubbleGradient: 'linear-gradient(135deg, #4c1424 0%, #881337 100%)',
  },
  amber: {
    id: 'amber',
    label: 'Tactical Amber',
    bg0: '#0d0a05',
    bg1: '#161108',
    bg2: '#21190c',
    bg3: '#2e2311',
    accent: '#f59e0b',
    bubbleOut: '#3b2b10',
    appGradient: 'radial-gradient(circle at 20% 12%, rgba(245, 158, 11, 0.15) 0%, transparent 46%), linear-gradient(180deg, #0d0a05 0%, #140f07 100%)',
    accentGradient: 'linear-gradient(135deg, #d97706 0%, #f59e0b 55%, #fbbf24 100%)',
    bubbleGradient: 'linear-gradient(135deg, #45270d 0%, #78350f 100%)',
  },
  cobalt: {
    id: 'cobalt',
    label: 'Nordic Cobalt',
    bg0: '#060a13',
    bg1: '#0c1322',
    bg2: '#131e33',
    bg3: '#1b2b48',
    accent: '#3b82f6',
    bubbleOut: '#19325c',
    appGradient: 'radial-gradient(circle at 20% 14%, rgba(59, 130, 246, 0.16) 0%, transparent 46%), linear-gradient(180deg, #060a13 0%, #0a1120 100%)',
    accentGradient: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 55%, #60a5fa 100%)',
    bubbleGradient: 'linear-gradient(135deg, #172e57 0%, #1e40af 100%)',
  },
  graphite: {
    id: 'graphite',
    label: 'Stealth Graphite',
    bg0: '#0a0b0e',
    bg1: '#121419',
    bg2: '#1a1d24',
    bg3: '#242832',
    accent: '#94a3b8',
    bubbleOut: '#262b38',
    appGradient: 'linear-gradient(180deg, #0a0b0e 0%, #101218 100%)',
    accentGradient: 'linear-gradient(135deg, #64748b 0%, #94a3b8 100%)',
    bubbleGradient: 'linear-gradient(135deg, #242936 0%, #334155 100%)',
  },
  rose: {
    id: 'rose',
    label: 'Neon Rose',
    bg0: '#0e070d',
    bg1: '#170c15',
    bg2: '#231220',
    bg3: '#31192d',
    accent: '#ec4899',
    bubbleOut: '#401836',
    appGradient: 'radial-gradient(circle at 80% 14%, rgba(236, 72, 153, 0.18) 0%, transparent 46%), linear-gradient(180deg, #0e070d 0%, #160a14 100%)',
    accentGradient: 'linear-gradient(135deg, #db2777 0%, #ec4899 55%, #f472b6 100%)',
    bubbleGradient: 'linear-gradient(135deg, #501641 0%, #831843 100%)',
  },
};

// Градиенты исходящих пузырей сообщений
export const BUBBLE_GRADIENTS = {
  theme: { id: 'theme', label: 'В тон темы', css: '' },
  aurora: {
    id: 'aurora',
    label: 'Полярное сияние',
    css: 'linear-gradient(135deg, #0f5156 0%, #1e3a8a 52%, #581c87 100%)',
  },
  festive_ruby: {
    id: 'festive_ruby',
    label: 'Новогодний рубин',
    css: 'linear-gradient(135deg, #7f1d1d 0%, #9f1239 54%, #92400e 100%)',
  },
  pine_gold: {
    id: 'pine_gold',
    label: 'Хвоя и золото',
    css: 'linear-gradient(135deg, #064e3b 0%, #0f5132 58%, #78350f 100%)',
  },
  glacier: {
    id: 'glacier',
    label: 'Ледяной кристалл',
    css: 'linear-gradient(135deg, #0c4a6e 0%, #1d4ed8 54%, #4338ca 100%)',
  },
  sunset_berry: {
    id: 'sunset_berry',
    label: 'Ягодный закат',
    css: 'linear-gradient(135deg, #831843 0%, #6d28d9 54%, #1e3a8a 100%)',
  },
  warm_amber: {
    id: 'warm_amber',
    label: 'Тёплый глинтвейн',
    css: 'linear-gradient(135deg, #7c2d12 0%, #9a3412 55%, #854d0e 100%)',
  },
  solid: {
    id: 'solid',
    label: 'Спокойный тон',
    css: 'solid',
  },
};

// Готовые новогодние и градиентные сцены в 1 нажатие
export const HOLIDAY_MOOD_PACKS = [
  {
    id: 'polar_fairytale',
    title: 'Полярная сказка',
    sub: 'Северное сияние, кристальные снежинки и гирлянда',
    patch: {
      preset: 'ny_polar_aurora',
      bubbleGradient: 'aurora',
      ambientEffect: 'aurora_snow',
      snowDensity: 'medium',
      garlandEnabled: true,
      garlandStyle: 'arctic_ice',
      frostGlass: true,
      snowCaps: true,
      chatBackdrop: 'snowflakes',
      animations: true,
    },
  },
  {
    id: 'pine_and_gold',
    title: 'Хвоя и Золото',
    sub: 'Изумрудная ель, золотые огни и мягкий снег',
    patch: {
      preset: 'ny_pine_gold',
      bubbleGradient: 'pine_gold',
      ambientEffect: 'snowfall',
      snowDensity: 'medium',
      garlandEnabled: true,
      garlandStyle: 'warm_gold',
      frostGlass: true,
      snowCaps: true,
      chatBackdrop: 'festive_gold',
      animations: true,
    },
  },
  {
    id: 'velvet_celebration',
    title: 'Праздничный Рубин',
    sub: 'Тёплый бархат, классическая гирлянда и снегопад',
    patch: {
      preset: 'ny_velvet_ruby',
      bubbleGradient: 'festive_ruby',
      ambientEffect: 'snowfall',
      snowDensity: 'rich',
      garlandEnabled: true,
      garlandStyle: 'classic',
      frostGlass: true,
      snowCaps: true,
      chatBackdrop: 'snowflakes',
      animations: true,
    },
  },
  {
    id: 'ice_blizzard',
    title: 'Ледяной Кристалл',
    sub: 'Сапфировый иней, метель и морозное стекло',
    patch: {
      preset: 'ny_ice_palace',
      bubbleGradient: 'glacier',
      ambientEffect: 'blizzard',
      snowDensity: 'rich',
      garlandEnabled: true,
      garlandStyle: 'arctic_ice',
      frostGlass: true,
      snowCaps: true,
      chatBackdrop: 'frost_prism',
      animations: true,
    },
  },
  {
    id: 'champagne_sparks',
    title: 'Искры Шампанского',
    sub: 'Золотые искры, тёплый камин и янтарный градиент',
    patch: {
      preset: 'ny_champagne',
      bubbleGradient: 'warm_amber',
      ambientEffect: 'champagne_sparks',
      snowDensity: 'medium',
      garlandEnabled: true,
      garlandStyle: 'warm_gold',
      frostGlass: true,
      snowCaps: false,
      chatBackdrop: 'festive_gold',
      animations: true,
    },
  },
  {
    id: 'strict_classic',
    title: 'Строгая классика',
    sub: 'Без снежинок и гирлянд, чистый минимализм',
    patch: {
      preset: 'obsidian',
      bubbleGradient: 'solid',
      ambientEffect: 'none',
      garlandEnabled: false,
      frostGlass: false,
      snowCaps: false,
      chatBackdrop: 'dots',
    },
  },
];

export const DEFAULT_THEME = {
  preset: 'ny_polar_aurora',
  customAccent: '#38bdf8',
  customBg0: '#060b16',
  customBubble: '',
  bubbleGradient: 'aurora',  // 'theme' | 'aurora' | 'festive_ruby' | 'pine_gold' | 'glacier' | 'sunset_berry' | 'warm_amber' | 'solid'
  ambientEffect: 'aurora_snow', // 'snowfall' | 'blizzard' | 'aurora_snow' | 'champagne_sparks' | 'stardust' | 'none'
  snowDensity: 'medium',     // 'light' | 'medium' | 'rich'
  garlandEnabled: true,
  garlandStyle: 'classic',   // 'classic' | 'warm_gold' | 'arctic_ice' | 'cyber_berry'
  frostGlass: true,
  snowCaps: true,
  avatarShape: 'squircle',   // 'squircle' | 'rounded' | 'circle'
  bubbleRadius: 16,          // 6 | 12 | 16 | 22
  chatBackdrop: 'snowflakes', // 'snowflakes' | 'aurora_mesh' | 'frost_prism' | 'festive_gold' | 'dots' | 'grid' | 'diag' | 'stars' | 'none'
  fontScale: 14,             // 12 | 13 | 14 | 15 | 16 | 18
  fontFamily: 'system',      // 'system' | 'inter' | 'mono'
  density: 'normal',         // 'compact' | 'normal' | 'spacious'
  animations: true,
  messageTail: true,
  v18FestiveReady: true,
};

export const BANNER_PRESETS = {
  ny_aurora: 'radial-gradient(circle at 25% 20%, #0d9488 0%, transparent 50%), radial-gradient(circle at 80% 25%, #6366f1 0%, transparent 52%), linear-gradient(135deg, #06182c 0%, #0f172a 55%, #2e1065 100%)',
  ny_pine: 'radial-gradient(circle at 75% 20%, rgba(251, 191, 36, 0.38) 0%, transparent 48%), linear-gradient(135deg, #064e3b 0%, #052e16 55%, #451a03 100%)',
  ny_ruby: 'radial-gradient(circle at 25% 20%, rgba(251, 191, 36, 0.3) 0%, transparent 45%), linear-gradient(135deg, #881337 0%, #4c0519 58%, #1f0916 100%)',
  ny_frost: 'radial-gradient(circle at 50% 15%, rgba(125, 211, 252, 0.42) 0%, transparent 52%), linear-gradient(135deg, #0c4a6e 0%, #1e3a8a 55%, #172554 100%)',
  ny_champagne: 'radial-gradient(circle at 30% 22%, rgba(253, 224, 71, 0.32) 0%, transparent 46%), linear-gradient(135deg, #422006 0%, #3b0764 58%, #09090b 100%)',
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

function liftHex(hex, add = 10) {
  const clean = String(hex || '#0b0d14').replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16) || 0x0b0d14;
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(((num >> 16) & 255) + add);
  const g = clamp(((num >> 8) & 255) + add);
  const b = clamp((num & 255) + add);
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export const DEFAULT_SETTINGS = {
  serverUrl: globalThis.MeshChatAndroid ? DEFAULT_CLOUD_URL : '',
  autoUpdateCheck: true,
  transportPolicy: TRANSPORT_POLICY.AUTO,
  onionUrl: '',
  i2pUrl: '',
  localBridgeUrl: 'ws://127.0.0.1:27700',
  paddingBlockBytes: 512,     // 256 | 512 | 1024 | 2048 | 4096
  coverTraffic: false,
  coverIntervalSec: 25,       // 10 | 25 | 60
  syncIntervalSec: 6,         // 3 | 6 | 15 | 30
  webrtcIcePolicy: 'all',     // 'all' | 'relay'
  customStunUrl: 'stun:stun.l.google.com:19302',

  // Чаты, ввод и медиа
  enterToSend: true,
  defaultTtlSec: 0,           // 0 | 30 | 300 | 3600 | 86400 | 604800
  timeFormat: '24h',          // '24h' | '24h_sec' | '12h'
  showChatAvatars: true,
  doubleTapAction: 'reply',   // 'reply' | 'copy' | 'react' | 'none'
  autoDecryptMedia: 'always', // 'always' | '1mb' | 'manual'
  confirmCall: false,
  spellcheck: true,
  sendReadReceipts: true,
  sendTypingIndicators: true,

  // Приватность, PIN-блокировка и маскировка экрана
  pinHashB64: '',
  pinSaltB64: '',
  autoLockMinutes: 0,         // 0 | 1 | 5 | 15 | 30
  clipboardAutoClearSec: 0,   // 0 | 15 | 30 | 60
  shareProfileE2ee: true,
  acceptAnonGateway: true,
  notificationContent: 'sender', // 'full' | 'sender' | 'stealth' | 'off'
  strictBossWipe: false,
  bossTemplate: 'xlsx',       // 'xlsx' | 'terminal' | 'notes'
  bossDocTitle: 'Финансовая_модель_Q4_консолидация.xlsx',

  // Звук и тактильная отдача
  sound: true,
  outgoingSound: true,
  soundProfile: 'crystal',    // 'crystal' | 'pulse' | 'sonar' | 'soft'
  haptics: 'soft',            // 'off' | 'soft' | 'strong'
};
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
    badge: 'verified',
    avatarDataUrl: '',
    bannerPreset: 'amoled',
    bannerCustomColor: '#1b2242',
    particles: 'stars',
    updatedAt: 0,
  },

  // Кастомная тема и визуал приложения
  theme: { ...DEFAULT_THEME },

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
    screenshotProtection: false,
    keepScreenOn: false,
    lanMeshRunning: false,
    lanUrl: '',
  },
  settings: { ...DEFAULT_SETTINGS },

  // Данные чатов и сообщений (расшифровываются из IndexedDB только в ОЗУ)
  chats: {},
  messages: {},
  outbox: [],
  decryptedMediaUrls: {},
  decryptedMediaBytes: {},
  typingByChat: {},
  call: null,

  // Состояние интерфейса (5 разделов: Чаты, Контакты, Mesh, Профиль, Настройки)
  ui: {
    navTab: 'chats',
    spaceFilter: 'all',
    settingsCategory: 'all',
    mobileTab: 'chats',
    activeChatId: null,
    inspectorOpen: false,
    searchQuery: '',
    chatSearchOpen: false,
    chatSearchQuery: '',
    replyTo: null,
    editingMsg: null,
    onceMode: false,
    bossActive: false,
    pinLocked: false,
    modal: null,
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
  store.ui.toasts = [...store.ui.toasts.slice(-1), { id, text, kind }];
  notifyStore();
  const timer = setTimeout(() => {
    store.ui.toasts = store.ui.toasts.filter((t) => t.id !== id);
    notifyStore();
  }, 2800);
  timer?.unref?.();
}

export function dismissToast(id) {
  store.ui.toasts = store.ui.toasts.filter((t) => t.id !== id);
  notifyStore();
}

/** Применяет выбранную тему, градиенты, снежные эффекты, шрифт и плотность к CSS-переменным документа */
export function applyThemeToDom() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const t = store.theme;
  const base = THEME_PRESETS[t.preset] || THEME_PRESETS.ny_polar_aurora || THEME_PRESETS.obsidian;
  const isCustom = t.preset === 'custom';
  const accent = isCustom ? (t.customAccent || '#38bdf8') : base.accent;
  const bg0 = isCustom ? (t.customBg0 || '#060b16') : base.bg0;
  const bg1 = isCustom ? liftHex(bg0, 8) : base.bg1;
  const bg2 = isCustom ? liftHex(bg0, 16) : base.bg2;
  const bg3 = isCustom ? liftHex(bg0, 26) : base.bg3;
  const bubbleSolid = t.customBubble || (isCustom ? hexToRgba(accent, 0.28) : base.bubbleOut);

  const appGradient = isCustom
    ? `radial-gradient(circle at 20% 12%, ${hexToRgba(accent, 0.22)} 0%, transparent 48%), linear-gradient(180deg, ${bg0} 0%, ${bg1} 100%)`
    : (base.appGradient || `linear-gradient(180deg, ${bg0} 0%, ${bg1} 100%)`);

  const accentGradient = isCustom
    ? `linear-gradient(135deg, ${accent} 0%, ${liftHex(accent, 34)} 100%)`
    : (base.accentGradient || `linear-gradient(135deg, ${accent} 0%, ${liftHex(accent, 28)} 100%)`);

  const chosenBubbleGrad = BUBBLE_GRADIENTS[t.bubbleGradient];
  const bubbleOutBg = t.customBubble
    ? t.customBubble
    : chosenBubbleGrad?.css === 'solid'
      ? bubbleSolid
      : (chosenBubbleGrad?.css || base.bubbleGradient || bubbleSolid);

  const fontStack =
    t.fontFamily === 'mono'
      ? "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"
      : t.fontFamily === 'inter'
        ? "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  const avatarRad =
    t.avatarShape === 'circle' ? '50%' : t.avatarShape === 'rounded' ? '18%' : '28%';

  const root = document.documentElement.style;
  root.setProperty('--bg-0', bg0);
  root.setProperty('--bg-1', bg1);
  root.setProperty('--bg-2', bg2);
  root.setProperty('--bg-3', bg3);
  root.setProperty('--accent', accent);
  root.setProperty('--accent-hover', accent);
  root.setProperty('--accent-soft', hexToRgba(accent, 0.16));
  root.setProperty('--accent-glow', hexToRgba(accent, 0.36));
  root.setProperty('--bubble-out', bubbleSolid);
  root.setProperty('--bubble-out-bg', bubbleOutBg);
  root.setProperty('--app-bg-gradient', appGradient);
  root.setProperty('--accent-gradient', accentGradient);
  root.setProperty('--avatar-radius', avatarRad);
  root.setProperty('--bubble-radius', `${Number(t.bubbleRadius) || 16}px`);
  root.setProperty('--msg-font-size', `${Number(t.fontScale) || 14}px`);
  root.setProperty('--font-ui', fontStack);

  const ds = document.documentElement.dataset;
  if (ds) {
    ds.backdrop = t.chatBackdrop || 'snowflakes';
    ds.density = t.density || 'normal';
    ds.motion = t.animations === false ? 'reduced' : 'full';
    ds.tails = t.messageTail === false ? 'off' : 'on';
    ds.frost = t.frostGlass === false ? 'off' : 'on';
    ds.snowcaps = t.snowCaps ? 'on' : 'off';
    ds.garland = t.garlandEnabled ? 'on' : 'off';
  }

  const metaTheme = document.querySelector?.('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', bg0);
  if (globalThis.MeshChatAndroid?.setSystemBarColor) {
    try { globalThis.MeshChatAndroid.setSystemBarColor(bg0); } catch { /* ignore */ }
  }
}

export function triggerHaptic(kind = 'tap') {
  const mode = store.settings.haptics || 'soft';
  if (mode === 'off') return;
  const ms = mode === 'strong' ? (kind === 'heavy' ? 36 : 24) : (kind === 'heavy' ? 20 : 11);
  try {
    if (globalThis.MeshChatAndroid?.vibrate) {
      globalThis.MeshChatAndroid.vibrate(ms);
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch { /* ignore */ }
}

let clipboardClearTimer = null;

export function copyWithPrivacy(text, toastMessage = 'Скопировано в буфер обмена') {
  if (!text) return;
  triggerHaptic('tap');
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(String(text)).catch(() => {});
  }
  const clearSec = Number(store.settings.clipboardAutoClearSec) || 0;
  if (clearSec > 0) {
    clearTimeout(clipboardClearTimer);
    clipboardClearTimer = setTimeout(() => {
      navigator.clipboard?.writeText('').catch(() => {});
    }, clearSec * 1000);
    clipboardClearTimer?.unref?.();
    showToast(`${toastMessage} · очистка через ${clearSec} с`);
  } else {
    showToast(toastMessage);
  }
}

/** Универсальное сохранение файла в Android APK (MediaStore Downloads) и браузере */
export function downloadBytesCrossPlatform(bytesOrText, filename, mime = 'application/octet-stream') {
  const bytes = typeof bytesOrText === 'string'
    ? utf8ToBytes(bytesOrText)
    : (bytesOrText instanceof Uint8Array ? bytesOrText : new Uint8Array(bytesOrText));

  if (globalThis.MeshChatAndroid?.saveBase64Document) {
    try {
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const stdB64 = btoa(binary);
      const saved = Boolean(globalThis.MeshChatAndroid.saveBase64Document(filename, mime, stdB64));
      if (saved) {
        showToast(`Сохранено в Загрузки: ${filename}`);
        return true;
      }
    } catch { /* fallback to DOM anchor */ }
  }

  if (typeof document !== 'undefined') {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    const t = setTimeout(() => URL.revokeObjectURL(url), 4000);
    t?.unref?.();
    return true;
  }
  return false;
}

function emitBackgroundNotification(senderTitle, previewText) {
  const mode = store.settings.notificationContent || 'sender';
  if (mode === 'off') return;

  const title = mode === 'stealth' ? 'MeshChat' : (senderTitle || 'MeshChat');
  const body =
    mode === 'full'
      ? (previewText || 'Зашифрованное вложение')
      : 'Новое зашифрованное сообщение (E2EE)';

  try {
    if (globalThis.MeshChatAndroid?.showLocalNotification) {
      globalThis.MeshChatAndroid.showLocalNotification(title, body);
      return;
    }
    if (
      typeof document !== 'undefined' &&
      document.hidden &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      new Notification(title, { body, tag: 'meshchat-msg' });
    }
  } catch { /* ignore */ }
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
      store.android.screenshotProtection = Boolean(info.screenshotProtection);
      store.android.keepScreenOn = Boolean(info.keepScreenOn);
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

export function toggleScreenshotProtection() {
  if (!globalThis.MeshChatAndroid?.setScreenshotProtection) {
    showToast('Управление системным флагом FLAG_SECURE доступно в Android-приложении MeshChat.apk');
    return;
  }
  try {
    const next = !store.android.screenshotProtection;
    const applied = Boolean(globalThis.MeshChatAndroid.setScreenshotProtection(next));
    store.android.screenshotProtection = applied;
    showToast(
      applied
        ? 'Защита от скриншотов (FLAG_SECURE) включена'
        : 'Скриншоты и запись экрана разрешены'
    );
    notifyStore();
  } catch (err) {
    showToast(err.message, 'err');
  }
}

export function toggleKeepScreenOn() {
  if (!globalThis.MeshChatAndroid?.setKeepScreenOn) {
    showToast('Удержание подсветки экрана FLAG_KEEP_SCREEN_ON доступно в Android APK');
    return;
  }
  try {
    const next = !store.android.keepScreenOn;
    const applied = Boolean(globalThis.MeshChatAndroid.setKeepScreenOn(next));
    store.android.keepScreenOn = applied;
    triggerHaptic('tap');
    showToast(
      applied
        ? 'Экран будет оставаться включённым во время работы приложения'
        : 'Стандартный таймер сна экрана восстановлен'
    );
    notifyStore();
  } catch (err) {
    showToast(err.message, 'err');
  }
}

export function handleBackNavigation() {
  if (store.ui.pinLocked) {
    return true;
  }
  if (store.ui.bossActive) {
    toggleBossMode(false);
    return true;
  }
  if (store.ui.modal) {
    if (store.ui.modal === 'once-viewer' && store.ui.modalData?.url) {
      URL.revokeObjectURL(store.ui.modalData.url);
    }
    store.ui.modal = null;
    store.ui.modalData = null;
    notifyStore();
    return true;
  }
  if (store.ui.inspectorOpen) {
    store.ui.inspectorOpen = false;
    notifyStore();
    return true;
  }
  const isMobileViewport =
    Boolean(globalThis.MeshChatAndroid) ||
    (typeof window !== 'undefined' && window.innerWidth <= 860);
  if (store.ui.navTab === 'chats' && store.ui.activeChatId && isMobileViewport) {
    store.ui.activeChatId = null;
    notifyStore();
    return true;
  }
  if (store.me && store.ui.navTab && store.ui.navTab !== 'chats') {
    store.ui.navTab = 'chats';
    notifyStore();
    return true;
  }
  return false;
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

let lastUserActivityAt = Date.now();
let autoLockTimer = null;

function restartSyncLoop() {
  clearInterval(syncLoopTimer);
  const sec = Math.max(2, Number(store.settings.syncIntervalSec) || 6);
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
  }, sec * 1000);
  syncLoopTimer?.unref?.();
}

function startAutoLockWatchdog() {
  if (typeof window === 'undefined') return;
  const markActive = () => { lastUserActivityAt = Date.now(); };
  window.addEventListener?.('pointerdown', markActive, { passive: true });
  window.addEventListener?.('keydown', markActive, { passive: true });

  clearInterval(autoLockTimer);
  autoLockTimer = setInterval(() => {
    const mins = Number(store.settings.autoLockMinutes) || 0;
    if (!mins || !store.me) return;
    if (Date.now() - lastUserActivityAt >= mins * 60_000) {
      lastUserActivityAt = Date.now();
      if (store.settings.pinHashB64) {
        if (!store.ui.pinLocked) {
          store.ui.pinLocked = true;
          if (store.settings.strictBossWipe) cryptoWorker.call('lockRamCache').catch(() => {});
          notifyStore();
        }
      } else if (!store.ui.bossActive) {
        toggleBossMode(true);
      }
    }
  }, 5000);
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
    if (savedTheme) {
      Object.assign(store.theme, savedTheme);
      // Однократная активация зимней атмосферы и градиентов при обновлении до v1.8
      if (!savedTheme.v18FestiveReady) {
        if (!savedTheme.preset || savedTheme.preset === 'obsidian') {
          store.theme.preset = 'ny_polar_aurora';
          store.theme.customAccent = '#38bdf8';
          store.theme.customBg0 = '#060b16';
          store.theme.bubbleGradient = 'aurora';
        }
        if (!savedTheme.chatBackdrop || savedTheme.chatBackdrop === 'dots') {
          store.theme.chatBackdrop = 'snowflakes';
        }
        store.theme.ambientEffect = 'aurora_snow';
        store.theme.snowDensity = 'medium';
        store.theme.garlandEnabled = true;
        store.theme.garlandStyle = 'classic';
        store.theme.frostGlass = true;
        store.theme.snowCaps = true;
        store.theme.v18FestiveReady = true;
        await clientDb.set('theme', store.theme).catch(() => {});
      }
    }
    if (savedProfile) Object.assign(store.profile, savedProfile);

    await cryptoWorker.call('setCryptoConfig', {
      paddingBlockBytes: Number(store.settings.paddingBlockBytes) || 512,
    }).catch(() => {});

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
      if (store.settings.pinHashB64) {
        store.ui.pinLocked = true;
      }
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
  restartSyncLoop();
  startAutoLockWatchdog();

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
          iceTransportPolicy: store.settings.webrtcIcePolicy || 'all',
          coverTrafficIntervalMs: store.settings.coverTraffic
            ? Math.max(5, Number(store.settings.coverIntervalSec) || 25) * 1000
            : 0,
          getIceServers: async () => {
            const customStun = (store.settings.customStunUrl || '').trim();
            const fallbackStun = customStun ? [{ urls: customStun }] : [];
            if (!rpcChannel) return fallbackStun;
            try {
              const { data } = await rpcChannel.request('turn.credentials', {});
              return [...(data.iceServers || []), ...fallbackStun];
            } catch {
              return fallbackStun;
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
  if (store.settings.shareProfileE2ee === false) {
    return {
      displayName: (store.me?.username || '').slice(0, 40),
      statusText: '',
      bio: '',
      badge: 'none',
      avatarDataUrl: '',
      bannerPreset: 'amoled',
      bannerCustomColor: '#1b2242',
      particles: 'none',
      updatedAt: Date.now(),
    };
  }
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
      ttlSec: payload.ttlSec || Number(store.settings.defaultTtlSec) || 0,
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

  // Обработка E2EE сигналинга голосовых вызовов DTLS-SRTP
  if (payload.type === 'call-signal') {
    await callManager.handleIncomingSignal(store.chats[chatId], payload, {
      getIceServers: fetchCurrentIceServers,
      iceTransportPolicy: store.settings.webrtcIcePolicy || 'all',
      transportPolicy: store.settings.transportPolicy,
    });
    if (payload.action === 'offer' && !store.chats[chatId].muted) {
      emitBackgroundNotification(
        store.chats[chatId].peerProfile?.displayName || store.chats[chatId].title,
        'Входящий голосовой вызов (DTLS-SRTP)'
      );
    }
    return;
  }

  // Индикатор набора текста (E2EE)
  if (payload.type === 'typing') {
    store.typingByChat[chatId] = Date.now() + 4500;
    notifyStore();
    const clearT = setTimeout(() => {
      if ((store.typingByChat[chatId] || 0) <= Date.now()) {
        delete store.typingByChat[chatId];
        notifyStore();
      }
    }, 4600);
    clearT?.unref?.();
    return;
  }

  // Квитанции доставки и прочтения (✓✓)
  if (payload.type === 'receipt' && Array.isArray(payload.msgIds)) {
    const list = store.messages[chatId] || [];
    let changed = false;
    const rank = { sending: 0, queued: 1, sent: 2, delivered: 3, read: 4 };
    const nextStatus = payload.kind === 'read' ? 'read' : 'delivered';
    for (const m of list) {
      if (m.out && payload.msgIds.includes(m.id)) {
        if ((rank[nextStatus] || 0) > (rank[m.status] || 0)) {
          m.status = nextStatus;
          changed = true;
        }
      }
    }
    if (changed) {
      await persistChatsAndMessages();
      notifyStore();
    }
    return;
  }

  // Редактирование сообщения по E2EE
  if (payload.type === 'edit' && payload.targetMsgId && typeof payload.text === 'string') {
    const list = store.messages[chatId] || [];
    const target = list.find((m) => m.id === payload.targetMsgId && !m.out);
    if (target) {
      target.text = payload.text.slice(0, 4000);
      target.editedAt = Date.now();
      if (list[list.length - 1]?.id === target.id) {
        store.chats[chatId].lastPreview = target.text.slice(0, 90);
      }
      await persistChatsAndMessages();
      notifyStore();
    }
    return;
  }

  // Удаление сообщения у обоих собеседников по E2EE
  if (payload.type === 'delete' && payload.targetMsgId) {
    const list = store.messages[chatId] || [];
    const next = list.filter((m) => !(m.id === payload.targetMsgId && !m.out));
    if (next.length !== list.length) {
      store.messages[chatId] = next;
      const last = next[next.length - 1];
      store.chats[chatId].lastPreview = last
        ? (last.media ? `[Файл] ${last.media.name}` : (last.text || '').slice(0, 90))
        : 'Сообщение удалено';
      await persistChatsAndMessages();
      notifyStore();
    }
    return;
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

  delete store.typingByChat[chatId];

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
    ? (msg.media.once
      ? '[1×] Вложение'
      : msg.media.mime?.startsWith('audio/')
        ? 'Голосовое сообщение (E2EE)'
        : `[Файл] ${msg.media.name}`)
    : msg.text.slice(0, 90);

  const isChatVisible =
    store.ui.activeChatId === chatId &&
    store.ui.navTab === 'chats' &&
    !store.ui.bossActive &&
    !store.ui.pinLocked;

  if (!isChatVisible) {
    chat.unread = (chat.unread || 0) + 1;
  }

  // Отправляем E2EE-квитанцию о получении (или сразу о прочтении, если чат открыт)
  const receiptKind = isChatVisible && store.settings.sendReadReceipts !== false ? 'read' : 'delivered';
  msg.readSent = receiptKind === 'read';
  deliverPayloadToPeer(chat, { type: 'receipt', kind: receiptKind, msgIds: [msg.id] }).catch(() => {});

  if (!chat.muted && !store.ui.bossActive && !store.ui.pinLocked) {
    if (store.settings.sound !== false) {
      playSfx('incoming', store.settings.soundProfile || 'crystal');
    }
    triggerHaptic('heavy');
  }
  if (!chat.muted) {
    emitBackgroundNotification(chat.peerProfile?.displayName || chat.title, chat.lastPreview);
  }

  // Автоматическая предрасшифровка входящих изображений по политике медиа
  if (
    msg.media &&
    !msg.media.once &&
    msg.media.mime?.startsWith('image/') &&
    store.settings.autoDecryptMedia !== 'manual'
  ) {
    const withinLimit =
      store.settings.autoDecryptMedia === 'always' ||
      (Number(msg.media.size) || 0) <= 1048576;
    if (withinLimit) {
      openEncryptedMedia(msg).catch(() => {});
    }
  }

  await persistChatsAndMessages();
  notifyStore();
}

async function processIncomingAsk(askItem, { skipImmediateAck = false } = {}) {
  try {
    if (store.settings.acceptAnonGateway === false) {
      if (!skipImmediateAck && rpcChannel) {
        rpcChannel.request('mailbox.ack', { ids: [], askIds: [askItem.id] }).catch(() => {});
      }
      return;
    }
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
    if (store.settings.sound !== false && !store.ui.bossActive && !store.ui.pinLocked) {
      playSfx('incoming', store.settings.soundProfile || 'crystal');
    }
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
  Object.assign(store.theme, patch, { v18FestiveReady: true });
  applyThemeToDom();
  triggerHaptic('tap');
  await clientDb.set('theme', store.theme);
  notifyStore();
}

export async function applyHolidayMoodPack(packId) {
  const found = HOLIDAY_MOOD_PACKS.find((p) => p.id === packId);
  if (!found) return;
  const presetObj = THEME_PRESETS[found.patch.preset];
  Object.assign(store.theme, found.patch, {
    customAccent: presetObj?.accent || store.theme.customAccent,
    customBg0: presetObj?.bg0 || store.theme.customBg0,
    customBubble: '',
    v18FestiveReady: true,
  });
  applyThemeToDom();
  triggerHaptic('heavy');
  await clientDb.set('theme', store.theme);
  showToast(`Сцена применена: ${found.title}`);
  notifyStore();
}

export async function resetThemeSettings() {
  store.theme = { ...DEFAULT_THEME };
  applyThemeToDom();
  triggerHaptic('tap');
  await clientDb.set('theme', store.theme);
  showToast('Тема оформления возвращена к стандартной');
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
    ttlSec: existing?.ttlSec !== undefined ? existing.ttlSec : (Number(store.settings.defaultTtlSec) || 0),
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

export function markChatRead(chatId) {
  const chat = store.chats[chatId];
  if (!chat) return;
  chat.unread = 0;
  if (chat.kind === 'dm' && store.settings.sendReadReceipts !== false) {
    const list = store.messages[chatId] || [];
    const unreadIds = list.filter((m) => !m.out && !m.readSent).map((m) => m.id);
    if (unreadIds.length > 0) {
      for (const m of list) {
        if (!m.out) m.readSent = true;
      }
      deliverPayloadToPeer(chat, { type: 'receipt', kind: 'read', msgIds: unreadIds }).catch(() => {});
    }
  }
  persistChatsAndMessages();
}

export function selectChat(chatId) {
  store.ui.activeChatId = chatId;
  store.ui.replyTo = null;
  store.ui.editingMsg = null;
  store.ui.chatSearchOpen = false;
  store.ui.chatSearchQuery = '';
  if (chatId) store.ui.navTab = 'chats';
  if (store.chats[chatId]) {
    markChatRead(chatId);
  }
  notifyStore();
}

let lastTypingSentByChat = {};

export function notifyTypingInChat(chatId) {
  if (store.settings.sendTypingIndicators === false) return;
  const chat = store.chats[chatId];
  if (!chat || chat.kind !== 'dm') return;
  const now = Date.now();
  if (now - (lastTypingSentByChat[chatId] || 0) < 2800) return;
  lastTypingSentByChat[chatId] = now;
  deliverPayloadToPeer(chat, { type: 'typing' }).catch(() => {});
}

export async function editChatMessage(chatId, msgId, newText) {
  const chat = store.chats[chatId];
  const trimmed = String(newText || '').trim();
  if (!chat || !trimmed) return;
  const list = store.messages[chatId] || [];
  const msg = list.find((m) => m.id === msgId && m.out);
  if (!msg) return;

  msg.text = trimmed;
  msg.editedAt = Date.now();
  store.ui.editingMsg = null;
  if (list[list.length - 1]?.id === msg.id) {
    chat.lastPreview = trimmed.slice(0, 90);
  }
  await persistChatsAndMessages();
  notifyStore();

  if (chat.kind === 'dm') {
    await deliverPayloadToPeer(chat, { type: 'edit', targetMsgId: msgId, text: trimmed });
  }
}

export async function deleteChatMessage(chatId, msgId, { forEveryone = false } = {}) {
  const chat = store.chats[chatId];
  if (!chat) return;
  const list = store.messages[chatId] || [];
  const target = list.find((m) => m.id === msgId);
  if (!target) return;

  store.messages[chatId] = list.filter((m) => m.id !== msgId);
  const last = store.messages[chatId][store.messages[chatId].length - 1];
  chat.lastPreview = last
    ? (last.media ? `[Файл] ${last.media.name}` : (last.text || '').slice(0, 90))
    : 'Сообщений нет';
  await persistChatsAndMessages();
  notifyStore();

  if (forEveryone && target.out && chat.kind === 'dm') {
    await deliverPayloadToPeer(chat, { type: 'delete', targetMsgId: msgId });
    showToast('Сообщение удалено у обоих собеседников');
  } else {
    showToast('Сообщение удалено локально');
  }
}

export async function toggleChatMute(chatId) {
  const chat = store.chats[chatId];
  if (!chat) return;
  chat.muted = !chat.muted;
  await persistChatsAndMessages();
  notifyStore();
  showToast(chat.muted ? 'Оповещения чата отключены' : 'Оповещения чата включены');
}

export async function clearSingleChatHistory(chatId) {
  const chat = store.chats[chatId];
  if (!chat) return;
  store.messages[chatId] = [];
  chat.unread = 0;
  chat.lastPreview = 'История чата очищена';
  await persistChatsAndMessages();
  notifyStore();
  showToast('История выбранного диалога очищена');
}

export async function deleteChat(chatId) {
  const chat = store.chats[chatId];
  if (!chat || chat.kind === 'echo' || chat.kind === 'ask') {
    showToast('Системные защищённые каналы можно очистить, но не удалить');
    return;
  }
  delete store.chats[chatId];
  delete store.messages[chatId];
  if (store.ui.activeChatId === chatId) {
    store.ui.activeChatId = null;
    store.ui.inspectorOpen = false;
  }
  await persistChatsAndMessages();
  notifyStore();
  showToast('Диалог удалён с устройства');
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
    ? (localMsg.media.once
      ? '[1×] Вложение'
      : localMsg.media.mime?.startsWith('audio/')
        ? 'Голосовое сообщение (E2EE)'
        : `[Файл] ${localMsg.media.name}`)
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
    if (store.settings.sound !== false && store.settings.outgoingSound !== false) {
      playSfx('sent', store.settings.soundProfile || 'crystal');
    }
    triggerHaptic('tap');
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
      if (store.settings.sound !== false && store.settings.outgoingSound !== false) {
        playSfx('sent', store.settings.soundProfile || 'crystal');
      }
      triggerHaptic('tap');
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
      store.decryptedMediaBytes[blobId] = plainBytes;
      notifyStore();
    }
    return blobUrl;
  } catch (err) {
    showToast(err.message, 'err');
    return null;
  }
}

export async function saveDecryptedMediaToDevice(msg) {
  if (!msg?.media?.blobId) return;
  const { blobId, mime, name } = msg.media;
  if (!store.decryptedMediaBytes[blobId]) {
    await openEncryptedMedia(msg);
  }
  const bytes = store.decryptedMediaBytes[blobId];
  if (bytes) {
    downloadBytesCrossPlatform(bytes, name || 'decrypted.bin', mime || 'application/octet-stream');
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
  try {
    await rpcChannel.request('ask.block', { senderBlockTag });
    showToast('Отправитель заблокирован по слепому HMAC-идентификатору');
  } catch (err) {
    showToast(err.message, 'err');
  }
}

export async function rotateBlindMailbox() {
  if (!rpcChannel) {
    showToast('Нет активного соединения с узлом ретрансляции', 'err');
    return;
  }
  try {
    const { data } = await rpcChannel.request('mailbox.rotate');
    store.me.mailboxId = data.mailboxId;
    store.me.mailboxWriteToken = data.mailboxWriteToken;
    await clientDb.set('me', store.me);
    showToast('Адрес слепого почтового ящика перевыпущен. Прежние токены отозваны.');
    notifyStore();
  } catch (err) {
    showToast(err.message, 'err');
  }
}

export async function updateClientSettings(patch) {
  Object.assign(store.settings, patch);
  triggerHaptic('tap');

  if (patch.serverUrl !== undefined) {
    const raw = (patch.serverUrl || '').trim().replace(/\/+$/, '');
    if (raw.includes('.onion')) {
      const host = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      store.settings.onionUrl = `ws://${host}/ws`;
      store.settings.transportPolicy = TRANSPORT_POLICY.TOR_ONLY;
    }
    syncAndroidNativeBridge();
  }

  if (patch.paddingBlockBytes !== undefined) {
    await cryptoWorker.call('setCryptoConfig', {
      paddingBlockBytes: Number(store.settings.paddingBlockBytes) || 512,
    }).catch(() => {});
  }

  if (patch.syncIntervalSec !== undefined) {
    restartSyncLoop();
  }

  await clientDb.set('settings', store.settings);
  notifyStore();

  if (
    patch.serverUrl !== undefined ||
    patch.transportPolicy !== undefined ||
    patch.onionUrl !== undefined ||
    patch.i2pUrl !== undefined ||
    patch.coverTraffic !== undefined ||
    patch.coverIntervalSec !== undefined ||
    patch.webrtcIcePolicy !== undefined ||
    patch.customStunUrl !== undefined
  ) {
    if (store.me) await connectActiveTransport();
  }
}

// ─────────────── Локальный PIN-код, Память и Зашифрованный Резерв (AES-256-GCM) ───────────────

async function computePinHashB64(pinStr, saltB64) {
  const digest = await sha256(utf8ToBytes(`MESHCHAT-PIN-v1:${saltB64}:${String(pinStr).trim()}`));
  return toBase64Url(digest);
}

export async function setAppPin(newPin) {
  const clean = String(newPin || '').trim();
  if (!/^\d{4,8}$/.test(clean)) {
    throw new Error('PIN-код должен содержать от 4 до 8 цифр');
  }
  const saltB64 = toBase64Url(randomBytes(16));
  const hashB64 = await computePinHashB64(clean, saltB64);
  store.settings.pinSaltB64 = saltB64;
  store.settings.pinHashB64 = hashB64;
  store.ui.pinLocked = false;
  await clientDb.set('settings', store.settings);
  triggerHaptic('heavy');
  showToast('PIN-блокировка интерфейса включена');
  notifyStore();
}

export async function disableAppPin(currentPin = '') {
  if (store.settings.pinHashB64) {
    const check = await computePinHashB64(currentPin, store.settings.pinSaltB64);
    if (check !== store.settings.pinHashB64) {
      throw new Error('Неверный текущий PIN-код');
    }
  }
  store.settings.pinHashB64 = '';
  store.settings.pinSaltB64 = '';
  store.ui.pinLocked = false;
  await clientDb.set('settings', store.settings);
  triggerHaptic('tap');
  showToast('PIN-блокировка интерфейса отключена');
  notifyStore();
}

export async function unlockWithPin(pin) {
  if (!store.settings.pinHashB64) {
    store.ui.pinLocked = false;
    notifyStore();
    return true;
  }
  const check = await computePinHashB64(pin, store.settings.pinSaltB64);
  if (check === store.settings.pinHashB64) {
    store.ui.pinLocked = false;
    lastUserActivityAt = Date.now();
    triggerHaptic('tap');
    notifyStore();
    return true;
  }
  triggerHaptic('heavy');
  return false;
}

export function lockAppNow() {
  if (store.settings.pinHashB64) {
    store.ui.pinLocked = true;
    if (store.settings.strictBossWipe) {
      cryptoWorker.call('lockRamCache').catch(() => {});
    }
    triggerHaptic('tap');
    notifyStore();
    return;
  }
  toggleBossMode(true);
}

async function deriveBackupAesKey(passphrase, saltBytes) {
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    utf8ToBytes(passphrase),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 210_000, hash: 'SHA-256' },
    baseKey,
    256
  );
  return new Uint8Array(bits);
}

export async function exportEncryptedBackup(passphrase) {
  const pwd = String(passphrase || '');
  if (pwd.length < 6) {
    throw new Error('Укажите парольную фразу резервной копии не короче 6 символов');
  }
  const snapshot = {
    schema: 'meshchat-encrypted-backup-v1',
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    username: store.me?.username || '',
    profile: store.profile,
    theme: store.theme,
    settings: {
      ...store.settings,
      pinHashB64: '',
      pinSaltB64: '',
    },
    chats: store.chats,
    messages: store.messages,
  };

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveBackupAesKey(pwd, salt);
  const plainBytes = utf8ToBytes(JSON.stringify(snapshot));
  const aad = utf8ToBytes('MESHCHAT-BACKUP-AAD-v1');
  const ct = await aesGcmEncrypt(key, iv, plainBytes, aad);
  key.fill(0);

  const envelope = {
    format: 'meshchat-vault-v1',
    kdf: 'PBKDF2-SHA256-210000',
    cipher: 'AES-256-GCM',
    saltB64: toBase64Url(salt),
    ivB64: toBase64Url(iv),
    ctB64: toBase64Url(ct),
  };

  const jsonStr = JSON.stringify(envelope, null, 2);
  const fname = `meshchat-${store.me?.username || 'vault'}-${new Date().toISOString().slice(0, 10)}.enc.json`;
  downloadBytesCrossPlatform(jsonStr, fname, 'application/json');
  showToast('Зашифрованный архив AES-256-GCM сформирован');
  return envelope;
}

export async function importEncryptedBackup(jsonTextOrObj, passphrase) {
  const pwd = String(passphrase || '');
  if (pwd.length < 6) {
    throw new Error('Введите парольную фразу архива (минимум 6 символов)');
  }
  const env = typeof jsonTextOrObj === 'string' ? JSON.parse(jsonTextOrObj) : jsonTextOrObj;
  if (!env || env.format !== 'meshchat-vault-v1' || !env.saltB64 || !env.ivB64 || !env.ctB64) {
    throw new Error('Неподдерживаемый или повреждённый формат резервного файла');
  }
  const salt = fromBase64Url(env.saltB64);
  const iv = fromBase64Url(env.ivB64);
  const ct = fromBase64Url(env.ctB64);
  const key = await deriveBackupAesKey(pwd, salt);

  let plainBytes;
  try {
    plainBytes = await aesGcmDecrypt(key, iv, ct, utf8ToBytes('MESHCHAT-BACKUP-AAD-v1'));
  } catch {
    throw new Error('Неверная парольная фраза или нарушена целостность архива AES-256-GCM');
  } finally {
    key.fill(0);
  }

  const snap = JSON.parse(bytesToUtf8(plainBytes));
  if (snap.profile && typeof snap.profile === 'object') {
    Object.assign(store.profile, snap.profile);
    await clientDb.set('profile', store.profile);
  }
  if (snap.theme && typeof snap.theme === 'object') {
    Object.assign(store.theme, snap.theme);
    applyThemeToDom();
    await clientDb.set('theme', store.theme);
  }
  if (snap.settings && typeof snap.settings === 'object') {
    const keepPinHash = store.settings.pinHashB64;
    const keepPinSalt = store.settings.pinSaltB64;
    Object.assign(store.settings, snap.settings, {
      pinHashB64: keepPinHash,
      pinSaltB64: keepPinSalt,
    });
    await clientDb.set('settings', store.settings);
  }
  if (snap.chats && typeof snap.chats === 'object') {
    store.chats = ensureSystemChats({ ...snap.chats, ...store.chats }, store.me?.username || '');
  }
  if (snap.messages && typeof snap.messages === 'object') {
    for (const [cid, arr] of Object.entries(snap.messages)) {
      if (!Array.isArray(arr)) continue;
      const cur = store.messages[cid] || [];
      const seen = new Set(cur.map((m) => m.id));
      store.messages[cid] = [...cur, ...arr.filter((m) => m && !seen.has(m.id))].sort(
        (a, b) => (a.ts || 0) - (b.ts || 0)
      );
    }
  }
  await persistChatsAndMessages();
  restartSyncLoop();
  notifyStore();
  showToast('Резервная копия расшифрована и восстановлена');
  return snap;
}

export function clearDecryptedMediaCache() {
  let count = 0;
  for (const [blobId, url] of Object.entries(store.decryptedMediaUrls)) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    delete store.decryptedMediaUrls[blobId];
    delete store.decryptedMediaBytes[blobId];
    count += 1;
  }
  triggerHaptic('tap');
  showToast(count > 0 ? `Освобождено объектов медиа из ОЗУ: ${count}` : 'Кеш расшифрованных медиа уже пуст');
  notifyStore();
}

export async function clearAllMessagesHistory() {
  for (const cid of Object.keys(store.messages)) {
    store.messages[cid] = [];
  }
  store.messages = ensureSystemMessages({}, store.me?.username || '');
  for (const chat of Object.values(store.chats)) {
    chat.unread = 0;
    if (chat.kind === 'dm') {
      chat.lastPreview = 'История очищена локально · E2EE активно';
    }
  }
  clearDecryptedMediaCache();
  await persistChatsAndMessages();
  showToast('Локальная история переписки очищена (ключи и контакты сохранены)');
  notifyStore();
}

export async function resetAllSettingsToDefaults() {
  const keepServer = store.settings.serverUrl;
  store.settings = { ...DEFAULT_SETTINGS, serverUrl: keepServer };
  store.theme = { ...DEFAULT_THEME };
  store.ui.pinLocked = false;
  applyThemeToDom();
  restartSyncLoop();
  await cryptoWorker.call('setCryptoConfig', { paddingBlockBytes: 512 }).catch(() => {});
  await Promise.all([
    clientDb.set('settings', store.settings),
    clientDb.set('theme', store.theme),
  ]);
  showToast('Все настройки интерфейса и клиента сброшены к стандартным');
  notifyStore();
}

export function getStorageStats() {
  const chatList = Object.values(store.chats);
  const dmCount = chatList.filter((c) => c.kind === 'dm').length;
  let msgCount = 0;
  for (const arr of Object.values(store.messages)) {
    msgCount += Array.isArray(arr) ? arr.length : 0;
  }
  const mediaCached = Object.keys(store.decryptedMediaUrls).length;
  const approxBytes =
    utf8ToBytes(JSON.stringify(store.chats)).byteLength +
    utf8ToBytes(JSON.stringify(store.messages)).byteLength +
    utf8ToBytes(JSON.stringify(store.profile)).byteLength;

  return {
    chatsTotal: chatList.length,
    dmCount,
    msgCount,
    mediaCached,
    outboxCount: store.outbox.length,
    approxBytes,
  };
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

// ─────────────── Голосовые E2EE P2P вызовы (DTLS-SRTP) и системные уведомления ───────────────

async function fetchCurrentIceServers() {
  const customStun = (store.settings.customStunUrl || '').trim();
  const fallbackStun = customStun ? [{ urls: customStun }] : [];
  if (!rpcChannel || !activeTransport?.isConnected) return fallbackStun;
  try {
    const { data } = await rpcChannel.request('turn.credentials', {});
    return [...(data.iceServers || []), ...fallbackStun];
  } catch {
    return fallbackStun;
  }
}

const callManager = new E2eeCallManager({
  sendSignalToChat: async (chat, sigPayload) => {
    await deliverPayloadToPeer(chat, sigPayload);
  },
  onRingTick: () => {
    const chat = store.chats[callManager.state.chatId];
    if (!chat?.muted && !store.ui.bossActive && !store.ui.pinLocked) {
      if (store.settings.sound !== false) playSfx('ring');
      triggerHaptic('heavy');
    }
  },
  onStateChange: () => {
    store.call = callManager.state.active ? { ...callManager.state } : null;
    if (store.call) {
      store.ui.modal = 'call';
    } else if (store.ui.modal === 'call') {
      store.ui.modal = null;
      store.ui.modalData = null;
    }
    notifyStore();
  },
});

export async function startVoiceCall(chatId) {
  const chat = store.chats[chatId];
  if (!chat || chat.kind !== 'dm') return;
  try {
    const iceServers = await fetchCurrentIceServers();
    await callManager.startOutgoingCall({
      chat,
      iceServers,
      iceTransportPolicy: store.settings.webrtcIcePolicy || 'all',
      transportPolicy: store.settings.transportPolicy,
    });
  } catch (err) {
    showToast(err.message, 'err');
  }
}

export async function acceptVoiceCall() {
  try {
    await callManager.acceptIncomingCall();
  } catch (err) {
    showToast(err.message, 'err');
  }
}

export async function declineVoiceCall() {
  const chat = store.call?.chatId ? store.chats[store.call.chatId] : null;
  await callManager.declineIncomingCall(chat);
}

export async function hangupVoiceCall() {
  const chat = store.call?.chatId ? store.chats[store.call.chatId] : null;
  await callManager.hangup(chat);
}

export function toggleCallMute() {
  triggerHaptic('tap');
  return callManager.toggleMute();
}

export function dismissCallModal() {
  callManager.dismissEndedModal();
}

export async function requestSystemNotificationAccess() {
  if (globalThis.MeshChatAndroid?.requestNotificationPermission) {
    globalThis.MeshChatAndroid.requestNotificationPermission();
    showToast('Запрос разрешения системных уведомлений отправлен ОС Android');
    return;
  }
  if (typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function') {
    const perm = await Notification.requestPermission();
    showToast(perm === 'granted' ? 'Системные уведомления разрешены' : 'Уведомления отклонены браузером');
  }
}
