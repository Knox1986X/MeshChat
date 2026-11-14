// Корневой макет MeshChat v1.3: экран однократной Zero-Knowledge регистрации/входа
// и 5-раздельный интерфейс (Чаты, Контакты, Mesh, Профиль, Настройки) для Desktop и Android APK.

import { html, useState } from '../../vendor/preact.mjs';
import {
  store,
  useAppStore,
  APP_VERSION,
  DEFAULT_CLOUD_URL,
  registerAccount,
  loginAccount,
  toggleBossMode,
  updateClientSettings,
  toggleAndroidLanMesh,
  uninstallLegacyApk,
  applyAppUpdate,
  dismissUpdateBanner,
  dismissToast,
  setNavTab,
} from '../store/app-store.mjs';
import { Sidebar } from './sidebar.mjs';
import { ChatView } from './chat-view.mjs';
import { InspectorPanel } from './inspector-panel.mjs';
import { MeshView } from './mesh-view.mjs';
import { ProfileView, ContactsView } from './profile-view.mjs';
import { SettingsScreen, PinLockOverlay } from './settings-screen.mjs';
import { ModalLayer } from './settings-modal.mjs';
import { BossScreen, Icon } from './boss-screen.mjs';
import { AtmosphereLayer } from './atmosphere-layer.mjs';

