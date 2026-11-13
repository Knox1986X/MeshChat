// Базовые утилиты интерфейса: векторные иконки (0 сетевых запросов),
// синтезатор сдержанных системных сигналов WebAudio, рендер скрытого текста (||...||)
// и экран экстренной маскировки рабочего окна (двойной Esc).

import { html, useState } from '../../vendor/preact.mjs';

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

export function playSfx(kind) {
  try {
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

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function formatDatePill(ts) {
  const d = new Date(ts);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 Б';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1048576).toFixed(1)} МБ`;
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
  edit: html`<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
  refresh: html`<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>`,
  download: html`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
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

// ─────────────────────── Экран экстренной блокировки (Esc × 2) ───────────────────────

const SAMPLE_ROWS = [
  ['Подразделение Север', '14 820,00', '15 100,00', '+1,89%', 'Согласовано'],
  ['Логистика и склады', '6 410,50', '6 290,00', '-1,88%', 'В проверке'],
  ['ИТ-инфраструктура', '3 190,00', '3 190,00', '0,00%', 'Закрыто'],
  ['Резервный фонд Q4', '9 750,00', '10 200,00', '+4,62%', 'Согласовано'],
  ['Операционные расходы', '4 115,20', '3 980,00', '-3,29%', 'Утверждено'],
  ['ИТОГО ПО КОНТУРУ', '38 285,70', '38 760,00', '+1,24%', 'Свод сдан'],
];

export function BossScreen({ title, onExit }) {
  const [selectedCell, setSelectedCell] = useState('C4');
  return html`<div class="boss-overlay" onDblClick=${onExit}>
    <div class="boss-topbar">
      <span class="boss-badge">XLSX</span>
      <strong>${title || 'Финансовая_модель_Q4_консолидация.xlsx'}</strong>
      <span class="boss-hint">Только чтение · Двойной клик или Esc×2 для разблокировки</span>
    </div>
    <div class="boss-formula">
      <span class="boss-cell-id">${selectedCell}</span>
      <span class="boss-fx">fx</span>
      <span>=СУММ(C2:C6)*КОЭФ_ИНДЕКСАЦИИ_Q4</span>
    </div>
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
  </div>`;
}
