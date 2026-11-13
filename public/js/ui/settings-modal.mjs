// Модальные окна безопасности и управления сетью:
//   1. Переключатель транспортов (Авто / Только Tor / Только I2P / Прямой WSS / P2P Mesh) + Cover Traffic.
//   2. Сверка ключей безопасности Signal (8 эмодзи + 60 цифр + матричный отпечаток).
//   3. Создание нового X3DH-чата, просмотр одноразового медиа и сохранение Recovery Key.

import { html, useState } from '../../vendor/preact.mjs';
import { TRANSPORT_POLICY } from '../transport/transport-interface.mjs';
import {
  store,
  APP_VERSION,
  notifyStore,
  startChatWithUsername,
  markPeerVerified,
  updateClientSettings,
  toggleAndroidLanMesh,
  checkForUpdates,
  applyAppUpdate,
  rotateBlindMailbox,
  logoutAndWipeDevice,
  showToast,
} from '../store/app-store.mjs';
import { Icon } from './boss-screen.mjs';

const POLICY_OPTIONS = [
  {
    id: TRANSPORT_POLICY.AUTO,
    title: 'Автоматический мультитранспорт',
    desc: 'Прямой WSS -> P2P WebRTC -> Tor (.onion) -> I2P при блокировках или деградации сети.',
  },
  {
    id: TRANSPORT_POLICY.TOR_ONLY,
    title: 'Только Tor (.onion) · Fail-Closed',
    desc: 'Жёсткая блокировка любых прямых соединений. Даже при падении Tor реальный IP не утечёт.',
  },
  {
    id: TRANSPORT_POLICY.I2P_ONLY,
    title: 'Только I2P (.b32.i2p) · Fail-Closed',
    desc: 'Работа исключительно через скрытый туннель I2P (браузер с прокси или локальный мост).',
  },
  {
    id: TRANSPORT_POLICY.P2P_FIRST,
    title: 'Приоритет P2P Mesh (WebRTC)',
    desc: 'Прямая передача пакетов между устройствами мимо сервера после сигналинга.',
  },
  {
    id: TRANSPORT_POLICY.DIRECT_ONLY,
    title: 'Только прямое соединение (WSS)',
    desc: 'Минимальная задержка для повседневного использования.',
  },
];

function closeModal() {
  if (store.ui.modal === 'once-viewer' && store.ui.modalData?.url) {
    URL.revokeObjectURL(store.ui.modalData.url);
  }
  store.ui.modal = null;
  store.ui.modalData = null;
  notifyStore();
}

export function ModalLayer() {
  const { ui, recoveryModalKey } = store;

  if (recoveryModalKey) {
    return html`<div class="modal-backdrop">
      <div class="modal-card">
        <div class="modal-head">
          <h3>Сохраните ваш Ключ восстановления</h3>
        </div>
        <p class="modal-desc">
          Приватные ключи на этом устройстве созданы с флагом <code>extractable=false</code>.
          Если вы потеряете устройство, восстановить личность можно <b>только</b> этим 256-битным ключом
          (на сервере он неизвестен):
        </p>
        <div class="recovery-box">${recoveryModalKey}</div>
        <div class="modal-actions">
          <button
            type="button"
            class="btn-ghost"
            onClick=${() => {
              navigator.clipboard?.writeText(recoveryModalKey).catch(() => {});
              showToast('Ключ восстановления скопирован');
            }}
          >Скопировать</button>
          <button
            type="button"
            class="btn-primary"
            onClick=${() => { store.recoveryModalKey = null; notifyStore(); }}
          >Я сохранил ключ в надёжном месте</button>
        </div>
      </div>
    </div>`;
  }

  if (!ui.modal) return null;

  if (ui.modal === 'new-chat') {
    return html`<${NewChatModal} />`;
  }
  if (ui.modal === 'safety') {
    return html`<${SafetyModal} data=${ui.modalData} />`;
  }
  if (ui.modal === 'settings') {
    return html`<${SettingsModal} />`;
  }
  if (ui.modal === 'once-viewer') {
    const d = ui.modalData || {};
    return html`<div class="modal-backdrop" onClick=${closeModal}>
      <div class="modal-card wide" onClick=${(e) => e.stopPropagation()}>
        <div class="modal-head">
          <h3>🔥 Одноразовый просмотр (файл уже стёрт с сервера)</h3>
          <button type="button" class="icon-btn" onClick=${closeModal}><${Icon} name="close" /></button>
        </div>
        <div class="once-preview-box">
          ${d.mime?.startsWith('image/')
            ? html`<img src=${d.url} alt="Одноразовое фото" />`
            : html`<a class="btn-primary" href=${d.url} download=${d.name || 'once.bin'}>Сохранить расшифрованный файл</a>`}
        </div>
      </div>
    </div>`;
  }
  if (ui.modal === 'call') {
    const chat = ui.modalData?.chat;
    return html`<div class="modal-backdrop" onClick=${closeModal}>
      <div class="modal-card" onClick=${(e) => e.stopPropagation()}>
        <div class="modal-head">
          <h3>Зашифрованный P2P-вызов · ${chat?.title}</h3>
          <button type="button" class="icon-btn" onClick=${closeModal}><${Icon} name="close" /></button>
        </div>
        <p class="modal-desc">
          Голосовой поток шифруется по DTLS-SRTP. Эфемерный пароль TURN выдаётся сервером ровно на 300 секунд
          с обезличенным логином. В режиме «Только Tor» прямой ICE отключён для защиты IP.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn-primary" onClick=${closeModal}>Завершить</button>
        </div>
      </div>
    </div>`;
  }

  return null;
}

