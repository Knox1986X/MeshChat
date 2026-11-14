// Модальные окна MeshChat v1.7:
//   1. Живой голосовой E2EE-вызов P2P WebRTC (DTLS-SRTP) с приёмом/отклонением, микрофоном и сверкой SAS.
//   2. Генератор и обмен QR-кодами (ISO/IEC 18004 SVG): контакт @username, шлюз /q/ и Wi-Fi LAN узел.
//   3. Верификация ключей безопасности (QR + 128-бит HEX + 60 цифр SHA-512 × 5200).
//   4. Профиль собеседника, открытие нового диалога, однократный просмотр [1×] и сетевые параметры.

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
  toggleScreenshotProtection,
  checkForUpdates,
  applyAppUpdate,
  rotateBlindMailbox,
  logoutAndWipeDevice,
  startVoiceCall,
  acceptVoiceCall,
  declineVoiceCall,
  hangupVoiceCall,
  toggleCallMute,
  dismissCallModal,
  copyWithPrivacy,
  clearSingleChatHistory,
  deleteChat,
  showToast,
} from '../store/app-store.mjs';
import {
  Icon,
  AvatarBox,
  ProfileBadgeIcon,
  AmbientParticles,
  QrCodeBox,
} from './boss-screen.mjs';
import { resolveBannerStyle } from './profile-view.mjs';

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

function formatCallDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
}

