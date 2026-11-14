// Многораздельный центр «Настройки» MeshChat v1.9:
//   - Главный хаб из 11 отдельных карточек-категорий с пастельными иконками, верхней панелью
//     (QR-визитка · Настройки · Поиск · Меню ⋮) и мгновенным глобальным поиском.
//   - Полноэкранный переход внутрь выбранного раздела на мобильных устройствах (с поддержкой
//     системной кнопки «Назад» Android) и двухпанельный режим Master-Detail на широких экранах ПК.
//   - Экран локальной PIN-блокировки PinLockOverlay и студия тем ThemeStudioCard.

import { html, useState, useRef, useEffect } from '../../vendor/preact.mjs';
import {
  store,
  notifyStore,
  APP_VERSION,
  APP_VERSION_CODE,
  DEFAULT_CLOUD_URL,
  THEME_PRESETS,
  BUBBLE_GRADIENTS,
  HOLIDAY_MOOD_PACKS,
  uiText,
  openSettingsSection,
  closeSettingsSection,
  updateThemeSettings,
  applyHolidayMoodPack,
  resetThemeSettings,
  updateClientSettings,
  toggleScreenshotProtection,
  toggleKeepScreenOn,
  toggleAndroidLanMesh,
  rotateBlindMailbox,
  checkForUpdates,
  logoutAndWipeDevice,
  setAppPin,
  disableAppPin,
  unlockWithPin,
  lockAppNow,
  toggleBossMode,
  exportEncryptedBackup,
  importEncryptedBackup,
  clearDecryptedMediaCache,
  clearAllMessagesHistory,
  resetAllSettingsToDefaults,
  getStorageStats,
  sendMeshTestPacket,
  requestSystemNotificationAccess,
  sendTestShadeNotification,
  toggleAndroidBackgroundService,
  triggerHaptic,
  showToast,
} from '../store/app-store.mjs';
import { TRANSPORT_POLICY } from '../transport/transport-interface.mjs';
import { Icon, playSfx, formatBytes, formatTime } from './boss-screen.mjs';
import {
  SETTINGS_SECTIONS_META,
  SETTINGS_SEARCH_INDEX,
  getSectionTitle,
  AccountSectionView,
  ReactionsSectionView,
  FoldersSectionView,
  PowerSavingSectionView,
  LanguageSectionView,
  UpdatesDiagnosticsSectionView,
} from './settings-sections.mjs';

const POLICY_LIST = [
  [TRANSPORT_POLICY.AUTO, 'Автоматический мультитранспорт', 'WSS -> P2P WebRTC -> Tor -> I2P'],
  [TRANSPORT_POLICY.TOR_ONLY, 'Только Tor (.onion) · Fail-Closed', 'Строгая блокировка прямых соединений'],
  [TRANSPORT_POLICY.I2P_ONLY, 'Только I2P (.b32.i2p) · Fail-Closed', 'Изолированный garlic-туннель I2P'],
  [TRANSPORT_POLICY.P2P_FIRST, 'Приоритет P2P WebRTC', 'Прямые каналы DTLS-SRTP между пирами'],
  [TRANSPORT_POLICY.DIRECT_ONLY, 'Прямой WSS ретранслятор', 'Минимальная задержка доставки'],
];

// ─────────────────────── Экран PIN-блокировки приложения ───────────────────────

export function PinLockOverlay() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const tryUnlock = async (candidate) => {
    const ok = await unlockWithPin(candidate);
    if (!ok) {
      setError('Неверный PIN-код');
      setPin('');
    } else {
      setError('');
      setPin('');
    }
  };

  const appendDigit = (d) => {
    if (pin.length >= 8) return;
    const next = pin + d;
    setPin(next);
    setError('');
    triggerHaptic('tap');
  };

  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        appendDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setPin((p) => p.slice(0, -1));
      } else if (e.key === 'Enter' && pin.length >= 4) {
        e.preventDefault();
        tryUnlock(pin);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pin]);

  return html`<div class="pin-lock-backdrop" role="dialog" aria-label="Разблокировка MeshChat">
    <div class="pin-lock-card">
      <div class="pin-lock-icon"><${Icon} name="lock" size=${26} /></div>
      <h2>MeshChat заблокирован</h2>
      <p>Введите локальный PIN-код (4–8 цифр) для доступа к зашифрованным диалогам</p>

      <div class=${`pin-dots-row ${error ? 'shake' : ''}`}>
        ${Array.from({ length: Math.max(4, pin.length) }).map((_, idx) => html`<span
          key=${idx}
          class=${`pin-dot ${idx < pin.length ? 'filled' : ''}`}
        ></span>`)}
      </div>

      ${error && html`<div class="pin-error-msg">${error}</div>`}

      <div class="pin-keypad">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => html`<button
          key=${d}
          type="button"
          class="pin-key-btn"
          onClick=${() => appendDigit(d)}
        >${d}</button>`)}
        <button
          type="button"
          class="pin-key-btn subtle"
          title="Экран маскировки"
          onClick=${() => toggleBossMode(true)}
        ><${Icon} name="eyeOff" size=${18} /></button>
        <button type="button" class="pin-key-btn" onClick=${() => appendDigit('0')}>0</button>
        <button
          type="button"
          class="pin-key-btn subtle"
          title="Стереть"
          onClick=${() => setPin((p) => p.slice(0, -1))}
        >⌫</button>
      </div>

      <button
        type="button"
        class="btn-primary pin-submit-btn"
        disabled=${pin.length < 4}
        onClick=${() => tryUnlock(pin)}
      >Разблокировать</button>
    </div>
  </div>`;
}

// ─────────────────────── Студия кастомных тем, градиентов, снежинок и шрифта ───────────────────────