const NAV_ITEMS = [
  { id: 'chats', label: 'Чаты', icon: 'chat' },
  { id: 'contacts', label: 'Контакты', icon: 'users' },
  { id: 'mesh', label: 'Mesh', icon: 'radar' },
  { id: 'profile', label: 'Профиль', icon: 'user' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];

export function UpdateBanner({ update }) {
  if (!update?.available || update.dismissed) return null;
  return html`<div class="update-banner">
    <div class="update-banner-row">
      <div class="update-badge-icon"><${Icon} name="download" size=${15} /></div>
      <div class="update-banner-copy">
        <b>Доступно обновление MeshChat v${update.remoteVersion || APP_VERSION}</b>
        <span>${update.downloading ? (update.statusText || `Загрузка ${update.progress}%`) : 'Подписанный релиз GitHub (SHA-256)'}</span>
      </div>
      ${!update.downloading && html`<button type="button" class="btn-update-now" onClick=${applyAppUpdate}>
        Установить
      </button>`}
      ${!update.downloading && html`<button type="button" class="icon-btn small" title="Скрыть" onClick=${dismissUpdateBanner}>
        <${Icon} name="close" size=${13} />
      </button>`}
    </div>
    ${update.downloading && html`<div class="update-progress-track">
      <div class="update-progress-fill" style=${`width:${Math.max(5, update.progress || 10)}%`}></div>
    </div>`}
  </div>`;
}

function AuthScreen() {
  const { busy, authError, settings, android, update } = useAppStore();
  const [mode, setMode] = useState('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [needRecoveryField, setNeedRecoveryField] = useState(false);
  const [serverUrl, setServerUrl] = useState(settings.serverUrl || '');
  const [showNodeBox, setShowNodeBox] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (serverUrl !== settings.serverUrl) {
      await updateClientSettings({ serverUrl });
    }
    if (mode === 'register') {
      await registerAccount({ username, password });
    } else {
      await loginAccount({ username, password, recoveryKey });
      const latestErr = store.authError || '';
      if (
        latestErr.includes('Recovery') ||
        latestErr.includes('восстановлен') ||
        latestErr.includes('новом устройстве')
      ) {
        setNeedRecoveryField(true);
      }
    }
  };

  return html`<div class="auth-backdrop">
    <${AtmosphereLayer} />
    <div class="auth-card">
      <${UpdateBanner} update=${update} />

      ${android?.legacyInstalled && html`<div class="update-banner" style="margin-bottom:12px">
        <div class="update-banner-row">
          <div class="update-banner-copy">
            <b>Найдена устаревшая копия MeshChat v1.2</b>
            <span>Удалите старый ярлык, чтобы остался один обновляемый пакет</span>
          </div>
          <button type="button" class="btn-update-now" onClick=${uninstallLegacyApk}>Удалить v1.2</button>
        </div>
      </div>`}

      <div class="auth-brand">
        <div class="auth-logo"><${Icon} name="mesh" size=${26} /></div>
        <div class="auth-brand-text">
          <div class="auth-title-row">
            <h1>MeshChat</h1>
            <span class="version-chip">v${APP_VERSION}</span>
          </div>
          <span>X3DH · Double Ratchet · Sealed Sender · Постоянная ZK-сессия</span>
        </div>
        <button
          type="button"
          class="square-action-btn festive-trigger-btn"
          style="margin-left:auto"
          title="Новогодняя атмосфера, снежинки и градиенты"
          onClick=${() => { store.ui.modal = 'atmosphere'; store.ui.modalData = null; store.busy = store.busy; updateClientSettings({}); }}
        ><${Icon} name="snowflake" size=${17} /></button>
      </div>

      <div class="auth-tabs">
        <button
          type="button"
          class=${mode === 'register' ? 'active' : ''}
          onClick=${() => setMode('register')}
        >Создать аккаунт</button>
        <button
          type="button"
          class=${mode === 'login' ? 'active' : ''}
          onClick=${() => setMode('login')}
        >Вход (Zero-Knowledge)</button>
      </div>

      <form onSubmit=${onSubmit} class="auth-form">
        <label class="field-label">Имя пользователя (@username)</label>
        <input
          class="field-input"
          type="text"
          required
          minLength="3"
          maxLength="32"
          placeholder="vegas_01"
          value=${username}
          onInput=${(e) => setUsername(e.target.value)}
        />

        <label class="field-label">Пароль защиты ключа (Argon2id 64 МиБ, локально)</label>
        <input
          class="field-input"
          type="password"
          required
          minLength="8"
          placeholder="Минимум 8 символов (локально)"
          value=${password}
          onInput=${(e) => setPassword(e.target.value)}
        />

        ${mode === 'login' && (needRecoveryField || authError?.includes('Recovery Key')) && html`<div>
          <label class="field-label">Ключ восстановления (для нового устройства)</label>
          <input
            class="field-input"
            type="text"
            placeholder="XXXX-XXXX-..."
            value=${recoveryKey}
            onInput=${(e) => setRecoveryKey(e.target.value)}
          />
        </div>`}

        ${authError && html`<div class="auth-error">${authError}</div>`}

        <div style="margin-top:4px">
          <button
            type="button"
            class="link-btn"
            onClick=${() => setShowNodeBox(!showNodeBox)}
          >${showNodeBox ? '▾ Скрыть параметры узла ретрансляции' : '▸ Узел ретрансляции (Облако / LAN / .onion)'}</button>
          ${showNodeBox && html`<div class="node-config-box">
            <div class="node-preset-row">
              <button
                type="button"
                class="btn-ghost compact"
                onClick=${() => { setServerUrl(DEFAULT_CLOUD_URL); updateClientSettings({ serverUrl: DEFAULT_CLOUD_URL }); }}
              ><${Icon} name="globe" size=${13} /> Узел EU</button>
              <button
                type="button"
                class="btn-ghost compact"
                onClick=${() => { setServerUrl(''); updateClientSettings({ serverUrl: '' }); }}
              ><${Icon} name="server" size=${13} /> Локальный узел</button>
            </div>
            <label class="field-label">URL сервера ретрансляции</label>
            <input
              class="field-input"
              type="text"
              placeholder="https://meshchat-6a11.onrender.com или .onion"
              value=${serverUrl}
              onInput=${(e) => setServerUrl(e.target.value)}
              onBlur=${() => updateClientSettings({ serverUrl })}
            />
            ${android?.isApk && html`<div class="insp-row" style="margin-top:8px;padding:4px 0" onClick=${toggleAndroidLanMesh}>
              <span class="insp-label" style="font-size:12px">
                Локальный узел Wi-Fi LAN ${android.lanMeshRunning && android.lanUrl ? `(${android.lanUrl})` : '(:3000)'}
              </span>
              <span class=${`ios-switch ${android.lanMeshRunning ? 'on' : ''}`}><span></span></span>
            </div>`}
          </div>`}
        </div>

        <button type="submit" class="btn-primary full" disabled=${busy}>
          ${busy
            ? 'Генерация ключей P-256 + Argon2id…'
            : mode === 'register'
              ? 'Создать ключи (один раз навсегда)'
              : 'Подтвердить подпись ECDSA и войти'}
        </button>

        ${mode === 'login' && !needRecoveryField && html`<button
          type="button"
          class="text-link-btn"
          onClick=${() => setNeedRecoveryField(true)}
        >Вход на новом устройстве? Ввести ключ восстановления</button>`}
      </form>

      <ul class="auth-guarantees">
        <li><b>Без повторной регистрации:</b> ключи сохраняются в защищённом хранилище устройства и автоматически обновляют сессию после перезапусков и обновлений.</li>
        <li><b>Zero-Knowledge E2EE:</b> пароль и приватные ключи никогда не покидают устройство.</li>
      </ul>
    </div>
  </div>`;
}

export function AppRoot() {
  const s = useAppStore();

  if (s.booting) {
    return html`<div class="boot-loader">
      <div class="spinner"></div>
      <span>Запуск криптоядра MeshChat…</span>
    </div>`;
  }

  if (s.ui.bossActive) {
    return html`<${BossScreen}
      title=${s.settings.bossDocTitle}
      template=${s.settings.bossTemplate || 'xlsx'}
      onExit=${() => toggleBossMode(false)}
    />`;
  }

  if (!s.me) {
    return html`<div>
      <${AuthScreen} />
      <${ModalLayer} />
    </div>`;
  }

  if (s.ui.pinLocked && s.settings.pinHashB64) {
    return html`<div>
      <${AtmosphereLayer} />
      <${PinLockOverlay} />
    </div>`;
  }

  const totalUnread = Object.values(s.chats).reduce((sum, c) => sum + (c.unread || 0), 0);
  const navTab = s.ui.navTab || 'chats';
  const hideBottomNavOnMobile = navTab === 'chats' && Boolean(s.ui.activeChatId);

  return html`<div class="app-shell">
    <${AtmosphereLayer} />
    <div class=${`app-window ${hideBottomNavOnMobile ? 'chat-open-mobile' : ''}`}>
      <!-- Боковая навигационная рейка для ПК / планшетов -->
      <nav class="desktop-nav-rail" aria-label="Разделы">
        <div class="rail-brand" title=${`MeshChat v${APP_VERSION}`}>
          <${Icon} name="mesh" size=${22} />
        </div>
        <div class="rail-items">
          ${NAV_ITEMS.map((item) => html`<button
            key=${item.id}
            type="button"
            class=${`rail-btn ${navTab === item.id ? 'active' : ''}`}
            title=${item.label}
            onClick=${() => setNavTab(item.id)}
          >
            <span class="rail-icon-wrap">
              <${Icon} name=${item.icon} size=${20} />
              ${item.id === 'chats' && totalUnread > 0 && html`<i class="nav-unread-dot">${totalUnread > 9 ? '9+' : totalUnread}</i>`}
              ${item.id === 'settings' && s.update?.available && html`<i class="nav-update-dot"></i>`}
            </span>
            <span class="rail-lbl">${item.label}</span>
          </button>`)}
        </div>
      </nav>

      <!-- Основное рабочее пространство в зависимости от выбранного раздела -->
      ${navTab === 'chats' && html`<div class="workspace-split">
        <${Sidebar} />
        <${ChatView} />
        <${InspectorPanel} />
      </div>`}

      ${navTab === 'contacts' && html`<div class="workspace-single">
        <${ContactsView} />
      </div>`}

      ${navTab === 'mesh' && html`<div class="workspace-single">
        <${MeshView} />
      </div>`}

      ${navTab === 'profile' && html`<div class="workspace-single">
        <${ProfileView} />
      </div>`}

      ${navTab === 'settings' && html`<div class="workspace-single">
        <${SettingsScreen} />
      </div>`}

      <!-- Нижняя 5-кнопочная навигация для мобильных устройств и Android APK -->
      <nav class=${`mobile-bottom-nav ${hideBottomNavOnMobile ? 'hidden' : ''}`} aria-label="Нижняя навигация">
        ${NAV_ITEMS.map((item) => html`<button
          key=${item.id}
          type="button"
          class=${`bottom-nav-btn ${navTab === item.id ? 'active' : ''}`}
          onClick=${() => setNavTab(item.id)}
        >
          <span class="bottom-nav-icon">
            <${Icon} name=${item.icon} size=${20} />
            ${item.id === 'chats' && totalUnread > 0 && html`<i class="nav-unread-dot">${totalUnread > 9 ? '9+' : totalUnread}</i>`}
            ${item.id === 'settings' && s.update?.available && html`<i class="nav-update-dot"></i>`}
          </span>
          <span class="bottom-nav-lbl">${item.label}</span>
        </button>`)}
      </nav>
    </div>

    <${ModalLayer} />

    <div class="toast-stack">
      ${s.ui.toasts.map((t) => html`<div
        key=${t.id}
        class=${`toast ${t.kind}`}
        onClick=${() => dismissToast(t.id)}
      >${t.text}</div>`)}
    </div>
  </div>`;
}