export function ModalLayer() {
  const { ui, recoveryModalKey, call } = store;

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
            onClick=${() => copyWithPrivacy(recoveryModalKey, 'Ключ восстановления скопирован')}
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

  if (call?.active) {
    return html`<${CallModal} call=${call} />`;
  }

  if (!ui.modal) return null;

  if (ui.modal === 'new-chat') {
    return html`<${NewChatModal} />`;
  }
  if (ui.modal === 'qr') {
    return html`<${QrIdentityModal} initialTab=${ui.modalData?.tab || 'contact'} />`;
  }
  if (ui.modal === 'safety') {
    return html`<${SafetyModal} data=${ui.modalData} />`;
  }
  if (ui.modal === 'peer-profile') {
    return html`<${PeerProfileModal} data=${ui.modalData} />`;
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

  return null;
}

// ─────────────────────── Живой голосовой E2EE вызов WebRTC (DTLS-SRTP) ───────────────────────

function CallModal({ call }) {
  const chat = store.chats[call.chatId];
  const avatarUrl = chat?.peerProfile?.avatarDataUrl || '';
  const avatarColor = chat?.avatarColor || '#3B4CCA';

  const statusText =
    call.phase === 'ringing'
      ? (call.direction === 'incoming'
        ? 'Входящий зашифрованный вызов DTLS-SRTP…'
        : 'Шифрование сигналинга и ожидание ответа…')
      : call.phase === 'connecting'
        ? 'Установка прямого медиаканала ICE / DTLS-SRTP…'
        : call.phase === 'connected'
          ? `Защищённый аудиоканал · ${formatCallDuration(call.elapsedSec)}`
          : (call.reason || 'Вызов завершён');

  return html`<div class="modal-backdrop">
    <div class="modal-card call-sheet-card" onClick=${(e) => e.stopPropagation()}>
      <div class="call-top-pill">
        <${Icon} name="shield" size=${13} />
        <span>E2EE СИГНАЛИНГ · DTLS-SRTP ${call.relayOnly ? '· TURN RELAY' : '· P2P'}</span>
      </div>

      <div class=${`call-avatar-pulse ${call.phase === 'ringing' || call.phase === 'connecting' ? 'pulsing' : ''}`}>
        <${AvatarBox}
          title=${call.peerTitle}
          username=${chat?.username || ''}
          avatarDataUrl=${avatarUrl}
          color=${avatarColor}
          size=${88}
        />
      </div>

      <h3 class="call-peer-title">${call.peerTitle}</h3>
      <div class="call-phase-label">${statusText}</div>

      ${call.phase === 'connected' && html`<div class="call-mic-meter" title="Уровень вашего микрофона">
        <div class="call-mic-fill" style=${`width:${call.muted ? 0 : Math.max(8, call.micLevel)}%`}></div>
      </div>`}

      ${call.dtlsSas && html`<div class="call-sas-box">
        <span>Код сверки DTLS SAS (должен совпадать у обоих):</span>
        <code>${call.dtlsSas}</code>
      </div>`}

      <div class="call-controls-row">
        ${call.phase === 'ringing' && call.direction === 'incoming'
          ? html`
              <button type="button" class="call-round-btn danger" title="Отклонить" onClick=${declineVoiceCall}>
                <${Icon} name="phoneOff" size=${20} />
                <span>Отклонить</span>
              </button>
              <button type="button" class="call-round-btn accept" title="Принять вызов" onClick=${acceptVoiceCall}>
                <${Icon} name="phone" size=${20} />
                <span>Принять</span>
              </button>
            `
          : call.phase === 'ended'
            ? html`<button type="button" class="btn-ghost" onClick=${dismissCallModal}>Закрыть</button>`
            : html`
                <button
                  type="button"
                  class=${`call-round-btn ${call.muted ? 'muted' : 'neutral'}`}
                  title=${call.muted ? 'Включить микрофон' : 'Отключить микрофон'}
                  onClick=${toggleCallMute}
                >
                  <${Icon} name=${call.muted ? 'micOff' : 'mic'} size=${19} />
                  <span>${call.muted ? 'Вкл. микр.' : 'Микрофон'}</span>
                </button>
                <button type="button" class="call-round-btn danger" title="Завершить вызов" onClick=${hangupVoiceCall}>
                  <${Icon} name="phoneOff" size=${20} />
                  <span>Завершить</span>
                </button>
              `}
      </div>
    </div>
  </div>`;
}

// ─────────────────────── Модальное окно QR-кодов и быстрого подключения ───────────────────────

function QrIdentityModal({ initialTab = 'contact' }) {
  const { me, settings, android } = store;
  const [tab, setTab] = useState(initialTab);
  const [peerUri, setPeerUri] = useState('');

  const originBase = settings.serverUrl
    ? settings.serverUrl.replace(/\/+$/, '')
    : (typeof location !== 'undefined' ? location.origin : 'https://meshchat-6a11.onrender.com');

  const contactUri = `meshchat://contact/${me?.username || ''}?fp=${me?.publicKeyShort || ''}`;
  const askUrl = `${originBase}/q/${me?.username || ''}`;
  const lanUrl = android.lanMeshRunning && android.lanUrl ? android.lanUrl : originBase;

  const activeValue = tab === 'ask' ? askUrl : tab === 'lan' ? lanUrl : contactUri;

  const onConnectParsed = async (e) => {
    e.preventDefault();
    const raw = peerUri.trim();
    if (!raw) return;
    let uname = raw;
    const m = raw.match(/meshchat:\/\/contact\/([^/?#]+)/i) || raw.match(/\/q\/([^/?#]+)/i);
    if (m) uname = decodeURIComponent(m[1]);
    try {
      await startChatWithUsername(uname);
      closeModal();
    } catch (err) {
      showToast(err.message, 'err');
    }
  };

  return html`<div class="modal-backdrop" onClick=${closeModal}>
    <div class="modal-card" onClick=${(e) => e.stopPropagation()}>
      <div class="modal-head">
        <h3>QR-визитка и быстрый обмен</h3>
        <button type="button" class="icon-btn" onClick=${closeModal}><${Icon} name="close" /></button>
      </div>

      <div class="chip-grid" style="justify-content:center;margin-bottom:12px">
        <button
          type="button"
          class=${`choice-chip ${tab === 'contact' ? 'active' : ''}`}
          onClick=${() => setTab('contact')}
        >Контакт @${me?.username}</button>
        <button
          type="button"
          class=${`choice-chip ${tab === 'ask' ? 'active' : ''}`}
          onClick=${() => setTab('ask')}
        >Шлюз /q/</button>
        <button
          type="button"
          class=${`choice-chip ${tab === 'lan' ? 'active' : ''}`}
          onClick=${() => setTab('lan')}
        >${android.lanMeshRunning ? 'Wi-Fi LAN' : 'Узел'}</button>
      </div>

      <div class="qr-modal-center">
        <${QrCodeBox} value=${activeValue} size=${192} />
        <code class="qr-value-caption">${activeValue}</code>
        <button
          type="button"
          class="btn-ghost compact"
          onClick=${() => copyWithPrivacy(activeValue, 'URI скопирован в буфер обмена')}
        ><${Icon} name="copy" size=${14} /> Копировать строку</button>
      </div>

      <form onSubmit=${onConnectParsed} style="margin-top:14px">
        <label class="field-label">Открыть контакт по считанному URI или @username</label>
        <div class="inline-form-row">
          <input
            class="field-input"
            type="text"
            placeholder="meshchat://contact/... или @username"
            value=${peerUri}
            onInput=${(e) => setPeerUri(e.target.value)}
          />
          <button type="submit" class="btn-primary compact">Открыть</button>
        </div>
      </form>
    </div>
  </div>`;
}

function NewChatModal() {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || loading) return;
    let clean = username.trim();
    const m = clean.match(/meshchat:\/\/contact\/([^/?#]+)/i);
    if (m) clean = decodeURIComponent(m[1]);
    setLoading(true);
    try {
      await startChatWithUsername(clean);
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
        Укажите <code>@username</code> или <code>meshchat://</code>-ссылку собеседника. Клиент загрузит
        подписанный пакет ключей, проверит цифровую подпись ECDSA P-256 и зафиксирует идентификатор (TOFU).
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
        <button
          type="button"
          class="btn-ghost"
          onClick=${() => { store.ui.modal = 'qr'; notifyStore(); }}
        ><${Icon} name="qr" size=${14} /> Мой QR</button>
        <button type="button" class="btn-ghost" onClick=${closeModal}>Отмена</button>
        <button type="submit" class="btn-primary" disabled=${loading}>
          ${loading ? 'Проверка ключей…' : 'Открыть диалог'}
        </button>
      </div>
    </form>
  </div>`;
}

function PeerProfileModal({ data }) {
  if (!data?.chat) return null;
  const { chatId, chat, safetyNumber } = data;
  const pp = chat.peerProfile || {};
  const displayTitle = pp.displayName || chat.title;
  const badge = pp.badge || (chat.verified ? 'verified' : 'none');

  return html`<div class="modal-backdrop" onClick=${closeModal}>
    <div class="modal-card profile-sheet-card" onClick=${(e) => e.stopPropagation()}>
      <div class="custom-profile-hero compact" style=${`background:${resolveBannerStyle(pp)}`}>
        <${AmbientParticles} effect=${pp.particles || 'stars'} />
        <div class="profile-hero-top-actions">
          <span class="hero-tag-chip">${chat.verified ? 'КЛЮЧ ПОДТВЕРЖДЁН' : 'КОНТАКТ E2EE'}</span>
          <button type="button" class="icon-btn small" onClick=${closeModal}>
            <${Icon} name="close" size=${15} />
          </button>
        </div>

        <div class="profile-avatar-stage">
          ${pp.statusText && html`<div class="profile-thought-bubble"><span>${pp.statusText}</span></div>`}
          <div class="profile-avatar-ring">
            <${AvatarBox}
              title=${displayTitle}
              username=${chat.username}
              avatarDataUrl=${pp.avatarDataUrl || ''}
              color=${chat.avatarColor || '#3B4CCA'}
              size=${88}
            />
          </div>
        </div>

        <div class="profile-identity-center">
          <div class="profile-display-name-row">
            <h2>${displayTitle}</h2>
            <${ProfileBadgeIcon} badge=${badge} size=${15} />
          </div>
          <div class="profile-sub-status">@${chat.username}</div>
        </div>
      </div>

      <div class="profile-sheet-body">
        ${pp.bio && html`<div class="profile-info-item">
          <div class="info-item-main">
            <div class="info-item-val">${pp.bio}</div>
            <div class="info-item-lbl">О собеседнике (расшифровано E2EE)</div>
          </div>
        </div>`}

        ${safetyNumber?.hexBlocks?.length > 0 && html`<div class="profile-safety-box">
          <div class="safety-section-caption">ОТПЕЧАТОК КЛЮЧЕЙ SHA-512</div>
          <div class="safety-hex-grid">
            ${safetyNumber.hexBlocks.map((b) => html`<code>${b}</code>`)}
          </div>
        </div>`}

        <div class="modal-actions" style="flex-wrap:wrap">
          <button
            type="button"
            class="btn-ghost compact"
            onClick=${() => {
              clearSingleChatHistory(chatId);
              closeModal();
            }}
          ><${Icon} name="trash" size=${14} /> Очистить чат</button>
          <button
            type="button"
            class="btn-danger compact"
            onClick=${() => {
              deleteChat(chatId);
              closeModal();
            }}
          >Удалить диалог</button>
          <button
            type="button"
            class="btn-ghost compact"
            onClick=${() => {
              closeModal();
              startVoiceCall(chatId);
            }}
          ><${Icon} name="phone" size=${15} /> Звонок P2P</button>
          <button
            type="button"
            class="btn-primary compact"
            onClick=${() => markPeerVerified(chatId, !chat.verified)}
          >${chat.verified ? 'Снять верификацию' : 'Подтвердить ключ'}</button>
        </div>
      </div>
    </div>
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
        Отсканируйте QR-код отпечатка или сверьте 60-значный контрольный код с собеседником по независимому каналу
        (5200 раундов SHA-512). Совпадение исключает атаку посредника (MITM).
      </p>

      ${safetyNumber.qrPayload && html`<div class="qr-modal-center" style="margin-bottom:10px">
        <${QrCodeBox} value=${safetyNumber.qrPayload} size=${164} />
      </div>`}

      ${hexBlocks.length > 0 && html`<div class="safety-section-caption">ДАЙДЖЕСТ КЛЮЧЕЙ (SHA-512 / 128 БИТ HEX)</div>
      <div class="safety-hex-grid">
        ${hexBlocks.map((b) => html`<code>${b}</code>`)}
      </div>`}

      <div class="safety-section-caption">КОНТРОЛЬНЫЙ КОД БЕЗОПАСНОСТИ (60 ЦИФР)</div>
      <div class="safety-digits-grid">
        ${safetyNumber.blocks.map((b) => html`<code>${b}</code>`)}
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
        ${android?.isApk && html`<div class="insp-row" onClick=${toggleScreenshotProtection}>
          <span class="insp-label">
            Защита от скриншотов (FLAG_SECURE) — по умолчанию выключена
          </span>
          <span class=${`ios-switch ${android.screenshotProtection ? 'on' : ''}`}><i></i></span>
        </div>`}
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
          <span class="insp-label">Фоновый маскирующий трафик против корреляции</span>
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
