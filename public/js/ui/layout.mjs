// Корневой макет клиента: экран Zero-Knowledge входа/регистрации + 3-колоночное рабочее окно.

import { html, useState } from '../../vendor/preact.mjs';
import {
  useAppStore,
  APP_VERSION,
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
      <div class="update-badge-icon"><${Icon} name="download" size=${16} /></div>
      <div class="update-banner-copy">
        <b>Доступен MeshChat v${update.remoteVersion || APP_VERSION}</b>
        <span>${update.downloading ? (update.statusText || `Загрузка ${update.progress}%…`) : 'Криптопроверка SHA-256 · обновление в 1 клик'}</span>
      </div>
      ${!update.downloading && html`<button type="button" class="btn-update-now" onClick=${applyAppUpdate}>
        Обновить
      </button>`}
      ${!update.downloading && html`<button type="button" class="icon-btn small" title="Отложить" onClick=${dismissUpdateBanner}>
        <${Icon} name="close" size=${14} />
      </button>`}
    </div>
    ${update.downloading && html`<div class="update-progress-track">
      <div class="update-progress-fill" style=${`width:${Math.max(5, update.progress || 10)}%`}></div>
    </div>`}
  </div>`;
}

function AuthScreen() {
  const { busy, authError, settings, android, update } = useAppStore();
  const [mode, setMode] = useState('register'); // 'register' | 'login'
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
        <div class="auth-logo"><${Icon} name="mesh" size=${28} /></div>
        <div class="auth-brand-text">
          <div class="auth-title-row">
            <h1>MeshChat</h1>
            <span class="version-chip">v${APP_VERSION}</span>
          </div>
          <span>Без телефона · Без email · Signal Protocol · P2P Mesh & Tor</span>
        </div>
      </div>

      <div class="auth-tabs">
        <button
          type="button"
          class=${mode === 'register' ? 'active' : ''}
          onClick=${() => setMode('register')}
        >Анонимная регистрация</button>
        <button
          type="button"
          class=${mode === 'login' ? 'active' : ''}
          onClick=${() => setMode('login')}
        >Zero-Knowledge Вход</button>
      </div>

      <form onSubmit=${onSubmit} class="auth-form">
        <label class="field-label">Псевдоним (@username)</label>
        <input
          class="field-input"
          type="text"
          required
          minLength="3"
          maxLength="32"
          placeholder="например, cipher_fox"
          value=${username}
          onInput=${(e) => setUsername(e.target.value)}
        />

        <label class="field-label">Пароль (обрабатывается локально через Argon2id 64 МБ)</label>
        <input
          class="field-input"
          type="password"
          required
          minLength="8"
          placeholder="Минимум 8 символов — на сервер не передаётся"
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
          >${showNodeBox ? '▾ Скрыть настройки узла MeshChat' : '▸ Выбрать сервер / Wi-Fi Mesh / .onion узел'}</button>
          ${showNodeBox && html`<div style="margin-top:8px;padding:10px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)">
            <label class="field-label">Адрес сервера MeshChat (пусто = встроенный локальный узел)</label>
            <input
              class="field-input"
              type="text"
              placeholder="https://node.onrender.com, http://192.168.1.5:3000 или .onion"
              value=${serverUrl}
              onInput=${(e) => setServerUrl(e.target.value)}
              onBlur=${() => updateClientSettings({ serverUrl })}
            />
            ${android?.isApk && html`<div class="insp-row" style="margin-top:8px;padding:4px 0" onClick=${toggleAndroidLanMesh}>
              <span class="insp-label" style="font-size:12px">
                📡 Раздавать Wi-Fi Mesh узел на телефоне ${android.lanMeshRunning && android.lanUrl ? `(${android.lanUrl})` : '(:3000)'}
              </span>
              <span class=${`ios-switch ${android.lanMeshRunning ? 'on' : ''}`}><i></i></span>
            </div>`}
          </div>`}
        </div>

        <button type="submit" class="btn-primary full" disabled=${busy}>
          ${busy
            ? 'Генерация ключей P-256 + Argon2id + Proof-of-Work…'
            : mode === 'register'
              ? 'Создать локальные ключи и войти'
              : 'Подписать challenge и войти'}
        </button>

        ${mode === 'login' && !needRecoveryField && html`<button
          type="button"
          class="text-link-btn"
          onClick=${() => setNeedRecoveryField(true)}
        >Входите с нового браузера/устройства? Ввести ключ восстановления</button>`}
      </form>

      <ul class="auth-guarantees">
        <li><b>Zero-Knowledge Auth:</b> пароль никогда не покидает ваш браузер.</li>
        <li><b>extractable = false:</b> ключи хранятся в IndexedDB внутри изолированного Web Worker.</li>
        <li><b>Sealed Sender:</b> сервер не хранит граф контактов и IP-адреса.</li>
      </ul>
    </div>
  </div>`;
}

export function AppRoot() {
  const s = useAppStore();

  if (s.booting) {
    return html`<div class="boot-loader">
      <div class="spinner"></div>
      <span>Открытие изолированного криптомодуля…</span>
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
