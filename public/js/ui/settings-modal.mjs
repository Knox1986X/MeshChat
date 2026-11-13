// Модальные окна сетевых политик, верификации ключей безопасности и системных параметров:
//   1. Маршрутизация трафика (Авто / Tor Fail-Closed / I2P Fail-Closed / P2P Mesh / Прямой WSS).
//   2. Верификация отпечатка безопасности (128-бит HEX + 60 цифр SHA-512 × 5200).
//   3. Открытие диалога, однократный просмотр вложений [1×] и сохранение ключа восстановления.

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
    desc: 'Каскад WSS -> P2P WebRTC -> Tor (.onion) -> I2P при недоступности или деградации канала.',
  },
  {
    id: TRANSPORT_POLICY.TOR_ONLY,
    title: 'Только Tor (.onion) · Fail-Closed',
    desc: 'Блокировка любых прямых соединений. Исключает раскрытие IP-адреса при обрыве туннеля.',
  },
  {
    id: TRANSPORT_POLICY.I2P_ONLY,
    title: 'Только I2P (.b32.i2p) · Fail-Closed',
    desc: 'Маршрутизация исключительно через локальный шлюз или прокси сети I2P.',
  },
  {
    id: TRANSPORT_POLICY.P2P_FIRST,
    title: 'Приоритет P2P Mesh (WebRTC)',
    desc: 'Прямой обмен зашифрованными кадрами между узлами после обмена сигналами.',
  },
  {
    id: TRANSPORT_POLICY.DIRECT_ONLY,
    title: 'Прямой канал (WSS)',
    desc: 'Минимальная сетевая задержка без промежуточных прокси-цепочек.',
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
          <h3>Резервный ключ восстановления (256 бит)</h3>
        </div>
        <p class="modal-desc">
          Приватные ключи на этом устройстве созданы с аппаратно-программным ограничением <code>extractable=false</code>.
          При утрате устройства восстановление криптографической личности возможно <b>только</b> по данному ключу:
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
          >Копировать</button>
          <button
            type="button"
            class="btn-primary"
            onClick=${() => { store.recoveryModalKey = null; notifyStore(); }}
          >Ключ сохранён в защищённом хранилище</button>
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
          <h3>Однократный просмотр [1×] — шифроблоб удалён с узла</h3>
          <button type="button" class="icon-btn" onClick=${closeModal}><${Icon} name="close" /></button>
        </div>
        <div class="once-preview-box">
          ${d.mime?.startsWith('image/')
            ? html`<img src=${d.url} alt="Зашифрованное вложение" />`
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
          <h3>Голосовой канал DTLS-SRTP · ${chat?.title}</h3>
          <button type="button" class="icon-btn" onClick=${closeModal}><${Icon} name="close" /></button>
        </div>
        <p class="modal-desc">
          Поток аудио шифруется сквозным образом по DTLS-SRTP. Временные учётные данные TURN действуют 300 секунд
          без привязки к идентификатору. В политике «Только Tor» прямой сбор ICE-кандидатов заблокирован.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn-primary" onClick=${closeModal}>Завершить вызов</button>
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
        <h3>Новая зашифрованная сессия</h3>
        <button type="button" class="icon-btn" onClick=${closeModal}><${Icon} name="close" /></button>
      </div>
      <p class="modal-desc">
        Укажите <code>@username</code> собеседника. Клиент загрузит подписанный пакет ключей,
        проверит цифровую подпись ECDSA P-256 и зафиксирует идентификатор (TOFU).
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
          ${loading ? 'Проверка ключей…' : 'Открыть диалог'}
        </button>
      </div>
    </form>
  </div>`;
}

function SafetyModal({ data }) {
  if (!data?.safetyNumber) return null;
  const { chatId, chat, safetyNumber } = data;
  const hexBlocks = safetyNumber.hexBlocks || [];

  return html`<div class="modal-backdrop" onClick=${closeModal}>
    <div class="modal-card" onClick=${(e) => e.stopPropagation()}>
      <div class="modal-head">
        <h3>Верификация ключей · ${chat.title}</h3>
        <button type="button" class="icon-btn" onClick=${closeModal}><${Icon} name="close" /></button>
      </div>
      <p class="modal-desc">
        Сверьте 128-битный шестнадцатеричный дайджест или 60-значный цифровой код с собеседником по независимому каналу
        (5200 раундов SHA-512). Совпадение исключает атаку посредника (MITM).
      </p>

      ${hexBlocks.length > 0 && html`<div class="safety-section-caption">ДАЙДЖЕСТ КЛЮЧЕЙ (SHA-512 / 128 БИТ HEX)</div>
      <div class="safety-hex-grid">
        ${hexBlocks.map((b) => html`<code>${b}</code>`)}
      </div>`}

      <div class="safety-section-caption">КОНТРОЛЬНЫЙ КОД БЕЗОПАСНОСТИ (60 ЦИФР)</div>
      <div class="safety-digits-grid">
        ${safetyNumber.blocks.map((b) => html`<code>${b}</code>`)}
      </div>

      <div class="safety-qr-str">
        <span>URI верификации:</span> <code>${safetyNumber.qrPayload}</code>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-ghost" onClick=${closeModal}>Закрыть</button>
        <button
          type="button"
          class="btn-primary"
          onClick=${() => markPeerVerified(chatId, !chat.verified)}
        >${chat.verified ? 'Снять отметку верификации' : 'Подтвердить совпадение ключей'}</button>
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
        <h3>Параметры узла, сети и безопасности</h3>
        <button type="button" class="icon-btn" onClick=${closeModal}><${Icon} name="close" /></button>
      </div>

      <div class="settings-update-panel">
        <div class="settings-update-info">
          <div class="settings-update-ver">
            <b>MeshChat v${APP_VERSION}</b>
            <span class=${`ver-status-pill ${update?.available ? 'has-update' : ''}`}>
              ${update?.available ? `Доступна v${update.remoteVersion}` : 'Актуальная сборка'}
            </span>
          </div>
          <span>
            ${update?.downloading
              ? (update.statusText || `Загрузка пакета: ${update.progress}%`)
              : 'Контроль целостности обновлений по SHA-256'}
          </span>
        </div>
        ${update?.available
          ? html`<button type="button" class="btn-primary compact" disabled=${update.downloading} onClick=${applyAppUpdate}>
              <${Icon} name="download" size=${14} /> ${update.downloading ? `${update.progress}%` : 'Обновить'}
            </button>`
          : html`<button type="button" class="btn-ghost compact" disabled=${update?.checking} onClick=${() => checkForUpdates({ silent: false })}>
              <${Icon} name="refresh" size=${14} /> ${update?.checking ? 'Запрос…' : 'Проверить'}
            </button>`}
      </div>

      <div style="margin-bottom:12px">
        <label class="field-label">Адрес узла ретрансляции (пусто = локальный узел)</label>
        <input
          class="field-input"
          type="text"
          placeholder="https://meshchat-6a11.onrender.com, http://192.168.1.5:3000 или .onion"
          value=${serverUrl}
          onInput=${(e) => setServerUrl(e.target.value)}
          onBlur=${() => updateClientSettings({ serverUrl })}
        />
      </div>

      <div class="settings-section-title">Политика сетевого транспорта</div>
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
          <label class="field-label">Скрытый сервис Tor (.onion)</label>
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
          <label class="field-label">Туннель I2P (.b32.i2p)</label>
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
            Локальный ретранслятор Wi-Fi LAN для соседних устройств ${android.lanMeshRunning && android.lanUrl ? `(${android.lanUrl})` : '(:3000)'}
          </span>
          <span class=${`ios-switch ${android.lanMeshRunning ? 'on' : ''}`}><i></i></span>
        </div>`}
        <div class="insp-row" onClick=${() => updateClientSettings({ autoUpdateCheck: settings.autoUpdateCheck === false })}>
          <span class="insp-label">Автопроверка обновлений (блокируется в режимах Tor/I2P-Only)</span>
          <span class=${`ios-switch ${settings.autoUpdateCheck !== false ? 'on' : ''}`}><i></i></span>
        </div>
        <div class="insp-row" onClick=${() => updateClientSettings({ coverTraffic: !settings.coverTraffic })}>
          <span class="insp-label">Фоновый маскирующий трафик (пакеты 512 Б против корреляции)</span>
          <span class=${`ios-switch ${settings.coverTraffic ? 'on' : ''}`}><i></i></span>
        </div>
        <div class="insp-row" onClick=${() => updateClientSettings({ strictBossWipe: !settings.strictBossWipe })}>
          <span class="insp-label">Очищать ключи активных сессий из ОЗУ при блокировке (Esc×2)</span>
          <span class=${`ios-switch ${settings.strictBossWipe ? 'on' : ''}`}><i></i></span>
        </div>
      </div>

      <div class="settings-footer-actions">
        <button type="button" class="btn-ghost" onClick=${rotateBlindMailbox}>
          <${Icon} name="refresh" size=${14} /> Перевыпустить слепой ящик (${me?.mailboxId?.slice(0, 10)}…)
        </button>
        <button type="button" class="btn-danger" onClick=${logoutAndWipeDevice}>
          Завершить сеанс и уничтожить локальные ключи
        </button>
      </div>
    </div>
  </div>`;
}
