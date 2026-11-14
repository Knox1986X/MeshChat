// Полнофункциональный центр настроек MeshChat v1.6 (Оформление, Чаты, Приватность и PIN,
// Криптография и Сеть, Звук и Виброотклик, Память и Зашифрованный резерв AES-256-GCM)
// + экран локальной PIN-блокировки PinLockOverlay.

import { html, useState, useRef, useEffect } from '../../vendor/preact.mjs';
import {
  store,
  notifyStore,
  APP_VERSION,
  APP_VERSION_CODE,
  DEFAULT_CLOUD_URL,
  THEME_PRESETS,
  updateThemeSettings,
  resetThemeSettings,
  updateClientSettings,
  toggleScreenshotProtection,
  toggleKeepScreenOn,
  toggleAndroidLanMesh,
  rotateBlindMailbox,
  checkForUpdates,
  applyAppUpdate,
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
  triggerHaptic,
  showToast,
} from '../store/app-store.mjs';
import { TRANSPORT_POLICY } from '../transport/transport-interface.mjs';
import { Icon, playSfx, formatBytes, formatTime } from './boss-screen.mjs';

const SETTINGS_CATEGORIES = [
  { id: 'all', label: 'Все', icon: 'sliders' },
  { id: 'appearance', label: 'Оформление', icon: 'palette' },
  { id: 'chats', label: 'Чаты и ввод', icon: 'chat' },
  { id: 'privacy', label: 'Приватность и PIN', icon: 'lock' },
  { id: 'network', label: 'Крипто и сеть', icon: 'radar' },
  { id: 'sound', label: 'Звук и отклик', icon: 'volume' },
  { id: 'storage', label: 'Память и бэкап', icon: 'database' },
];

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

// ─────────────────────── Студия кастомных тем, шрифтов и плотности ───────────────────────

