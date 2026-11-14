// Базовые утилиты интерфейса: векторные иконки (0 сетевых запросов),
// компонент аватаров с поддержкой фото и геометрического паттерна, фоновые частицы профиля,
// синтезатор системных сигналов WebAudio и экран экстренной маскировки (двойной Esc).

import { html, useState } from '../../vendor/preact.mjs';
import { buildQrSvgModel } from '../../../shared/qr/qrcode.mjs';

// ─────────────────────── Синтез коротких системных сигналов WebAudio ───────────────────────

let audioCtx = null;
function getAudio() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function synthTone(freq, delay, duration, { type = 'sine', gain = 0.05, endFreq = null } = {}) {
  const ctx = getAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  const start = ctx.currentTime + delay;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.025);
}

export function playSfx(kind, profile = 'crystal') {
  try {
    if (kind === 'click') {
      synthTone(440, 0, 0.025, { gain: 0.025 });
      return;
    }
    if (kind === 'ring') {
      if (profile === 'silent') return;
      if (profile === 'northern') {
        synthTone(659.25, 0, 0.16, { gain: 0.05 });
        synthTone(880, 0.17, 0.18, { gain: 0.05 });
        synthTone(1046.5, 0.35, 0.24, { gain: 0.045 });
        return;
      }
      if (profile === 'pulse') {
        synthTone(523.25, 0, 0.12, { type: 'triangle', gain: 0.055 });
        synthTone(783.99, 0.15, 0.18, { type: 'triangle', gain: 0.05 });
        return;
      }
      synthTone(587.33, 0, 0.22, { gain: 0.055 });
      synthTone(880, 0.24, 0.28, { gain: 0.05 });
      return;
    }
    if (profile === 'chime') {
      if (kind === 'sent') {
        synthTone(784, 0, 0.055, { endFreq: 1046.5, gain: 0.036 });
      } else if (kind === 'incoming') {
        synthTone(659.25, 0, 0.075, { gain: 0.048 });
        synthTone(987.77, 0.075, 0.09, { gain: 0.046 });
        synthTone(1318.5, 0.16, 0.14, { gain: 0.04 });
      } else if (kind === 'burn') {
        synthTone(440, 0, 0.1, { type: 'triangle', endFreq: 220, gain: 0.04 });
      }
      return;
    }
    if (profile === 'soft') {
      if (kind === 'sent') synthTone(380, 0, 0.045, { endFreq: 430, gain: 0.025 });
      else if (kind === 'incoming') synthTone(460, 0, 0.075, { endFreq: 540, gain: 0.032 });
      else if (kind === 'burn') synthTone(280, 0, 0.09, { type: 'triangle', endFreq: 160, gain: 0.03 });
      return;
    }
    if (profile === 'sonar') {
      if (kind === 'sent') synthTone(740, 0, 0.06, { endFreq: 880, gain: 0.038 });
      else if (kind === 'incoming') {
        synthTone(880, 0, 0.09, { gain: 0.048 });
        synthTone(880, 0.12, 0.14, { gain: 0.035 });
      } else if (kind === 'burn') synthTone(420, 0, 0.12, { type: 'triangle', endFreq: 190, gain: 0.045 });
      return;
    }
    if (profile === 'pulse') {
      if (kind === 'sent') synthTone(480, 0, 0.05, { type: 'triangle', endFreq: 720, gain: 0.04 });
      else if (kind === 'incoming') {
        synthTone(520, 0, 0.06, { type: 'triangle', gain: 0.05 });
        synthTone(780, 0.065, 0.09, { type: 'triangle', gain: 0.048 });
      } else if (kind === 'burn') synthTone(330, 0, 0.11, { type: 'sawtooth', endFreq: 150, gain: 0.035 });
      return;
    }
    // По умолчанию: профиль «crystal»
    if (kind === 'sent') {
      synthTone(520, 0, 0.055, { endFreq: 680, gain: 0.04 });
    } else if (kind === 'incoming') {
      synthTone(640, 0, 0.075, { gain: 0.055 });
      synthTone(860, 0.075, 0.11, { gain: 0.05 });
    } else if (kind === 'burn') {
      synthTone(360, 0, 0.11, { type: 'triangle', endFreq: 180, gain: 0.05 });
    }
  } catch { /* аудио недоступно до первого действия пользователя */ }
}

// ─────────────────────── Форматирование времени и объёма данных ───────────────────────

