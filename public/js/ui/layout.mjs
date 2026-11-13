// Корневой макет клиента: экран Zero-Knowledge аутентификации и 3-панельный рабочий терминал.

import { html, useState } from '../../vendor/preact.mjs';
import {
  useAppStore,
  APP_VERSION,
  DEFAULT_CLOUD_URL,
  registerAccount,
  loginAccount,
  toggleBossMode,
  updateClientSettings,
  toggleAndroidLanMesh,
  applyAppUpdate,
  dismissUpdateBanner,
} from '../store/app-store.mjs';
import { Sidebar } from './sidebar.mjs';
import { ChatView } from './chat-view.mjs';
import { InspectorPanel } from './inspector-panel.mjs';
import { ModalLayer } from './settings-modal.mjs';
import { BossScreen, Icon } from './boss-screen.mjs';

export function UpdateBanner({ update }) {
  if (!update?.available || update.dismissed) return null;
  return html`<div class="update-banner">
    <div class="update-banner-row">
      <div class="update-badge-icon"><${Icon} name="download" size=${15} /></div>
      <div class="update-banner-copy">
        <b>Доступно обновление MeshChat v${update.remoteVersion || APP_VERSION}</b>
        <span>${update.downloading ? (update.statusText || `Загрузка ${update.progress}%`) : 'Верификация пакета по SHA-256'}</span>
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
  const [showNodeBox, setShowNodeBox] = useState(Boolean(android?.isApk || settings.serverUrl));

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
      if (authError?.includes('Recovery Key')) setNeedRecoveryField(true);
    }
  };

  return html`<div class="auth-backdrop">
    <div class="auth-card">
      <${UpdateBanner} update=${update} />

      <div class="auth-brand">
        <div class="auth-logo"><${Icon} name="mesh" size=${26} /></div>
        <div class="auth-brand-text">
          <div class="auth-title-row">
            <h1>MeshChat</h1>
            <span class="version-chip">v${APP_VERSION}</span>
          </div>
          <span>X3DH · Double Ratchet · Sealed Sender · P2P / Tor / I2P</span>
        </div>
      </div>

      <div class="auth-tabs">
        <button
          type="button"
          class=${mode === 'register' ? 'active' : ''}
          onClick=${() => setMode('register')}
        >Регистрация ключа</button>
        <button
          type="button"
          class=${mode === 'login' ? 'active' : ''}
          onClick=${() => setMode('login')}
        >Вход (Zero-Knowledge)</button>
      </div>

      <form onSubmit=${onSubmit} class="auth-form">
        <label class="field-label">Идентификатор (@username)</label>
        <input
          class="field-input"
          type="text"
          required
          minLength="3"
          maxLength="32"
          placeholder="operator_01"
          value=${username}
          onInput=${(e) => setUsername(e.target.value)}
        />

        <label class="field-label">Пароль (локальный вывод ключа Argon2id 64 МиБ)</label>
        <input
          class="field-input"
          type="password"
          required
          minLength="8"
          placeholder="Минимум 8 символов (не покидает устройство)"
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
            <label class="field-label">URL сервера ретрансляции (пусто = текущий узел)</label>
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
                Локальный ретранслятор Wi-Fi LAN ${android.lanMeshRunning && android.lanUrl ? `(${android.lanUrl})` : '(:3000)'}
              </span>
              <span class=${`ios-switch ${android.lanMeshRunning ? 'on' : ''}`}><i></i></span>
            </div>`}
          </div>`}
        </div>

        <button type="submit" class="btn-primary full" disabled=${busy}>
          ${busy
            ? 'Вычисление P-256 + Argon2id + Proof-of-Work…'
            : mode === 'register'
              ? 'Сгенерировать ключи и открыть сеанс'
              : 'Подтвердить подпись ECDSA и войти'}
        </button>

        ${mode === 'login' && !needRecoveryField && html`<button
          type="button"
          class="text-link-btn"
          onClick=${() => setNeedRecoveryField(true)}
        >Новое устройство? Ввести 256-битный ключ восстановления</button>`}
      </form>

      <ul class="auth-guarantees">
        <li><b>Zero-Knowledge:</b> пароль обрабатывается строго локально и не передаётся на сервер.</li>
        <li><b>extractable = false:</b> закрытые ключи изолированы внутри криптографического Web Worker.</li>
        <li><b>Слепая ретрансляция:</b> узел не располагает графом контактов и IP-адресами.</li>
      </ul>
    </div>
  </div>`;
}

export function AppRoot() {
  const s = useAppStore();

  if (s.booting) {
    return html`<div class="boot-loader">
      <div class="spinner"></div>
      <span>Инициализация криптографического модуля…</span>
    </div>`;
  }

  if (s.ui.bossActive) {
    return html`<${BossScreen}
      title=${s.settings.bossDocTitle}
      onExit=${() => toggleBossMode(false)}
    />`;
  }

  if (!s.me) {
    return html`<${AuthScreen} />`;
  }

  return html`<div class="app-shell">
    <div class="app-window">
      <${Sidebar} />
      <${ChatView} />
      <${InspectorPanel} />
    </div>
    <${ModalLayer} />

    <div class="toast-stack">
      ${s.ui.toasts.map((t) => html`<div key=${t.id} class=${`toast ${t.kind}`}>${t.text}</div>`)}
    </div>
  </div>`;
}