export function ThemeStudioCard({ onClose = null }) {
  const { theme, settings } = store;

  return html`<div class="studio-card">
    <div class="studio-card-head">
      <h3><${Icon} name="palette" size=${16} /> Кастомизация темы, цветов и типографики</h3>
      <div class="studio-head-btns">
        <button type="button" class="btn-ghost compact" onClick=${resetThemeSettings}>
          Сбросить тему
        </button>
        ${onClose && html`<button type="button" class="icon-btn small" onClick=${onClose}>
          <${Icon} name="close" size=${15} />
        </button>`}
      </div>
    </div>

    <!-- Живое превью пузырей сообщений и шрифта -->
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

    <label class="field-label">Цветовая палитра интерфейса (10 тем)</label>
    <div class="theme-presets-grid">
      ${Object.values(THEME_PRESETS).map((p) => html`<button
        key=${p.id}
        type="button"
        class=${`theme-preset-tile ${theme.preset === p.id ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ preset: p.id, customAccent: p.accent, customBg0: p.bg0 })}
      >
        <span class="preset-preview" style=${`background:${p.bg0};border-color:${p.accent}`}>
          <i style=${`background:${p.accent}`}></i>
        </span>
        <span>${p.label}</span>
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

    <label class="field-label">Узор фона ленты диалогов</label>
    <div class="chip-grid">
      ${[
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

// ─────────────────────── Главный экран «Настройки» ───────────────────────

export function SettingsScreen() {
  const { settings, update, android, ui, me } = store;
  const activeCat = ui.settingsCategory || 'all';

  const [search, setSearch] = useState('');
  const [serverUrl, setServerUrl] = useState(settings.serverUrl || '');
  const [onionUrl, setOnionUrl] = useState(settings.onionUrl || '');
  const [i2pUrl, setI2pUrl] = useState(settings.i2pUrl || '');
  const [localBridgeUrl, setLocalBridgeUrl] = useState(settings.localBridgeUrl || 'ws://127.0.0.1:27700');
  const [customStunUrl, setCustomStunUrl] = useState(settings.customStunUrl || 'stun:stun.l.google.com:19302');
  const [bossDocTitle, setBossDocTitle] = useState(settings.bossDocTitle || 'Финансовая_модель_Q4_консолидация.xlsx');

  // Управление локальным PIN-кодом
  const [pinDraft, setPinDraft] = useState('');
  const [pinCurrent, setPinCurrent] = useState('');

  // Зашифрованный резервный архив
  const [backupPass, setBackupPass] = useState('');
  const [wipeConfirm, setWipeConfirm] = useState(false);
  const backupFileRef = useRef(null);

  const q = search.trim().toLowerCase();
  const showSection = (catId, keywords) => {
    if (q) return keywords.toLowerCase().includes(q);
    return activeCat === 'all' || activeCat === catId;
  };

  const stats = getStorageStats();

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

  return html`<section class="tab-screen settings-screen">
    <header class="screen-hero-head">
      <div>
        <h1 class="screen-big-title">Настройки</h1>
        <div class="screen-pills-row">
          <span class="hero-status-pill online">v${APP_VERSION} · build ${APP_VERSION_CODE}</span>
          <span class="hero-status-pill neutral">@${me?.username || 'local'}</span>
          ${settings.pinHashB64 && html`<span class="hero-status-pill neutral">PIN активен</span>`}
        </div>
      </div>
      <div class="hero-quick-actions">
        <button type="button" class="btn-ghost compact" title="Мгновенная блокировка" onClick=${lockAppNow}>
          <${Icon} name="lock" size=${14} /> Блок
        </button>
      </div>
    </header>

    <div class="mesh-scroll-body">
      <!-- Поиск по всем настройкам + переключатель разделов -->
      <div class="settings-toolbar-box">
        <div class="search-box settings-search-box">
          <${Icon} name="search" size=${15} />
          <input
            type="text"
            placeholder="Поиск настройки: тема, шрифт, PIN, TTL, паддинг, WebRTC, звук, бэкап…"
            value=${search}
            onInput=${(e) => setSearch(e.target.value)}
          />
          ${search && html`<button type="button" class="icon-btn small" onClick=${() => setSearch('')}>
            <${Icon} name="close" size=${13} />
          </button>`}
        </div>

        <div class="settings-cat-pills">
          ${SETTINGS_CATEGORIES.map((cat) => html`<button
            key=${cat.id}
            type="button"
            class=${`cat-pill-btn ${!q && activeCat === cat.id ? 'active' : ''}`}
            onClick=${() => {
              setSearch('');
              store.ui.settingsCategory = cat.id;
              notifyStore();
            }}
          >
            <${Icon} name=${cat.icon} size=${14} />
            <span>${cat.label}</span>
          </button>`)}
        </div>
      </div>

      <!-- 1. ОФОРМЛЕНИЕ, ТЕМЫ И ТИПОГРАФИКА -->
      ${showSection(
        'appearance',
        'оформление тема цвета палитра amoled шрифт размер текст плотность компактно аватар скругление пузыри узор сетка анимации хвостики'
      ) && html`<${ThemeStudioCard} />`}

      <!-- 2. ЧАТЫ, ВВОД И ПОВЕДЕНИЕ МЕДИА -->
      ${showSection(
        'chats',
        'чаты ввод сообщения enter отправка орфография ttl автоудаление таймер время секунды формат двойной клик тап ответ реакция медиа фото автозагрузка звонок подтверждение аватары'
      ) && html`<div class="studio-card">
        <div class="studio-card-head">
          <h3><${Icon} name="chat" size=${16} /> Чаты, клавиши ввода и медиафайлы</h3>
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

        <label class="field-label">Формат времени сообщений</label>
        <div class="chip-grid">
          ${[
            ['24h', '24 часа (14:30)'],
            ['24h_sec', 'С секундами (14:30:09)'],
            ['12h', '12 часов (2:30 PM)'],
          ].map(([id, lbl]) => html`<button
            key=${id}
            type="button"
            class=${`choice-chip ${(settings.timeFormat || '24h') === id ? 'active' : ''}`}
            onClick=${() => updateClientSettings({ timeFormat: id })}
          >${lbl}</button>`)}
        </div>

        <label class="field-label">Действие по двойному нажатию на сообщение</label>
        <div class="chip-grid">
          ${[
            ['reply', 'Цитировать'],
            ['copy', 'Скопировать текст'],
            ['react', 'Отметка 👍'],
            ['none', 'Отключено'],
          ].map(([id, lbl]) => html`<button
            key=${id}
            type="button"
            class=${`choice-chip ${(settings.doubleTapAction || 'reply') === id ? 'active' : ''}`}
            onClick=${() => updateClientSettings({ doubleTapAction: id })}
          >${lbl}</button>`)}
        </div>

        <label class="field-label">Авторасшифровка входящих E2E-изображений</label>
        <div class="chip-grid">
          ${[
            ['always', 'Всегда сразу'],
            ['1mb', 'До 1 МиБ'],
            ['manual', 'Только по нажатию'],
          ].map(([id, lbl]) => html`<button
            key=${id}
            type="button"
            class=${`choice-chip ${(settings.autoDecryptMedia || 'always') === id ? 'active' : ''}`}
            onClick=${() => updateClientSettings({ autoDecryptMedia: id })}
          >${lbl}</button>`)}
        </div>
      </div>`}

      <!-- 3. ПРИВАТНОСТЬ, PIN-БЛОКИРОВКА И МАСКИРОВКА ЭКРАНА -->
      ${showSection(
        'privacy',
        'приватность безопасность pin пин код пароль автоблокировка скриншоты flag_secure экран подсветка буфер обмена очистка профиль анонимный шлюз маскировка таблица терминал заметки esc'
      ) && html`<div class="studio-card">
        <div class="studio-card-head">
          <h3><${Icon} name="lock" size=${16} /> Приватность, PIN-блокировка и защита экрана</h3>
        </div>

        <!-- Настройка PIN-кода -->
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

          <div class="settings-switch-row" onClick=${toggleKeepScreenOn}>
            <div class="plugin-copy">
              <div class="plugin-title">Не выключать экран (FLAG_KEEP_SCREEN_ON)</div>
              <div class="plugin-sub">Удерживает подсветку активной во время работы локального ретранслятора или чата</div>
            </div>
            <button type="button" class=${`ios-switch ${android.keepScreenOn ? 'on' : ''}`}><span></span></button>
          </div>

          <div class="settings-switch-row" onClick=${() => updateClientSettings({ shareProfileE2ee: settings.shareProfileE2ee === false })}>
            <div class="plugin-copy">
              <div class="plugin-title">Передавать кастомный профиль собеседникам (E2EE)</div>
              <div class="plugin-sub">Если выключено, контакты видят только ваш @username без аватара, био и баннера</div>
            </div>
            <button type="button" class=${`ios-switch ${settings.shareProfileE2ee !== false ? 'on' : ''}`}><span></span></button>
          </div>

          <div class="settings-switch-row" onClick=${() => updateClientSettings({ sendReadReceipts: settings.sendReadReceipts === false })}>
            <div class="plugin-copy">
              <div class="plugin-title">Отправлять отчёты о прочтении (✓✓ Прочитано)</div>
              <div class="plugin-sub">Уведомляет собеседника по E2EE о том, что вы открыли и прочитали его сообщения</div>
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

          <div class="settings-switch-row" onClick=${() => updateClientSettings({ previewInList: settings.previewInList === false })}>
            <div class="plugin-copy">
              <div class="plugin-title">Показывать превью сообщений в списке чатов</div>
              <div class="plugin-sub">Отключите, чтобы скрыть последние реплики на главном экране от посторонних глаз</div>
            </div>
            <button type="button" class=${`ios-switch ${settings.previewInList !== false ? 'on' : ''}`}><span></span></button>
          </div>

          <div class="settings-switch-row" onClick=${() => updateClientSettings({ acceptAnonGateway: settings.acceptAnonGateway === false })}>
            <div class="plugin-copy">
              <div class="plugin-title">Принимать сообщения через внешний E2E-шлюз (/q/${me?.username})</div>
              <div class="plugin-sub">Позволяет отправлять вам зашифрованные обращения через браузер без регистрации</div>
            </div>
            <button type="button" class=${`ios-switch ${settings.acceptAnonGateway !== false ? 'on' : ''}`}><span></span></button>
          </div>

          <div class="settings-switch-row" onClick=${() => updateClientSettings({ strictBossWipe: !settings.strictBossWipe })}>
            <div class="plugin-copy">
              <div class="plugin-title">Экстренная выгрузка ключей сессий из ОЗУ при блокировке</div>
              <div class="plugin-sub">Очищает кеш расшифрованных ключей в CryptoWorker при двойном нажатии Esc</div>
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

        <label class="field-label">Заголовок вкладки/окна в режиме маскировки</label>
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
      </div>`}

      <!-- 4. КРИПТОГРАФИЯ, MESH И МАРШРУТИЗАЦИЯ -->
      ${showSection(
        'network',
        'криптография сеть mesh паддинг выравнивание 256 512 1024 2048 4096 cover шумовой трафик синхронизация опрос webrtc turn stun ip relay tor onion i2p прокси socks5 сервер ящик'
      ) && html`<div class="studio-card">
        <div class="studio-card-head">
          <h3><${Icon} name="radar" size=${16} /> Криптоядро, выравнивание пакетов и маршрутизация</h3>
        </div>

        <label class="field-label">Квант выравнивания конвертов ISO/IEC 7816-4 (защита от анализа длины)</label>
        <div class="chip-grid">
          ${[
            [256, '256 Б (эконом)'],
            [512, '512 Б (стандарт)'],
            [1024, '1024 Б'],
            [2048, '2048 Б'],
            [4096, '4096 Б (макс. маскировка)'],
          ].map(([bytes, lbl]) => html`<button
            key=${bytes}
            type="button"
            class=${`choice-chip ${Number(settings.paddingBlockBytes || 512) === bytes ? 'active' : ''}`}
            onClick=${() => updateClientSettings({ paddingBlockBytes: bytes })}
          >${lbl}</button>`)}
        </div>

        <label class="field-label">Интервал фоновой синхронизации слепого ящика и досылки очереди</label>
        <div class="chip-grid">
          ${[
            [3, '3 сек (мгновенно)'],
            [6, '6 сек (оптимально)'],
            [15, '15 сек'],
            [30, '30 сек (экономия заряда)'],
          ].map(([sec, lbl]) => html`<button
            key=${sec}
            type="button"
            class=${`choice-chip ${Number(settings.syncIntervalSec || 6) === sec ? 'active' : ''}`}
            onClick=${() => updateClientSettings({ syncIntervalSec: sec })}
          >${lbl}</button>`)}
        </div>

        <label class="field-label">Политика кандидатов WebRTC ICE при P2P-соединении и звонках</label>
        <div class="chip-grid">
          ${[
            ['all', 'Прямой P2P + TURN (минимальная задержка)'],
            ['relay', 'Только через TURN-ретранслятор (скрывать IP от пира)'],
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
              <div class="plugin-sub">Генерирует неотличимые холостые пакеты против временной корреляции</div>
            </div>
            <button type="button" class=${`ios-switch ${settings.coverTraffic ? 'on' : ''}`}><span></span></button>
          </div>

          ${android.isApk && html`<div class="settings-switch-row" onClick=${toggleAndroidLanMesh}>
            <div class="plugin-copy">
              <div class="plugin-title">Локальный Mesh-ретранслятор Wi-Fi LAN</div>
              <div class="plugin-sub">
                ${android.lanMeshRunning && android.lanUrl
                  ? `Активен локальный узел ${android.lanUrl}`
                  : 'Прямой обмен между смартфонами в одной Wi-Fi сети без интернета (:3000)'}
              </div>
            </div>
            <button type="button" class=${`ios-switch ${android.lanMeshRunning ? 'on' : ''}`}><span></span></button>
          </div>`}
        </div>

        ${settings.coverTraffic && html`<div>
          <label class="field-label">Период отправки шумовых Cover-пакетов</label>
          <div class="chip-grid">
            ${[
              [10, 'Каждые 10 сек'],
              [25, 'Каждые 25 сек'],
              [60, 'Каждые 60 сек'],
            ].map(([sec, lbl]) => html`<button
              key=${sec}
              type="button"
              class=${`choice-chip ${Number(settings.coverIntervalSec || 25) === sec ? 'active' : ''}`}
              onClick=${() => updateClientSettings({ coverIntervalSec: sec })}
            >${lbl}</button>`)}
          </div>
        </div>`}

        <label class="field-label">Быстрый выбор узла ретрансляции</label>
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
          >Встроенный локальный узел</button>
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
            <label class="field-label">Локальный мост SOCKS5 (Orbot / I2Pd)</label>
            <input
              class="field-input"
              type="text"
              placeholder="ws://127.0.0.1:27700"
              value=${localBridgeUrl}
              onInput=${(e) => setLocalBridgeUrl(e.target.value)}
            />
          </div>
          <div>
            <label class="field-label">Сервер STUN для WebRTC</label>
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
          <button type="button" class="btn-ghost compact" onClick=${rotateBlindMailbox}>
            Ротировать ящик
          </button>
          <button type="button" class="btn-primary compact" onClick=${onSaveNetwork}>
            Применить сеть
          </button>
        </div>
      </div>`}

      <!-- 5. ЗВУК, УВЕДОМЛЕНИЯ И ТАКТИЛЬНЫЙ ОТКЛИК -->
      ${showSection(
        'sound',
        'звук уведомления оповещения фоновые android аудио синтезатор мелодия кристалл импульс сонар мягкий вибрация отклик haptics'
      ) && html`<div class="studio-card">
        <div class="studio-card-head">
          <h3><${Icon} name="volume" size=${16} /> Системные уведомления, звук и виброотклик</h3>
        </div>

        <label class="field-label">Приватность текста фоновых уведомлений ОС</label>
        <div class="chip-grid">
          ${[
            ['full', 'Имя и текст'],
            ['sender', 'Только имя'],
            ['stealth', 'Скрытно (без имён)'],
            ['off', 'Выключены'],
          ].map(([id, lbl]) => html`<button
            key=${id}
            type="button"
            class=${`choice-chip ${(settings.notificationContent || 'sender') === id ? 'active' : ''}`}
            onClick=${() => updateClientSettings({ notificationContent: id })}
          >${lbl}</button>`)}
          <button type="button" class="btn-ghost compact" onClick=${requestSystemNotificationAccess}>
            Разрешить в ОС
          </button>
        </div>

        <div class="settings-rows-list">
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
              <div class="plugin-sub">Короткий акустический подтверждающий импульс при доставке в конверт</div>
            </div>
            <button type="button" class=${`ios-switch ${settings.outgoingSound !== false ? 'on' : ''}`}><span></span></button>
          </div>
        </div>

        <label class="field-label">Акустический профиль синтезатора</label>
        <div class="chip-grid">
          ${[
            ['crystal', 'Кристалл'],
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
          <button
            type="button"
            class="btn-ghost compact"
            onClick=${() => playSfx('incoming', settings.soundProfile || 'crystal')}
          >Прослушать</button>
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
      </div>`}

      <!-- 6. ПАМЯТЬ, ЗАШИФРОВАННЫЙ БЭКАП И ОБНОВЛЕНИЯ -->
      ${showSection(
        'storage',
        'память хранилище кеш база очистить история резервная копия бэкап экспорт импорт aes pbkdf2 обновление github apk сброс ключи выход'
      ) && html`<div class="studio-card">
        <div class="studio-card-head">
          <h3><${Icon} name="database" size=${16} /> Локальное хранилище и зашифрованный резерв</h3>
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
            <b>${formatBytes(stats.approxBytes)}</b>
            <span>База E2EE</span>
          </div>
        </div>

        <div class="studio-actions" style="justify-content:flex-start">
          <button type="button" class="btn-ghost compact" onClick=${clearDecryptedMediaCache}>
            Освободить медиа из ОЗУ
          </button>
          <button type="button" class="btn-ghost compact" onClick=${clearAllMessagesHistory}>
            <${Icon} name="trash" size=${13} /> Очистить историю чатов
          </button>
        </div>

        <label class="field-label">Резервная копия истории, контактов и настроек (AES-256-GCM + PBKDF2 210k)</label>
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
      </div>`}

      ${showSection(
        'storage',
        'обновление github apk версия сборка сброс заводские ключи выход устройство'
      ) && html`<div class="studio-card">
        <div class="studio-card-head">
          <h3><${Icon} name="download" size=${16} /> Автообновление через GitHub Releases</h3>
        </div>
        <div class="settings-rows-list">
          <div class="settings-switch-row" onClick=${() => updateClientSettings({ autoUpdateCheck: settings.autoUpdateCheck === false })}>
            <div class="plugin-copy">
              <div class="plugin-title">Фоновая проверка новых релизов GitHub</div>
              <div class="plugin-sub">Автоматически отключается в строгих анонимных режимах Tor-Only и I2P-Only</div>
            </div>
            <button type="button" class=${`ios-switch ${settings.autoUpdateCheck !== false ? 'on' : ''}`}><span></span></button>
          </div>
        </div>
        <p class="modal-desc">
          Пакет <code>${android.packageName}</code> (v${APP_VERSION}, build ${APP_VERSION_CODE}) подписан постоянным
          сертификатом релиза и обновляется поверх установленной версии с сохранением аккаунта и чатов.
        </p>
        <div class="studio-actions">
          <button
            type="button"
            class="btn-ghost compact"
            disabled=${update.checking}
            onClick=${() => checkForUpdates({ silent: false })}
          >
            <${Icon} name="refresh" size=${14} /> ${update.checking ? 'Проверка…' : 'Проверить релизы'}
          </button>
          <button type="button" class="btn-primary compact" onClick=${applyAppUpdate}>
            <${Icon} name="download" size=${14} /> ${update.available ? `Установить v${update.remoteVersion}` : 'Скачать актуальный APK'}
          </button>
        </div>
      </div>`}

      ${showSection(
        'storage',
        'сброс настройки опасная зона стереть ключи выйти удалить аккаунт устройство'
      ) && html`<div class="studio-card danger-zone">
        <div class="studio-card-head">
          <h3><${Icon} name="key" size=${16} /> Сброс параметров и ключи устройства</h3>
        </div>
        <p class="modal-desc">
          Вы можете сбросить все визуальные и сетевые параметры к стандартным без потери аккаунта, либо полностью
          уничтожить ключи на этом устройстве.
        </p>
        <div class="studio-actions" style="justify-content:space-between">
          <button type="button" class="btn-ghost compact" onClick=${resetAllSettingsToDefaults}>
            Сбросить настройки (сохранить аккаунт)
          </button>
          ${!wipeConfirm
            ? html`<button type="button" class="btn-danger compact" onClick=${() => setWipeConfirm(true)}>
                Стереть ключи и выйти…
              </button>`
            : html`<div class="wipe-confirm-row">
                <button type="button" class="btn-ghost compact" onClick=${() => setWipeConfirm(false)}>Отмена</button>
                <button type="button" class="btn-danger compact" onClick=${logoutAndWipeDevice}>
                  Подтвердить уничтожение
                </button>
              </div>`}
        </div>
      </div>`}
    </div>
  </section>`;
}