export function formatTime(ts, mode = '24h') {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  if (mode === '12h') {
    const suffix = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 || 12;
    return `${h12}:${mm} ${suffix}`;
  }
  if (mode === '24h_sec') {
    return `${String(hh).padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${String(hh).padStart(2, '0')}:${mm}`;
}

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function formatDatePill(ts) {
  const d = new Date(ts);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function formatBytes(bytes, unitMode = 'si') {
  if (!bytes) return '0 Б';
  const base = unitMode === 'iec' ? 1024 : 1000;
  const kLabel = unitMode === 'iec' ? 'КиБ' : 'КБ';
  const mLabel = unitMode === 'iec' ? 'МиБ' : 'МБ';
  if (bytes < base) return `${bytes} Б`;
  if (bytes < base * base) return `${(bytes / base).toFixed(1)} ${kLabel}`;
  return `${(bytes / (base * base)).toFixed(1)} ${mLabel}`;
}

export const TTL_CHOICES = [
  [0, 'Выкл'],
  [30, '30 сек'],
  [300, '5 мин'],
  [3600, '1 ч'],
  [86400, '24 ч'],
  [604800, '7 сут'],
];

export function ttlText(sec) {
  const found = TTL_CHOICES.find(([v]) => v === Number(sec));
  return found ? found[1] : `${sec} с`;
}

// ─────────────────────── Сжатие пользовательского фото аватара в браузере ───────────────────────

export function compressAvatarImageFile(file, maxSide = 176, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Выберите графический файл (JPEG, PNG или WebP)'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Повреждённый формат изображения'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSide;
        canvas.height = maxSide;
        const ctx = canvas.getContext('2d');
        const minDim = Math.min(img.width, img.height);
        const sx = Math.floor((img.width - minDim) / 2);
        const sy = Math.floor((img.height - minDim) / 2);
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, maxSide, maxSide);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

// ─────────────────────── Безопасный рендер текста, кода и скрытых блоков (0 XSS) ───────────────────────

export function RichMessageText({ text }) {
  const [revealed, setRevealed] = useState({});
  if (!text) return null;

  const tokens = [];
  const regex = /(```[\s\S]*?```|`[^`\n]+`|\|\|[^|\n]+\|\|\|?|\*\*[^*\n]+\*\*)/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({ kind: 'plain', val: text.slice(lastIdx, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith('```')) {
      tokens.push({ kind: 'codeblock', val: raw.slice(3, -3).replace(/^\w*\n/, '') });
    } else if (raw.startsWith('`')) {
      tokens.push({ kind: 'inlinecode', val: raw.slice(1, -1) });
    } else if (raw.startsWith('||')) {
      tokens.push({ kind: 'spoiler', val: raw.replace(/^\|\||\|\|$/g, '') });
    } else if (raw.startsWith('**')) {
      tokens.push({ kind: 'bold', val: raw.slice(2, -2) });
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    tokens.push({ kind: 'plain', val: text.slice(lastIdx) });
  }

  return html`<span class="msg-rich">
    ${tokens.map((tok, idx) => {
      if (tok.kind === 'codeblock') {
        return html`<pre key=${idx} class="msg-pre"><code>${tok.val}</code></pre>`;
      }
      if (tok.kind === 'inlinecode') {
        return html`<code key=${idx} class="msg-code">${tok.val}</code>`;
      }
      if (tok.kind === 'bold') {
        return html`<strong key=${idx}>${tok.val}</strong>`;
      }
      if (tok.kind === 'spoiler') {
        const isOpen = Boolean(revealed[idx]);
        return html`<span
          key=${idx}
          class=${isOpen ? 'msg-spoiler open' : 'msg-spoiler'}
          title="Скрытый фрагмент — нажмите для чтения"
          onClick=${(e) => {
            e.stopPropagation();
            setRevealed((r) => ({ ...r, [idx]: !r[idx] }));
          }}
        >${tok.val}</span>`;
      }
      return html`<span key=${idx}>${tok.val}</span>`;
    })}
  </span>`;
}

// ─────────────────────── Строгие геометрические SVG-иконки ───────────────────────

const ICON_PATHS = {
  lock: html`<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`,
  shield: html`<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>`,
  phone: html`<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>`,
  info: html`<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`,
  dots: html`<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>`,
  plus: html`<path d="M12 5v14M5 12h14"/>`,
  clip: html`<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>`,
  send: html`<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>`,
  search: html`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`,
  close: html`<path d="M18 6 6 18M6 6l12 12"/>`,
  back: html`<path d="m15 18-6-6 6-6"/>`,
  bell: html`<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>`,
  clock: html`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  globe: html`<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
  eyeOff: html`<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="2" y1="2" x2="22" y2="22"/>`,
  once: html`<rect x="3" y="3" width="18" height="18" rx="4" stroke-dasharray="3 2.5"/><path d="M10.5 9.5 12.5 8v8"/><path d="M10 16h5"/>`,
  inbox: html`<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`,
  reply: html`<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>`,
  copy: html`<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
  check: html`<polyline points="20 6 9 17 4 12"/>`,
  server: html`<rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><line x1="6" y1="6.5" x2="6.01" y2="6.5"/><line x1="6" y1="17.5" x2="6.01" y2="17.5"/>`,
  wifi: html`<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/>`,
  settings: html`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  chat: html`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  users: html`<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  user: html`<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  radar: html`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 12 18.3 5.7"/>`,
  camera: html`<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>`,
  palette: html`<circle cx="13.5" cy="6.5" r=".8" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".8" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".8" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".8" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.43-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h1.99c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>`,
  pin: html`<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>`,
  star: html`<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
  bolt: html`<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  diamond: html`<path d="M6 3h12l4 6-10 12L2 9Z"/>`,
  qr: html`<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 19h2M19 14v2"/>`,
  activity: html`<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
  edit: html`<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
  refresh: html`<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>`,
  download: html`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
  upload: html`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
  key: html`<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>`,
  sliders: html`<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>`,
  volume: html`<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>`,
  database: html`<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>`,
  trash: html`<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  terminal: html`<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`,
  mic: html`<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>`,
  micOff: html`<line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" y1="19" x2="12" y2="22"/>`,
  phoneOff: html`<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="22" y1="2" x2="2" y2="22"/>`,
  play: html`<polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/>`,
  pause: html`<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>`,
  snowflake: html`<line x1="12" y1="2" x2="12" y2="22"/><line x1="3.34" y1="7" x2="20.66" y2="17"/><line x1="20.66" y1="7" x2="3.34" y2="17"/><polyline points="9.5 4.5 12 7 14.5 4.5"/><polyline points="9.5 19.5 12 17 14.5 19.5"/><polyline points="4.5 10.2 7.5 9.4 6.7 6.4"/><polyline points="17.3 17.6 16.5 14.6 19.5 13.8"/><polyline points="19.5 10.2 16.5 9.4 17.3 6.4"/><polyline points="6.7 17.6 7.5 14.6 4.5 13.8"/>`,
  sparkle: html`<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="m19 16 .9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z"/>`,
  tree: html`<polygon points="12 2 6.5 9.5 10 9.5 5 15.5 9.2 15.5 4 20.5 20 20.5 14.8 15.5 19 15.5 14 9.5 17.5 9.5 12 2"/><line x1="12" y1="20.5" x2="12" y2="23"/>`,
  smile: html`<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2"/><circle cx="9" cy="9.5" r="1" fill="currentColor"/><circle cx="15" cy="9.5" r="1" fill="currentColor"/><path d="M16 3v4a2 2 0 0 0 2 2h3"/>`,
  pie: html`<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>`,
  folder: html`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`,
  laptop: html`<rect x="3" y="4" width="18" height="12" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/>`,
  battery: html`<rect x="2" y="7" width="16" height="10" rx="2"/><line x1="22" y1="11" x2="22" y2="13" stroke-width="2.4"/><rect x="5" y="10" width="7" height="4" rx="0.8" fill="currentColor"/>`,
  moreVert: html`<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>`,
  chevronRight: html`<path d="m9 18 6-6-6-6"/>`,
  mesh: html`<path d="M12 3 4 7v6c0 5 3.4 8.8 8 10 4.6-1.2 8-5 8-10V7l-8-4Z"/><circle cx="12" cy="8.5" r="1.4" fill="currentColor"/><circle cx="8.5" cy="11" r="1.3" fill="currentColor"/><circle cx="15.5" cy="11" r="1.3" fill="currentColor"/><circle cx="9.6" cy="15.2" r="1.3" fill="currentColor"/><circle cx="14.4" cy="15.2" r="1.3" fill="currentColor"/><path d="M8.5 11 12 8.5 15.5 11 14.4 15.2H9.6L8.5 11Z" stroke-width="1.3"/>`,
};

export function Icon({ name, size = 18 }) {
  return html`<svg
    width=${size}
    height=${size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.85"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >${ICON_PATHS[name] || ICON_PATHS.info}</svg>`;
}

/** Векторный QR-код стандарта ISO/IEC 18004 без внешних библиотек и сетевых обращений */
export function QrCodeBox({ value, size = 184 }) {
  if (!value) return null;
  let qr = null;
  try {
    qr = buildQrSvgModel(value, 3);
  } catch {
    return null;
  }
  return html`<div class="qr-svg-frame" style=${`width:${size}px;height:${size}px`}>
    <svg
      width=${size}
      height=${size}
      viewBox=${qr.viewBox}
      shape-rendering="crispEdges"
      role="img"
      aria-label="QR-код"
    >
      <rect width="100%" height="100%" fill="#ffffff" rx="2" />
      <path d=${qr.pathD} fill="#090b12" />
    </svg>
  </div>`;
}

/** Значок статуса профиля рядом с именем */
export function ProfileBadgeIcon({ badge, size = 14 }) {
  if (!badge || badge === 'none') return null;
  const map = {
    verified: { icon: 'shield', cls: 'badge-verified', title: 'Подтверждённый E2EE профиль' },
    snowflake: { icon: 'snowflake', cls: 'badge-snowflake', title: 'Зимний кристалл' },
    tree: { icon: 'tree', cls: 'badge-tree', title: 'Новогодняя коллекция' },
    sparkle: { icon: 'sparkle', cls: 'badge-sparkle', title: 'Полярное сияние' },
    star: { icon: 'star', cls: 'badge-star', title: 'Избранный статус' },
    bolt: { icon: 'bolt', cls: 'badge-bolt', title: 'Активный узел Mesh' },
    shield: { icon: 'lock', cls: 'badge-shield', title: 'Защищённый контур' },
    diamond: { icon: 'diamond', cls: 'badge-diamond', title: 'Кастомный профиль' },
  };
  const item = map[badge] || map.verified;
  return html`<span class=${`profile-badge-chip ${item.cls}`} title=${item.title}>
    <${Icon} name=${item.icon} size=${size} />
  </span>`;
}

/** Универсальный квадратный/сквиркл/круглый аватар без геометрических искажений */
export function AvatarBox({
  title = '',
  username = '',
  color = '#3B4CCA',
  avatarDataUrl = '',
  kind = 'dm',
  size = 46,
  online = false,
  className = '',
  onClick = null,
}) {
  const raw = (title || username || '?').replace(/^@/, '').trim();
  const initials = kind === 'echo'
    ? 'ЭЕ'
    : raw.split(/\s+/).length >= 2
      ? (raw.split(/\s+/)[0][0] + raw.split(/\s+/)[1][0]).toUpperCase()
      : raw.slice(0, 2).toUpperCase();

  return html`<div
    class=${`avatar-box ${className}`}
    style=${`width:${size}px;height:${size}px;min-width:${size}px;min-height:${size}px;background:${avatarDataUrl ? '#0e111b' : color}`}
    onClick=${onClick}
  >
    ${avatarDataUrl
      ? html`<img src=${avatarDataUrl} alt="" class="avatar-img" loading="lazy" />`
      : kind === 'ask'
        ? html`<${Icon} name="inbox" size=${Math.round(size * 0.44)} />`
        : html`<span class="avatar-initials" style=${`font-size:${Math.max(11, Math.round(size * 0.34))}px`}>${initials}</span>`}
    ${online && html`<span class="avatar-online-dot"></span>`}
  </div>`;
}

// ─────────────────────── Декоративные частицы баннера профиля ───────────────────────

const PARTICLE_DOTS = Array.from({ length: 22 }, (_, i) => ({
  left: `${(i * 37 + 11) % 94 + 3}%`,
  top: `${(i * 53 + 7) % 86 + 6}%`,
  size: (i % 3) + 2,
  delay: `${(i * 0.45).toFixed(2)}s`,
  dur: `${(3.6 + (i % 5) * 0.85).toFixed(2)}s`,
}));

export function AmbientParticles({ effect = 'stars' }) {
  if (!effect || effect === 'none') return null;
  return html`<div class=${`ambient-particles effect-${effect}`} aria-hidden="true">
    ${PARTICLE_DOTS.map((d, idx) => html`<span
      key=${idx}
      class="particle-dot"
      style=${`left:${d.left};top:${d.top};width:${d.size}px;height:${d.size}px;animation-delay:${d.delay};animation-duration:${d.dur}`}
    ></span>`)}
  </div>`;
}

// ─────────────────────── Экран экстренной блокировки (Esc × 2) ───────────────────────

const SAMPLE_ROWS = [
  ['Подразделение Север', '14 820,00', '15 100,00', '+1,89%', 'Согласовано'],
  ['Логистика и склады', '6 410,50', '6 290,00', '-1,88%', 'В проверке'],
  ['ИТ-инфраструктура', '3 190,00', '3 190,00', '0,00%', 'Закрыто'],
  ['Резервный фонд Q4', '9 750,00', '10 200,00', '+4,62%', 'Согласовано'],
  ['Операционные расходы', '4 115,20', '3 980,00', '-3,29%', 'Утверждено'],
  ['ИТОГО ПО КОНТУРУ', '38 285,70', '38 760,00', '+1,24%', 'Свод сдан'],
];

export function BossScreen({ title, template = 'xlsx', onExit }) {
  const [selectedCell, setSelectedCell] = useState('C4');
  const [lastTapAt, setLastTapAt] = useState(0);

  const onTouchUnlock = () => {
    const now = Date.now();
    if (now - lastTapAt < 420) {
      onExit?.();
      return;
    }
    setLastTapAt(now);
  };

  if (template === 'terminal') {
    return html`<div class="boss-overlay boss-dark-term" onDblClick=${onExit} onTouchEnd=${onTouchUnlock}>
      <div class="boss-topbar" style="background:#161b22;border-bottom:1px solid #30363d">
        <span class="boss-badge">SSH</span>
        <strong class="boss-doc-title">${title || 'build-worker-eu-04: ~/ci/pipeline'}</strong>
        <button type="button" class="boss-unlock-btn" onClick=${onExit}>Вернуться</button>
      </div>
      <pre class="boss-term-body">[19:04:11] INFO  scheduler: проверка очереди задач сборки #4812
[19:04:12] INFO  runner-04: компиляция модулей ядра (target=linux-arm64)
[19:04:14] OK    unit-suite: 142/142 проверок пройдено за 1.84 с
[19:04:15] INFO  artifact: контрольная сумма архива подтверждена
[19:04:16] IDLE  ожидание следующего задания планировщика…</pre>
    </div>`;
  }

  if (template === 'notes') {
    return html`<div class="boss-overlay" onDblClick=${onExit} onTouchEnd=${onTouchUnlock}>
      <div class="boss-topbar" style="background:#334155">
        <span class="boss-badge">DOC</span>
        <strong class="boss-doc-title">${title || 'Регламент_обслуживания_узлов_Q4.md'}</strong>
        <button type="button" class="boss-unlock-btn" onClick=${onExit}>Вернуться</button>
      </div>
      <div class="boss-notes-body">
        <h3>План плановых работ по инфраструктуре</h3>
        <ul>
          <li>Проверка резервных каналов связи и балансировщиков нагрузки — выполнено.</li>
          <li>Ротация TLS-сертификатов внешних шлюзов — по расписанию (пятница, 02:00 UTC).</li>
          <li>Контроль свободного места на томах хранения логов и метрик — в норме (78% свободно).</li>
          <li>Сверка контрольных сумм сборок релизного контура — без замечаний.</li>
        </ul>
      </div>
    </div>`;
  }

  return html`<div class="boss-overlay" onDblClick=${onExit} onTouchEnd=${onTouchUnlock}>
    <div class="boss-topbar">
      <span class="boss-badge">XLSX</span>
      <strong class="boss-doc-title">${title || 'Финансовая_модель_Q4_консолидация.xlsx'}</strong>
      <button type="button" class="boss-unlock-btn" onClick=${onExit}>Вернуться</button>
    </div>
    <div class="boss-formula">
      <span class="boss-cell-id">${selectedCell}</span>
      <span class="boss-fx">fx</span>
      <span>=СУММ(C2:C6)*КОЭФ_ИНДЕКСАЦИИ_Q4</span>
    </div>
    <div class="boss-table-wrap">
      <table class="boss-table">
        <thead>
          <tr>
            <th>#</th>
            <th>A · Статья бюджета</th>
            <th>B · План (тыс.)</th>
            <th>C · Факт (тыс.)</th>
            <th>D · Отклонение</th>
            <th>E · Статус</th>
          </tr>
        </thead>
        <tbody>
          ${SAMPLE_ROWS.map((row, rIdx) => html`<tr key=${rIdx}>
            <td class="boss-rownum">${rIdx + 2}</td>
            ${row.map((val, cIdx) => {
              const addr = `${String.fromCharCode(65 + cIdx)}${rIdx + 2}`;
              return html`<td
                key=${cIdx}
                class=${selectedCell === addr ? 'boss-selected' : ''}
                onClick=${() => setSelectedCell(addr)}
              >${val}</td>`;
            })}
          </tr>`)}
        </tbody>
      </table>
    </div>
  </div>`;
}