function NewChatModal() {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || loading) return;
    setLoading(true);
    try {
      await startChatWithUsername(username);
      closeModal();
    } catch (err) {
      showToast(err.message, 'err');
    } finally {
      setLoading(false);
    }
  };

  return html`<div class="modal-backdrop" onClick=${closeModal}>
    <form class="modal-card" onClick=${(e) => e.stopPropagation()} onSubmit=${submit}>
      <div class="modal-head">
        <h3>Новый зашифрованный диалог (X3DH)</h3>
        <button type="button" class="icon-btn" onClick=${closeModal}><${Icon} name="close" /></button>
      </div>
      <p class="modal-desc">
        Введите <code>@username</code> собеседника. Клиент скачает его подписанный PreKeyBundle,
        проверит подпись ECDSA и установит сессию Double Ratchet.
      </p>
      <input
        class="field-input"
        type="text"
        placeholder="@username"
        autofocus
        value=${username}
        onInput=${(e) => setUsername(e.target.value)}
      />
      <div class="modal-actions">
        <button type="button" class="btn-ghost" onClick=${closeModal}>Отмена</button>
        <button type="submit" class="btn-primary" disabled=${loading}>
          ${loading ? 'Установка X3DH…' : 'Открыть защищённый чат'}
        </button>
      </div>
    </form>
  </div>`;
}

function SafetyModal({ data }) {
  if (!data?.safetyNumber) return null;
  const { chatId, chat, safetyNumber } = data;

  return html`<div class="modal-backdrop" onClick=${closeModal}>
    <div class="modal-card" onClick=${(e) => e.stopPropagation()}>
      <div class="modal-head">
        <h3>Сверка ключей с ${chat.title}</h3>
        <button type="button" class="icon-btn" onClick=${closeModal}><${Icon} name="close" /></button>
      </div>
      <p class="modal-desc">
        Сравните 8 эмодзи или 60 цифр с собеседником по независимому каналу или лично (5200 раундов SHA-512).
        Если они совпадают — атака MITM математически исключена.
      </p>

      <div class="safety-emojis">${safetyNumber.emojis.map((e) => html`<span>${e}</span>`)}</div>

      <div class="safety-digits-grid">
        ${safetyNumber.blocks.map((b) => html`<code>${b}</code>`)}
      </div>

      <div class="safety-qr-str">
        <span>Отпечаток QR:</span>
        <code>${safetyNumber.qrPayload}</code>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-ghost" onClick=${closeModal}>Закрыть</button>
        <button
          type="button"
          class="btn-primary"
          onClick=${() => markPeerVerified(chatId, !chat.verified)}
        >${chat.verified ? 'Снять отметку проверки' : '✓ Ключи совпадают'}</button>
      </div>
    </div>
  </div>`;
}