export function ThemeStudioCard({ onClose = null }) {
  const { theme, settings } = store;

  return html`<div class="studio-card">
    <div class="studio-card-head">
      <h3><${Icon} name="palette" size=${16} /> Темы, градиенты, снежинки и типографика</h3>
      <div class="studio-head-btns">
        <button type="button" class="btn-ghost compact" onClick=${resetThemeSettings}>
          Сбросить тему
        </button>
        ${onClose && html`<button type="button" class="icon-btn small" onClick=${onClose}>
          <${Icon} name="close" size=${15} />
        </button>`}
      </div>
    </div>

    <div class="theme-live-preview">
      <div class="preview-bubble-in">
        <span class="preview-meta">Собеседник · ${formatTime(Date.now() - 120000, settings.timeFormat)}</span>
        <div>Канал X3DH + Double Ratchet активен. Плотность и шрифт применяются мгновенно.</div>
      </div>
      <div class="preview-bubble-out">
        <span class="preview-meta">Вы · ${formatTime(Date.now(), settings.timeFormat)} · Доставлено</span>
        <div>Принято. Выравнивание конверта ${settings.paddingBlockBytes || 512} байт.</div>
      </div>
    </div>

    <label class="field-label">Новогодние и зимние сцены в 1 нажатие</label>
    <div class="mood-packs-grid">
      ${HOLIDAY_MOOD_PACKS.map((pack) => html`<button
        key=${pack.id}
        type="button"
        class=${`mood-pack-tile ${theme.preset === pack.patch.preset && theme.ambientEffect === pack.patch.ambientEffect ? 'active' : ''}`}
        onClick=${() => applyHolidayMoodPack(pack.id)}
      >
        <b>${pack.title}</b>
        <span>${pack.sub}</span>
      </button>`)}
    </div>

    <label class="field-label">Цветовые и градиентные темы (${Object.keys(THEME_PRESETS).length} палитр)</label>
    <div class="theme-presets-grid">
      ${Object.values(THEME_PRESETS).map((p) => html`<button
        key=${p.id}
        type="button"
        class=${`theme-preset-tile ${theme.preset === p.id ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ preset: p.id, customAccent: p.accent, customBg0: p.bg0 })}
      >
        <span class="preset-preview" style=${`background:${p.appGradient || p.bg0};border-color:${p.accent}`}>
          <i style=${`background:${p.accentGradient || p.accent}`}></i>
        </span>
        <span>${p.label}</span>
      </button>`)}
    </div>

    <label class="field-label">Снежинки, полярное сияние и новогодняя гирлянда</label>
    <div class="chip-grid">
      ${[
        ['aurora_snow', 'Сияние + Снег'],
        ['snowfall', 'Кристальный снег'],
        ['blizzard', 'Зимняя метель'],
        ['champagne_sparks', 'Золотые искры'],
        ['stardust', 'Звёздная ночь'],
        ['none', 'Без частиц'],
      ].map(([id, lbl]) => html`<button
        key=${id}
        type="button"
        class=${`choice-chip ${(theme.ambientEffect || 'aurora_snow') === id ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ ambientEffect: id })}
      >${lbl}</button>`)}
    </div>

    ${theme.ambientEffect !== 'none' && html`<div class="chip-grid">
      ${[
        ['light', 'Лёгкий снег'],
        ['medium', 'Средний снег'],
        ['rich', 'Пышный снегопад'],
      ].map(([id, lbl]) => html`<button
        key=${id}
        type="button"
        class=${`choice-chip ${(theme.snowDensity || 'medium') === id ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ snowDensity: id })}
      >${lbl}</button>`)}
    </div>`}

    <div class="chip-grid">
      <button
        type="button"
        class=${`choice-chip ${!theme.garlandEnabled ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ garlandEnabled: false })}
      >Гирлянда: Выкл</button>
      ${[
        ['classic', 'Гирлянда: Классика'],
        ['warm_gold', 'Гирлянда: Золото'],
        ['arctic_ice', 'Гирлянда: Арктика'],
        ['cyber_berry', 'Гирлянда: Неон'],
      ].map(([id, lbl]) => html`<button
        key=${id}
        type="button"
        class=${`choice-chip ${theme.garlandEnabled && (theme.garlandStyle || 'classic') === id ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ garlandEnabled: true, garlandStyle: id })}
      >${lbl}</button>`)}
    </div>

    <label class="field-label">Градиент пузырей исходящих сообщений</label>
    <div class="chip-grid">
      ${Object.values(BUBBLE_GRADIENTS).map((bg) => html`<button
        key=${bg.id}
        type="button"
        class=${`choice-chip ${(theme.bubbleGradient || 'aurora') === bg.id ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ bubbleGradient: bg.id, customBubble: '' })}
      >
        ${bg.css && bg.css !== 'solid' && html`<i class="mini-grad-dot" style=${`background:${bg.css}`}></i>`}
        <span>${bg.label}</span>
      </button>`)}
    </div>

    <div class="custom-color-row three-cols">
      <div class="color-field-box">
        <span class="field-label">Цвет акцента</span>
        <label class="hex-color-control">
          <input
            type="color"
            value=${theme.customAccent || '#6d7cff'}
            onInput=${(e) => updateThemeSettings({ preset: 'custom', customAccent: e.target.value })}
          />
          <code>${(theme.customAccent || '#6d7cff').toUpperCase()}</code>
        </label>
      </div>

      <div class="color-field-box">
        <span class="field-label">Фон приложения</span>
        <label class="hex-color-control">
          <input
            type="color"
            value=${theme.customBg0 || '#0b0d14'}
            onInput=${(e) => updateThemeSettings({ preset: 'custom', customBg0: e.target.value })}
          />
          <code>${(theme.customBg0 || '#0b0d14').toUpperCase()}</code>
        </label>
      </div>

      <div class="color-field-box">
        <span class="field-label">Мои сообщения</span>
        <label class="hex-color-control">
          <input
            type="color"
            value=${theme.customBubble || '#263159'}
            onInput=${(e) => updateThemeSettings({ customBubble: e.target.value })}
          />
          <button
            type="button"
            class="link-btn"
            onClick=${() => updateThemeSettings({ customBubble: '' })}
          >Авто</button>
        </label>
      </div>
    </div>

    <label class="field-label">Размер текста сообщений (${theme.fontScale || 14} px)</label>
    <div class="chip-grid">
      ${[12, 13, 14, 15, 16, 18].map((sz) => html`<button
        key=${sz}
        type="button"
        class=${`choice-chip ${Number(theme.fontScale || 14) === sz ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ fontScale: sz })}
      >${sz} px</button>`)}
    </div>

    <label class="field-label">Гарнитура шрифта и плотность интерфейса</label>
    <div class="chip-grid">
      ${[
        ['system', 'Системный UI'],
        ['inter', 'Геометрический'],
        ['mono', 'Моноширинный код'],
      ].map(([id, lbl]) => html`<button
        key=${id}
        type="button"
        class=${`choice-chip ${(theme.fontFamily || 'system') === id ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ fontFamily: id })}
      >${lbl}</button>`)}
      ${[
        ['compact', 'Компактно'],
        ['normal', 'Стандарт'],
        ['spacious', 'Просторно'],
      ].map(([id, lbl]) => html`<button
        key=${id}
        type="button"
        class=${`choice-chip ${(theme.density || 'normal') === id ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ density: id })}
      >${lbl}</button>`)}
    </div>

    <label class="field-label">Форма аватаров и скругление пузырей</label>
    <div class="chip-grid">
      ${[
        ['squircle', 'Сквиркл (28%)'],
        ['rounded', 'Квадрат (18%)'],
        ['circle', 'Круг (50%)'],
      ].map(([id, lbl]) => html`<button
        key=${id}
        type="button"
        class=${`choice-chip ${theme.avatarShape === id ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ avatarShape: id })}
      >${lbl}</button>`)}
      ${[
        [6, 'Острое 6px'],
        [12, 'Умеренное 12px'],
        [16, 'Стандарт 16px'],
        [22, 'Мягкое 22px'],
      ].map(([r, lbl]) => html`<button
        key=${r}
        type="button"
        class=${`choice-chip ${Number(theme.bubbleRadius) === r ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ bubbleRadius: r })}
      >${lbl}</button>`)}
    </div>

    <label class="field-label">Узор и атмосфера фона ленты диалогов</label>
    <div class="chip-grid">
      ${[
        ['snowflakes', 'Узор снежинок'],
        ['aurora_mesh', 'Полярное сияние'],
        ['frost_prism', 'Морозные грани'],
        ['festive_gold', 'Праздничные огни'],
        ['dots', 'Точечная матрица'],
        ['grid', 'Инженерная сетка'],
        ['diag', 'Диагональ'],
        ['stars', 'Созвездия'],
        ['none', 'Чистый OLED'],
      ].map(([bg, lbl]) => html`<button
        key=${bg}
        type="button"
        class=${`choice-chip ${theme.chatBackdrop === bg ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ chatBackdrop: bg })}
      >${lbl}</button>`)}
    </div>

    <div class="settings-rows-list" style="margin-top:6px">
      <div class="settings-switch-row" onClick=${() => updateThemeSettings({ frostGlass: theme.frostGlass === false })}>
        <div class="plugin-copy">
          <div class="plugin-title">Эффект морозного стекла (Glassmorphism)</div>
          <div class="plugin-sub">Полупрозрачные карточки и заголовки с мягким ледяным бликом по контуру</div>
        </div>
        <button type="button" class=${`ios-switch ${theme.frostGlass !== false ? 'on' : ''}`}><span></span></button>
      </div>

      <div class="settings-switch-row" onClick=${() => updateThemeSettings({ snowCaps: !theme.snowCaps })}>
        <div class="plugin-copy">
          <div class="plugin-title">Снежные шапки на элементах интерфейса</div>
          <div class="plugin-sub">Деликатная снежная кромка поверх пузырей сообщений, модальных окон и кнопок</div>
        </div>
        <button type="button" class=${`ios-switch ${theme.snowCaps ? 'on' : ''}`}><span></span></button>
      </div>

      <div class="settings-switch-row" onClick=${() => updateThemeSettings({ messageTail: theme.messageTail === false })}>
        <div class="plugin-copy">
          <div class="plugin-title">Хвостики у пузырей сообщений</div>
          <div class="plugin-sub">Классический скошенный уголок у входящих и исходящих реплик</div>
        </div>
        <button type="button" class=${`ios-switch ${theme.messageTail !== false ? 'on' : ''}`}><span></span></button>
      </div>

      <div class="settings-switch-row" onClick=${() => updateThemeSettings({ animations: theme.animations === false })}>
        <div class="plugin-copy">
          <div class="plugin-title">Плавные анимации интерфейса</div>
          <div class="plugin-sub">Отключите для мгновенной отрисовки и экономии заряда батареи</div>
        </div>
        <button type="button" class=${`ios-switch ${theme.animations !== false ? 'on' : ''}`}><span></span></button>
      </div>
    </div>
  </div>`;
}