function SettingsModal() {
  const { settings, me, android, update } = store;
  const [serverUrl, setServerUrl] = useState(settings.serverUrl || '');
  const [onionUrl, setOnionUrl] = useState(settings.onionUrl || '');
  const [i2pUrl, setI2pUrl] = useState(settings.i2pUrl || '');

  return html`<div class="modal-backdrop" onClick=${closeModal}>
    <div class="modal-card wide" onClick=${(e) => e.stopPropagation()}>
      <div class="modal-head">
        <h3>MeshChat · Транспорты, Узел и Обновления</h3>
        <button type="button" class="icon-btn" onClick=${closeModal}><${Icon} name="close" /></button>
      </div>

      <div class="settings-update-panel">
        <div class="settings-update-info">
          <div class="settings-update-ver">
            <b>MeshChat v${APP_VERSION}</b>
            <span class=${`ver-status-pill ${update?.available ? 'has-update' : ''}`}>
              ${update?.available ? `Доступна v${update.remoteVersion}` : 'Актуальная версия'}
            </span>
          </div>
          <span>
            ${update?.downloading
              ? (update.statusText || `Скачивание обновления: ${update.progress}%…`)
              : 'Автообновление по каналу узла и GitHub Releases (SHA-256)'}
          </span>
        </div>
        ${update?.available
          ? html`<button type="button" class="btn-primary compact" disabled=${update.downloading} onClick=${applyAppUpdate}>
              <${Icon} name="download" size=${14} /> ${update.downloading ? `${update.progress}%` : 'Обновить'}
            </button>`
          : html`<button type="button" class="btn-ghost compact" disabled=${update?.checking} onClick=${() => checkForUpdates({ silent: false })}>
              <${Icon} name="refresh" size=${14} /> ${update?.checking ? 'Проверка…' : 'Проверить'}
            </button>`}
      </div>

      <div style="margin-bottom:12px">
        <label class="field-label">Адрес узла MeshChat (пусто = текущий/встроенный узел)</label>
        <input
          class="field-input"
          type="text"
          placeholder="https://meshchat.onrender.com, http://192.168.1.5:3000 или http://...onion"
          value=${serverUrl}
          onInput=${(e) => setServerUrl(e.target.value)}
          onBlur=${() => updateClientSettings({ serverUrl })}
        />
      </div>

      <div class="settings-section-title">Режим маршрутизации трафика</div>
      <div class="policy-list">
        ${POLICY_OPTIONS.map((opt) => html`<label
          key=${opt.id}
          class=${`policy-card ${settings.transportPolicy === opt.id ? 'selected' : ''}`}
          onClick=${() => updateClientSettings({ transportPolicy: opt.id })}
        >
          <input type="radio" name="policy" checked=${settings.transportPolicy === opt.id} />
          <div>
            <b>${opt.title}</b>
            <span>${opt.desc}</span>
          </div>
        </label>`)}
      </div>

      <div class="settings-grid-2">
        <div>
          <label class="field-label">Адрес зеркала Tor (.onion)</label>
          <input
            class="field-input"
            type="text"
            placeholder="ws://v3address.onion/ws"
            value=${onionUrl}
            onInput=${(e) => setOnionUrl(e.target.value)}
            onBlur=${() => updateClientSettings({ onionUrl })}
          />
        </div>
        <div>
          <label class="field-label">Адрес туннеля I2P (.b32.i2p)</label>
          <input
            class="field-input"
            type="text"
            placeholder="ws://address.b32.i2p/ws"
            value=${i2pUrl}
            onInput=${(e) => setI2pUrl(e.target.value)}
            onBlur=${() => updateClientSettings({ i2pUrl })}
          />
        </div>
      </div>

      <div class="settings-toggles">
        ${android?.isApk && html`<div class="insp-row" onClick=${toggleAndroidLanMesh}>
          <span class="insp-label">
            📡 Локальный Wi-Fi Mesh-ретранслятор для соседних телефонов ${android.lanMeshRunning && android.lanUrl ? `(${android.lanUrl})` : '(:3000)'}
          </span>
          <span class=${`ios-switch ${android.lanMeshRunning ? 'on' : ''}`}><i></i></span>
        </div>`}
        <div class="insp-row" onClick=${() => updateClientSettings({ autoUpdateCheck: settings.autoUpdateCheck === false })}>
          <span class="insp-label">Автоматическая проверка обновлений (отключается в Tor-Only)</span>
          <span class=${`ios-switch ${settings.autoUpdateCheck !== false ? 'on' : ''}`}><i></i></span>
        </div>
        <div class="insp-row" onClick=${() => updateClientSettings({ coverTraffic: !settings.coverTraffic })}>
          <span class="insp-label">Шумовой Cover Traffic (512 Б в простое против анализа трафика)</span>
          <span class=${`ios-switch ${settings.coverTraffic ? 'on' : ''}`}><i></i></span>
        </div>
        <div class="insp-row" onClick=${() => updateClientSettings({ strictBossWipe: !settings.strictBossWipe })}>
          <span class="insp-label">Жёсткое «Прикрыться»: затирать RAM-кеш ключей при Esc Esc</span>
          <span class=${`ios-switch ${settings.strictBossWipe ? 'on' : ''}`}><i></i></span>
        </div>
      </div>

      <div class="settings-footer-actions">
        <button type="button" class="btn-ghost" onClick=${rotateBlindMailbox}>
          <${Icon} name="refresh" size=${15} /> Сменить адрес слепого ящика (${me?.mailboxId?.slice(0, 10)}…)
        </button>
        <button type="button" class="btn-danger" onClick=${logoutAndWipeDevice}>
          Выйти и стереть ключи с устройства
        </button>
      </div>
    </div>
  </div>`;
}