// ─────────────────────── 2. Подраздел «Настройки чатов» ───────────────────────

function ChatsSectionView() {
  const { settings } = store;

  return html`<div class="settings-sub-stack">
    <${ThemeStudioCard} />

    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="chat" size=${16} /> Поведение диалогов, клавиатуры и аудио</h3>
      </div>

      <div class="settings-rows-list">
        <div class="settings-switch-row" onClick=${() => updateClientSettings({ enterToSend: settings.enterToSend === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Отправка клавишей Enter</div>
            <div class="plugin-sub">
              ${settings.enterToSend !== false
                ? 'Enter отправляет сообщение, Shift+Enter переносит строку'
                : 'Enter переносит строку, Ctrl+Enter отправляет сообщение'}
            </div>
          </div>
          <button type="button" class=${`ios-switch ${settings.enterToSend !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ autoSaveDrafts: settings.autoSaveDrafts === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Автосохранение черновиков по каждому чату</div>
            <div class="plugin-sub">Сохраняет недописанный текст локально в зашифрованном хранилище при смене чата</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.autoSaveDrafts !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ spellcheck: settings.spellcheck === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Проверка орфографии в поле ввода</div>
            <div class="plugin-sub">Локальная подсветка опечаток системным словарём устройства</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.spellcheck !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ showChatAvatars: settings.showChatAvatars === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Аватары собеседников внутри ленты чата</div>
            <div class="plugin-sub">Скройте для увеличения полезной ширины текста на узких экранах</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.showChatAvatars !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ confirmCall: !settings.confirmCall })}>
          <div class="plugin-copy">
            <div class="plugin-title">Подтверждение перед голосовым P2P-звонком</div>
            <div class="plugin-sub">Защита от случайного нажатия на кнопку вызова в заголовке диалога</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.confirmCall ? 'on' : ''}`}><span></span></button>
        </div>
      </div>

      <label class="field-label">Скорость воспроизведения голосовых сообщений по умолчанию</label>
      <div class="chip-grid">
        ${[
          [1, '1.0× Обычная'],
          [1.25, '1.25× Бодрая'],
          [1.5, '1.5× Быстрая'],
          [2, '2.0× Ускоренная'],
        ].map(([rate, lbl]) => html`<button
          key=${rate}
          type="button"
          class=${`choice-chip ${Number(settings.voicePlaybackRate || 1) === rate ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ voicePlaybackRate: rate })}
        >${lbl}</button>`)}
      </div>

      <label class="field-label">Высота превью сообщений в списке чатов</label>
      <div class="chip-grid">
        ${[
          [1, '1 строка (компактно)'],
          [2, '2 строки (стандарт)'],
          [3, '3 строки (подробно)'],
        ].map(([lines, lbl]) => html`<button
          key=${lines}
          type="button"
          class=${`choice-chip ${Number(settings.chatListLines || 2) === lines ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ chatListLines: lines })}
        >${lbl}</button>`)}
      </div>

      <label class="field-label">Таймер автоудаления по умолчанию для новых диалогов (TTL)</label>
      <div class="chip-grid">
        ${[
          [0, 'Бессрочно'],
          [30, '30 сек'],
          [300, '5 мин'],
          [3600, '1 час'],
          [86400, '24 часа'],
          [604800, '7 дней'],
        ].map(([sec, lbl]) => html`<button
          key=${sec}
          type="button"
          class=${`choice-chip ${Number(settings.defaultTtlSec || 0) === sec ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ defaultTtlSec: sec })}
        >${lbl}</button>`)}
      </div>
    </div>
  </div>`;
}

// ─────────────────────── 4. Подраздел «Конфиденциальность» ───────────────────────

function PrivacySectionView() {
  const { settings, android, me } = store;
  const [pinDraft, setPinDraft] = useState('');
  const [pinCurrent, setPinCurrent] = useState('');
  const [bossDocTitle, setBossDocTitle] = useState(
    settings.bossDocTitle || 'Финансовая_модель_Q4_консолидация.xlsx'
  );

  const onEnablePin = async () => {
    try {
      await setAppPin(pinDraft);
      setPinDraft('');
    } catch (err) {
      showToast(err.message, 'err');
    }
  };

  const onDisablePin = async () => {
    try {
      await disableAppPin(pinCurrent);
      setPinCurrent('');
    } catch (err) {
      showToast(err.message, 'err');
    }
  };

  return html`<div class="settings-sub-stack">
    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="lock" size=${16} /> PIN-блокировка и защита локального доступа</h3>
      </div>

      <div class="pin-config-box">
        <div class="plugin-copy">
          <div class="plugin-title">
            Локальный PIN-код входа (${settings.pinHashB64 ? 'Активен · SHA-256 с солью' : 'Выключен'})
          </div>
          <div class="plugin-sub">
            Защищает открытую сессию при передаче телефона в чужие руки или после таймера неактивности
          </div>
        </div>

        ${!settings.pinHashB64
          ? html`<div class="inline-form-row">
              <input
                class="field-input"
                type="password"
                inputmode="numeric"
                maxLength="8"
                placeholder="Новый PIN (4–8 цифр)"
                value=${pinDraft}
                onInput=${(e) => setPinDraft(e.target.value.replace(/\D/g, ''))}
              />
              <button type="button" class="btn-primary compact" onClick=${onEnablePin}>
                Установить PIN
              </button>
            </div>`
          : html`<div class="inline-form-row">
              <input
                class="field-input"
                type="password"
                inputmode="numeric"
                maxLength="8"
                placeholder="Текущий PIN для отключения"
                value=${pinCurrent}
                onInput=${(e) => setPinCurrent(e.target.value.replace(/\D/g, ''))}
              />
              <button type="button" class="btn-ghost compact" onClick=${lockAppNow}>
                Заблокировать
              </button>
              <button type="button" class="btn-danger compact" onClick=${onDisablePin}>
                Отключить PIN
              </button>
            </div>`}
      </div>

      <label class="field-label">Автоблокировка при отсутствии активности</label>
      <div class="chip-grid">
        ${[
          [0, 'Выключена'],
          [1, '1 мин'],
          [5, '5 мин'],
          [15, '15 мин'],
          [30, '30 мин'],
        ].map(([m, lbl]) => html`<button
          key=${m}
          type="button"
          class=${`choice-chip ${Number(settings.autoLockMinutes || 0) === m ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ autoLockMinutes: m })}
        >${lbl}</button>`)}
      </div>

      <label class="field-label">Автоочистка буфера обмена после копирования ключей и текста</label>
      <div class="chip-grid">
        ${[
          [0, 'Не очищать'],
          [15, 'Через 15 сек'],
          [30, 'Через 30 сек'],
          [60, 'Через 60 сек'],
        ].map(([sec, lbl]) => html`<button
          key=${sec}
          type="button"
          class=${`choice-chip ${Number(settings.clipboardAutoClearSec || 0) === sec ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ clipboardAutoClearSec: sec })}
        >${lbl}</button>`)}
      </div>

      <div class="settings-rows-list">
        <div class="settings-switch-row" onClick=${() => updateClientSettings({ lockOnBackground: !settings.lockOnBackground })}>
          <div class="plugin-copy">
            <div class="plugin-title">Мгновенная блокировка при сворачивании приложения</div>
            <div class="plugin-sub">Автоматически включает PIN-экран при переключении в другое приложение</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.lockOnBackground ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${toggleScreenshotProtection}>
          <div class="plugin-copy">
            <div class="plugin-title">Защита от скриншотов и записи экрана (FLAG_SECURE)</div>
            <div class="plugin-sub">
              ${android.screenshotProtection
                ? 'Снимки экрана и превью в меню недавних приложений заблокированы ОС Android'
                : 'По умолчанию выключено — вы можете свободно делать скриншоты'}
            </div>
          </div>
          <button type="button" class=${`ios-switch ${android.screenshotProtection ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ incognitoKeyboard: !settings.incognitoKeyboard })}>
          <div class="plugin-copy">
            <div class="plugin-title">Приватный режим экранной клавиатуры</div>
            <div class="plugin-sub">Отключает автозаполнение и запоминание вводимых слов клавиатурой ОС</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.incognitoKeyboard ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ blurMediaInChat: !settings.blurMediaInChat })}>
          <div class="plugin-copy">
            <div class="plugin-title">Размывать фотографии в чате до нажатия</div>
            <div class="plugin-sub">Защищает изображения на экране в транспорте и общественных местах</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.blurMediaInChat ? 'on' : ''}`}><span></span></button>
        </div>
      </div>
    </div>

    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="eyeOff" size=${16} /> Видимость активности и режим маскировки (Esc×2)</h3>
      </div>

      <div class="settings-rows-list">
        <div class="settings-switch-row" onClick=${() => updateClientSettings({ hideOnlinePresence: !settings.hideOnlinePresence })}>
          <div class="plugin-copy">
            <div class="plugin-title">Скрывать зелёный индикатор присутствия «онлайн»</div>
            <div class="plugin-sub">Отключает световую точку присутствия на аватарах</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.hideOnlinePresence ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ sendReadReceipts: settings.sendReadReceipts === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Отправлять отчёты о прочтении (✓✓ Прочитано)</div>
            <div class="plugin-sub">Уведомляет собеседника по E2EE о прочтении его сообщений</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.sendReadReceipts !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ sendTypingIndicators: settings.sendTypingIndicators === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Индикатор набора текста («печатает…»)</div>
            <div class="plugin-sub">Отправляет зашифрованный сигнал набора текста в открытый диалог</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.sendTypingIndicators !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ shareProfileE2ee: settings.shareProfileE2ee === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Передавать кастомный профиль собеседникам (E2EE)</div>
            <div class="plugin-sub">Если выключено, контакты видят только ваш @username без аватара и био</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.shareProfileE2ee !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ previewInList: settings.previewInList === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Показывать текст последних сообщений в списке чатов</div>
            <div class="plugin-sub">Отключите, чтобы скрыть реплики на главном экране от посторонних глаз</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.previewInList !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ acceptAnonGateway: settings.acceptAnonGateway === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Принимать сообщения через внешний E2E-шлюз (/q/${me?.username})</div>
            <div class="plugin-sub">Позволяет отправлять вам зашифрованные обращения через браузер</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.acceptAnonGateway !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ strictBossWipe: !settings.strictBossWipe })}>
          <div class="plugin-copy">
            <div class="plugin-title">Экстренная выгрузка ключей сессий из ОЗУ при блокировке</div>
            <div class="plugin-sub">Очищает кеш расшифрованных ключей в CryptoWorker при двойном Esc</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.strictBossWipe ? 'on' : ''}`}><span></span></button>
        </div>
      </div>

      <label class="field-label">Шаблон экрана мгновенной маскировки (Esc×2)</label>
      <div class="chip-grid">
        ${[
          ['xlsx', 'Таблица бюджета XLSX'],
          ['terminal', 'Терминал сборки Linux'],
          ['notes', 'Инженерные заметки'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.bossTemplate || 'xlsx') === id ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ bossTemplate: id })}
        >${lbl}</button>`)}
      </div>

      <div class="inline-form-row">
        <input
          class="field-input"
          type="text"
          value=${bossDocTitle}
          onInput=${(e) => setBossDocTitle(e.target.value)}
          onBlur=${() => updateClientSettings({ bossDocTitle: bossDocTitle.trim() || 'Отчёт_Q4.xlsx' })}
        />
        <button type="button" class="btn-ghost compact" onClick=${() => toggleBossMode(true)}>
          <${Icon} name="eyeOff" size=${14} /> Проверить
        </button>
      </div>
    </div>
  </div>`;
}

// ─────────────────────── 5. Подраздел «Уведомления и звуки» ───────────────────────

function NotificationsSectionView() {
  const { settings } = store;

  return html`<div class="settings-sub-stack">
    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="volume" size=${16} /> Уведомления, звуки, звонки и счётчик</h3>
      </div>

      <label class="field-label">Содержимое уведомлений в системной шторке Android / ОС</label>
      <div class="chip-grid">
        ${[
          ['full', 'Имя и текст'],
          ['sender', 'Только имя'],
          ['stealth', 'Скрытно (без имён)'],
          ['off', 'Выключены'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.notificationContent || 'full') === id ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ notificationContent: id })}
        >${lbl}</button>`)}
      </div>

      <div class="chip-grid" style="margin-top:8px">
        <button type="button" class="btn-ghost compact" onClick=${requestSystemNotificationAccess}>
          Разрешить в ОС
        </button>
        <button type="button" class="btn-primary compact" onClick=${sendTestShadeNotification}>
          Проверить шторку
        </button>
      </div>

      <label class="field-label">Счётчик непрочитанных на нижней вкладке «Чаты»</label>
      <div class="chip-grid">
        ${[
          ['unmuted', 'Только активные чаты'],
          ['all', 'Все чаты (включая без звука)'],
          ['off', 'Скрывать счётчик'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.unreadCounterMode || 'unmuted') === id ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ unreadCounterMode: id })}
        >${lbl}</button>`)}
      </div>

      <div class="settings-rows-list">
        <div
          class="settings-switch-row"
          onClick=${() => toggleAndroidBackgroundService(settings.bgKeepAlive === false)}
        >
          <div class="plugin-copy">
            <div class="plugin-title">Фоновая доставка в шторку уведомлений</div>
            <div class="plugin-sub">Удерживает защищённый E2EE-сокет при свёрнутом приложении для мгновенных оповещений и звонков</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.bgKeepAlive !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ sound: settings.sound === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Звук входящих сообщений</div>
            <div class="plugin-sub">Чистый синтез WebAudio API локально без внешних медиафайлов</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.sound !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ outgoingSound: settings.outgoingSound === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Звуковой сигнал при отправке сообщения</div>
            <div class="plugin-sub">Короткий акустический импульс при упаковке конверта</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.outgoingSound !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ inAppBannerToast: settings.inAppBannerToast === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Всплывающие уведомления внутри приложения</div>
            <div class="plugin-sub">Показывает баннер сверху, когда приходит сообщение в соседний чат</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.inAppBannerToast !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ quietHoursEnabled: !settings.quietHoursEnabled })}>
          <div class="plugin-copy">
            <div class="plugin-title">Режим «Тихие часы» (Не беспокоить ночью)</div>
            <div class="plugin-sub">Автоматически отключает звук и вибрацию в заданный ночной интервал</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.quietHoursEnabled ? 'on' : ''}`}><span></span></button>
        </div>
      </div>

      ${settings.quietHoursEnabled && html`<div>
        <label class="field-label">Расписание тихих часов</label>
        <div class="chip-grid">
          ${[
            ['23-07', '23:00 – 07:00'],
            ['22-08', '22:00 – 08:00'],
            ['00-08', '00:00 – 08:00'],
          ].map(([id, lbl]) => html`<button
            key=${id}
            type="button"
            class=${`choice-chip ${(settings.quietHoursRange || '23-07') === id ? 'active' : ''}`}
            onClick=${() => updateClientSettings({ quietHoursRange: id })}
          >${lbl}</button>`)}
        </div>
      </div>`}

      <label class="field-label">Звуковой профиль входящих сообщений</label>
      <div class="chip-grid">
        ${[
          ['crystal', 'Кристалл'],
          ['chime', 'Новогодний перезвон'],
          ['pulse', 'Импульс'],
          ['sonar', 'Сонар'],
          ['soft', 'Мягкий тон'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.soundProfile || 'crystal') === id ? 'active' : ''}`}
          onClick=${() => {
            updateClientSettings({ soundProfile: id });
            playSfx('incoming', id);
          }}
        >${lbl}</button>`)}
      </div>

      <label class="field-label">Мелодия входящего голосового P2P-вызова</label>
      <div class="chip-grid">
        ${[
          ['northern', 'Северный аккорд'],
          ['classic', 'Классический дуэт'],
          ['pulse', 'Цифровой импульс'],
          ['silent', 'Только вибрация'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.callRingtone || 'northern') === id ? 'active' : ''}`}
          onClick=${() => {
            updateClientSettings({ callRingtone: id });
            playSfx('ring', id);
          }}
        >${lbl}</button>`)}
      </div>

      <label class="field-label">Тактильная вибрация (Android Vibrator / Haptics)</label>
      <div class="chip-grid">
        ${[
          ['off', 'Выключена'],
          ['soft', 'Мягкий отклик'],
          ['strong', 'Чёткий импульс'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.haptics || 'soft') === id ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ haptics: id })}
        >${lbl}</button>`)}
      </div>
    </div>
  </div>`;
}

// ─────────────────────── 6. Подраздел «Данные и память» ───────────────────────

function StorageSectionView() {
  const { settings } = store;
  const [backupPass, setBackupPass] = useState('');
  const backupFileRef = useRef(null);
  const stats = getStorageStats();

  const onExportVault = async () => {
    try {
      await exportEncryptedBackup(backupPass);
    } catch (err) {
      showToast(err.message, 'err');
    }
  };

  const onImportVaultFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      await importEncryptedBackup(text, backupPass);
    } catch (err) {
      showToast(err.message, 'err');
    }
  };

  return html`<div class="settings-sub-stack">
    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="pie" size=${16} /> Использование локальной памяти и медиафайлы</h3>
      </div>

      <div class="storage-stats-grid">
        <div class="stat-mini-box">
          <b>${stats.dmCount}</b>
          <span>Контактов</span>
        </div>
        <div class="stat-mini-box">
          <b>${stats.msgCount}</b>
          <span>Сообщений</span>
        </div>
        <div class="stat-mini-box">
          <b>${stats.mediaCached}</b>
          <span>Медиа в ОЗУ</span>
        </div>
        <div class="stat-mini-box">
          <b>${formatBytes(stats.approxBytes, settings.byteUnits)}</b>
          <span>База E2EE</span>
        </div>
      </div>

      <label class="field-label">Автоматическая расшифровка входящих E2E-фотографий</label>
      <div class="chip-grid">
        ${[
          ['always', 'Всегда сразу'],
          ['1mb', 'До 1 МБ'],
          ['manual', 'Только по нажатию'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.autoDecryptMedia || 'always') === id ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ autoDecryptMedia: id })}
        >${lbl}</button>`)}
      </div>

      <label class="field-label">Автоочистка расшифрованных медиа из оперативной памяти</label>
      <div class="chip-grid">
        ${[
          [0, 'Вручную'],
          [5, 'Через 5 мин простоя'],
          [15, 'Через 15 мин простоя'],
          [-1, 'При сворачивании окна'],
        ].map(([val, lbl]) => html`<button
          key=${val}
          type="button"
          class=${`choice-chip ${Number(settings.autoPurgeCacheMinutes || 0) === val ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ autoPurgeCacheMinutes: val })}
        >${lbl}</button>`)}
      </div>

      <div class="studio-actions" style="justify-content:flex-start">
        <button type="button" class="btn-ghost compact" onClick=${clearDecryptedMediaCache}>
          Освободить медиа из ОЗУ сейчас
        </button>
        <button type="button" class="btn-ghost compact" onClick=${clearAllMessagesHistory}>
          <${Icon} name="trash" size=${13} /> Очистить историю всех чатов
        </button>
      </div>
    </div>

    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="database" size=${16} /> Зашифрованная резервная копия (AES-256-GCM)</h3>
      </div>

      <p class="modal-desc">
        Экспортирует историю диалогов, контакты, папки и тему оформления в зашифрованный контейнер
        <code>PBKDF2-SHA256 (210 000 итераций) + AES-256-GCM</code>.
      </p>

      <input
        class="field-input"
        type="password"
        placeholder="Парольная фраза шифрования архива (минимум 6 символов)"
        value=${backupPass}
        onInput=${(e) => setBackupPass(e.target.value)}
      />
      <input
        ref=${backupFileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange=${onImportVaultFile}
      />
      <div class="studio-actions" style="justify-content:flex-start">
        <button type="button" class="btn-primary compact" onClick=${onExportVault}>
          <${Icon} name="download" size=${14} /> Экспорт .enc.json
        </button>
        <button type="button" class="btn-ghost compact" onClick=${() => backupFileRef.current?.click()}>
          <${Icon} name="upload" size=${14} /> Импорт .enc.json
        </button>
      </div>
    </div>
  </div>`;
}

// ─────────────────────── 8. Подраздел «Устройства и сеть» ───────────────────────

function DevicesNetworkSectionView() {
  const { settings, android, me, activeTransportId, sessionAuthenticated, rttMs } = store;
  const [serverUrl, setServerUrl] = useState(settings.serverUrl || '');
  const [onionUrl, setOnionUrl] = useState(settings.onionUrl || '');
  const [i2pUrl, setI2pUrl] = useState(settings.i2pUrl || '');
  const [localBridgeUrl, setLocalBridgeUrl] = useState(settings.localBridgeUrl || 'ws://127.0.0.1:27700');
  const [customStunUrl, setCustomStunUrl] = useState(settings.customStunUrl || 'stun:stun.l.google.com:19302');

  const onSaveNetwork = async () => {
    await updateClientSettings({
      serverUrl: serverUrl.trim(),
      onionUrl: onionUrl.trim(),
      i2pUrl: i2pUrl.trim(),
      localBridgeUrl: localBridgeUrl.trim() || 'ws://127.0.0.1:27700',
      customStunUrl: customStunUrl.trim(),
    });
    showToast('Сетевая и транспортная конфигурация применена');
  };

  return html`<div class="settings-sub-stack">
    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="laptop" size=${16} /> Текущее устройство и активный сеанс</h3>
      </div>

      <div class="active-device-banner">
        <div class="device-icon-badge">
          <${Icon} name="laptop" size=${20} />
        </div>
        <div class="device-banner-info">
          <b>${android.isApk ? 'Android смартфон · MeshChat APK' : 'Веб-клиент / Рабочая станция'}</b>
          <span>
            @${me?.username || 'local'} · v${APP_VERSION} · ${sessionAuthenticated ? `Онлайн (${activeTransportId}${rttMs ? `, ${rttMs} мс` : ''})` : 'Офлайн-режим'}
          </span>
        </div>
        <span class="hero-status-pill online">Текущий</span>
      </div>

      <div class="settings-rows-list">
        <div class="settings-switch-row" onClick=${toggleKeepScreenOn}>
          <div class="plugin-copy">
            <div class="plugin-title">Удерживать экран включённым (FLAG_KEEP_SCREEN_ON)</div>
            <div class="plugin-sub">Предотвращает засыпание экрана во время ретрансляции пакетов</div>
          </div>
          <button type="button" class=${`ios-switch ${android.keepScreenOn ? 'on' : ''}`}><span></span></button>
        </div>

        ${android.isApk && html`<div class="settings-switch-row" onClick=${toggleAndroidLanMesh}>
          <div class="plugin-copy">
            <div class="plugin-title">Локальный Mesh-ретранслятор Wi-Fi LAN</div>
            <div class="plugin-sub">
              ${android.lanMeshRunning && android.lanUrl
                ? `Активен локальный узел ${android.lanUrl}`
                : 'Прямой обмен между смартфонами в одной Wi-Fi сети без интернета'}
            </div>
          </div>
          <button type="button" class=${`ios-switch ${android.lanMeshRunning ? 'on' : ''}`}><span></span></button>
        </div>`}
      </div>

      <div class="studio-actions" style="justify-content:flex-start">
        <button type="button" class="btn-ghost compact" onClick=${rotateBlindMailbox}>
          <${Icon} name="refresh" size=${14} /> Отозвать старые токены ящика
        </button>
      </div>
    </div>

    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="radar" size=${16} /> Криптовыравнивание, ретранслятор и Tor / I2P</h3>
      </div>

      <label class="field-label">Квант выравнивания конвертов ISO/IEC 7816-4</label>
      <div class="chip-grid">
        ${[
          [256, '256 Б'],
          [512, '512 Б (стандарт)'],
          [1024, '1024 Б'],
          [2048, '2048 Б'],
          [4096, '4096 Б'],
        ].map(([bytes, lbl]) => html`<button
          key=${bytes}
          type="button"
          class=${`choice-chip ${Number(settings.paddingBlockBytes || 512) === bytes ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ paddingBlockBytes: bytes })}
        >${lbl}</button>`)}
      </div>

      <label class="field-label">Интервал синхронизации слепого ящика</label>
      <div class="chip-grid">
        ${[
          [3, '3 сек'],
          [6, '6 сек (оптимально)'],
          [15, '15 сек'],
          [30, '30 сек'],
        ].map(([sec, lbl]) => html`<button
          key=${sec}
          type="button"
          class=${`choice-chip ${Number(settings.syncIntervalSec || 6) === sec ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ syncIntervalSec: sec })}
        >${lbl}</button>`)}
      </div>

      <label class="field-label">Политика кандидатов WebRTC ICE</label>
      <div class="chip-grid">
        ${[
          ['all', 'Прямой P2P + TURN'],
          ['relay', 'Только TURN (скрывать IP от пира)'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.webrtcIcePolicy || 'all') === id ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ webrtcIcePolicy: id })}
        >${lbl}</button>`)}
      </div>

      <div class="settings-rows-list">
        <div class="settings-switch-row" onClick=${() => updateClientSettings({ coverTraffic: !settings.coverTraffic })}>
          <div class="plugin-copy">
            <div class="plugin-title">Фоновый маскирующий Cover-трафик</div>
            <div class="plugin-sub">Генерирует холостые пакеты против анализа времени активности</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.coverTraffic ? 'on' : ''}`}><span></span></button>
        </div>
      </div>

      <label class="field-label">Быстрый выбор сервера ретрансляции</label>
      <div class="chip-grid">
        <button
          type="button"
          class="choice-chip"
          onClick=${() => { setServerUrl(DEFAULT_CLOUD_URL); updateClientSettings({ serverUrl: DEFAULT_CLOUD_URL }); }}
        >Облачный узел EU (Render)</button>
        <button
          type="button"
          class="choice-chip"
          onClick=${() => { setServerUrl(''); updateClientSettings({ serverUrl: '' }); }}
        >Локальный узел</button>
      </div>

      <label class="field-label">URL сервера ретрансляции</label>
      <input
        class="field-input"
        type="text"
        placeholder="https://meshchat-6a11.onrender.com"
        value=${serverUrl}
        onInput=${(e) => setServerUrl(e.target.value)}
      />

      <div class="settings-grid-2">
        <div>
          <label class="field-label">Скрытый сервис Tor (.onion)</label>
          <input
            class="field-input"
            type="text"
            placeholder="ws://xxxx.onion/ws"
            value=${onionUrl}
            onInput=${(e) => setOnionUrl(e.target.value)}
          />
        </div>
        <div>
          <label class="field-label">Туннель I2P (.b32.i2p)</label>
          <input
            class="field-input"
            type="text"
            placeholder="ws://xxxx.b32.i2p/ws"
            value=${i2pUrl}
            onInput=${(e) => setI2pUrl(e.target.value)}
          />
        </div>
      </div>

      <div class="settings-grid-2">
        <div>
          <label class="field-label">Локальный мост SOCKS5</label>
          <input
            class="field-input"
            type="text"
            placeholder="ws://127.0.0.1:27700"
            value=${localBridgeUrl}
            onInput=${(e) => setLocalBridgeUrl(e.target.value)}
          />
        </div>
        <div>
          <label class="field-label">Сервер STUN</label>
          <input
            class="field-input"
            type="text"
            placeholder="stun:stun.l.google.com:19302"
            value=${customStunUrl}
            onInput=${(e) => setCustomStunUrl(e.target.value)}
          />
        </div>
      </div>

      <label class="field-label">Политика сетевого транспорта</label>
      <div class="policy-stack">
        ${POLICY_LIST.map(([id, title, sub]) => html`<label
          key=${id}
          class=${`policy-card ${settings.transportPolicy === id ? 'selected' : ''}`}
          onClick=${() => updateClientSettings({ transportPolicy: id })}
        >
          <div>
            <div class="policy-title">${title}</div>
            <div class="policy-desc">${sub}</div>
          </div>
        </label>`)}
      </div>

      <div class="studio-actions">
        <button type="button" class="btn-ghost compact" onClick=${sendMeshTestPacket}>
          Тест пакета (${settings.paddingBlockBytes || 512} Б)
        </button>
        <button type="button" class="btn-primary compact" onClick=${onSaveNetwork}>
          Сохранить сеть
        </button>
      </div>
    </div>
  </div>`;
}

// ─────────────────────── Рендерер выбранного подраздела ───────────────────────

function renderSectionDetail(sectionId) {
  switch (sectionId) {
    case 'account': return html`<${AccountSectionView} />`;
    case 'chats': return html`<${ChatsSectionView} />`;
    case 'reactions': return html`<${ReactionsSectionView} />`;
    case 'privacy': return html`<${PrivacySectionView} />`;
    case 'notifications': return html`<${NotificationsSectionView} />`;
    case 'storage': return html`<${StorageSectionView} />`;
    case 'folders': return html`<${FoldersSectionView} />`;
    case 'devices': return html`<${DevicesNetworkSectionView} />`;
    case 'power': return html`<${PowerSavingSectionView} />`;
    case 'language': return html`<${LanguageSectionView} />`;
    case 'updates': return html`<${UpdatesDiagnosticsSectionView} />`;
    default: return html`<${ChatsSectionView} />`;
  }
}

// ─────────────────────── Главный экран «Настройки» (Хаб разделов + Подразделы) ───────────────────────

export function SettingsScreen() {
  const { ui } = store;
  const [search, setSearch] = useState('');
  const [isWideDesktop, setIsWideDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1080 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsWideDesktop(window.innerWidth >= 1080);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const activeSectionId = ui.settingsSection || (isWideDesktop ? 'chats' : null);
  const activeMeta = SETTINGS_SECTIONS_META.find((m) => m.id === activeSectionId) || null;

  const q = search.trim().toLowerCase();
  const searchMatches = q
    ? SETTINGS_SEARCH_INDEX.filter(
        (item) => item.title.toLowerCase().includes(q) || item.kw.toLowerCase().includes(q)
      )
    : [];

  const toggleSearchBar = () => {
    const next = !ui.settingsSearchOpen;
    store.ui.settingsSearchOpen = next;
    store.ui.settingsMenuOpen = false;
    if (!next) setSearch('');
    notifyStore();
  };

  const toggleOverflowMenu = () => {
    store.ui.settingsMenuOpen = !ui.settingsMenuOpen;
    notifyStore();
  };

  // Карточки разделов настроек (как в референсе: пастельный круг иконки + заголовок + описание / значение)
  const renderHubList = () => html`<div class="settings-hub-list">
    ${q
      ? html`<div class="settings-search-results">
          ${searchMatches.length === 0 && html`<div class="empty-list-hint">
            По запросу «${search}» параметров не найдено.
          </div>`}
          ${searchMatches.map((hit, idx) => {
            const meta = SETTINGS_SECTIONS_META.find((m) => m.id === hit.section);
            return html`<button
              key=${idx}
              type="button"
              class="settings-hub-card"
              onClick=${() => {
                setSearch('');
                store.ui.settingsSearchOpen = false;
                openSettingsSection(hit.section);
              }}
            >
              <span
                class="settings-pastel-circle"
                style=${`background:${meta?.circleBg || '#8ec5fc'};color:${meta?.circleFg || '#0e2844'}`}
              >
                <${Icon} name=${meta?.icon || 'settings'} size=${20} />
              </span>
              <span class="settings-hub-copy">
                <b class="settings-hub-title">${hit.title}</b>
                <span class="settings-hub-sub">Раздел: ${getSectionTitle(meta)}</span>
              </span>
              <span class="settings-hub-chevron"><${Icon} name="chevronRight" size=${16} /></span>
            </button>`;
          })}
        </div>`
      : SETTINGS_SECTIONS_META.map((sec) => {
          const rightVal = typeof sec.rightValue === 'function' ? sec.rightValue() : '';
          const selectedOnDesktop = isWideDesktop && activeSectionId === sec.id;
          return html`<button
            key=${sec.id}
            type="button"
            class=${`settings-hub-card ${selectedOnDesktop ? 'active' : ''}`}
            onClick=${() => openSettingsSection(sec.id)}
          >
            <span
              class="settings-pastel-circle"
              style=${`background:${sec.circleBg};color:${sec.circleFg}`}
            >
              <${Icon} name=${sec.icon} size=${20} />
            </span>

            <span class="settings-hub-copy">
              <b class="settings-hub-title">${getSectionTitle(sec)}</b>
              ${sec.sub && html`<span class="settings-hub-sub">${sec.sub}</span>`}
            </span>

            ${rightVal && html`<span class="settings-hub-value">${rightVal}</span>`}
          </button>`;
        })}
  </div>`;

  // На мобильных устройствах при открытом подразделе показываем отдельный чистый экран подраздела
  if (!isWideDesktop && ui.settingsSection) {
    return html`<section class="tab-screen settings-screen settings-subpage-mode">
      <header class="settings-top-bar subpage">
        <button
          type="button"
          class="settings-bar-icon-btn"
          title="Назад к разделам настроек"
          onClick=${closeSettingsSection}
        >
          <${Icon} name="back" size=${22} />
        </button>

        <div class="settings-subbar-title">
          ${activeMeta && html`<span
            class="settings-pastel-circle mini"
            style=${`background:${activeMeta.circleBg};color:${activeMeta.circleFg}`}
          >
            <${Icon} name=${activeMeta.icon} size=${15} />
          </span>`}
          <h1>${getSectionTitle(activeMeta)}</h1>
        </div>

        <button
          type="button"
          class="settings-bar-icon-btn"
          title="Новогодняя атмосфера и градиенты"
          onClick=${() => { store.ui.modal = 'atmosphere'; notifyStore(); }}
        >
          <${Icon} name="snowflake" size=${18} />
        </button>
      </header>

      <div class="mesh-scroll-body settings-detail-scroll">
        ${renderSectionDetail(ui.settingsSection)}
      </div>
    </section>`;
  }

  return html`<section class="tab-screen settings-screen">
    <!-- Верхняя панель в стиле референса: QR слева · Настройки по центру · Поиск и ⋮ справа -->
    <header class="settings-top-bar">
      <button
        type="button"
        class="settings-bar-icon-btn"
        title="Моя QR-визитка"
        onClick=${() => { store.ui.modal = 'qr'; notifyStore(); }}
      >
        <${Icon} name="qr" size=${21} />
      </button>

      <h1 class="settings-bar-center-title">${uiText('settings')}</h1>

      <div class="settings-bar-right">
        <button
          type="button"
          class=${`settings-bar-icon-btn ${ui.settingsSearchOpen ? 'active' : ''}`}
          title="Поиск по всем настройкам"
          onClick=${toggleSearchBar}
        >
          <${Icon} name="search" size=${20} />
        </button>

        <div class="settings-overflow-anchor">
          <button
            type="button"
            class="settings-bar-icon-btn"
            title="Быстрые действия"
            onClick=${toggleOverflowMenu}
          >
            <${Icon} name="moreVert" size=${20} />
          </button>

          ${ui.settingsMenuOpen && html`<div class="settings-overflow-menu">
            <button
              type="button"
              onClick=${() => { store.ui.settingsMenuOpen = false; store.ui.modal = 'atmosphere'; notifyStore(); }}
            >
              <${Icon} name="snowflake" size=${15} /> Атмосфера и градиенты
            </button>
            <button
              type="button"
              onClick=${() => { store.ui.settingsMenuOpen = false; lockAppNow(); }}
            >
              <${Icon} name="lock" size=${15} /> Заблокировать сейчас
            </button>
            <button
              type="button"
              onClick=${() => { store.ui.settingsMenuOpen = false; checkForUpdates({ silent: false }); }}
            >
              <${Icon} name="refresh" size=${15} /> Проверить обновления
            </button>
            <button
              type="button"
              onClick=${() => { store.ui.settingsMenuOpen = false; resetAllSettingsToDefaults(); }}
            >
              <${Icon} name="sliders" size=${15} /> Сбросить настройки
            </button>
          </div>`}
        </div>
      </div>
    </header>

    ${ui.settingsSearchOpen && html`<div class="settings-search-drawer">
      <div class="search-box settings-search-box">
        <${Icon} name="search" size=${15} />
        <input
          type="text"
          autofocus
          placeholder="Найти настройку: обои, снег, PIN, реакции, папки, энергосбережение…"
          value=${search}
          onInput=${(e) => setSearch(e.target.value)}
        />
        ${search && html`<button type="button" class="icon-btn small" onClick=${() => setSearch('')}>
          <${Icon} name="close" size=${13} />
        </button>`}
      </div>
    </div>`}

    ${isWideDesktop
      ? html`<div class="settings-master-detail">
          <aside class="settings-master-col">
            ${renderHubList()}
          </aside>
          <div class="settings-detail-col">
            <div class="settings-detail-hero">
              ${activeMeta && html`<span
                class="settings-pastel-circle mini"
                style=${`background:${activeMeta.circleBg};color:${activeMeta.circleFg}`}
              >
                <${Icon} name=${activeMeta.icon} size=${16} />
              </span>`}
              <h2>${getSectionTitle(activeMeta)}</h2>
            </div>
            ${renderSectionDetail(activeSectionId)}
          </div>
        </div>`
      : html`<div class="mesh-scroll-body settings-hub-scroll">
          ${renderHubList()}
        </div>`}
  </section>`;
}
