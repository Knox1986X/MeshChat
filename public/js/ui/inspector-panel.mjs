// Правая инспектор-панель параметров сессии и верификации ключей безопасности.

import { html } from '../../vendor/preact.mjs';
import {
  store,
  notifyStore,
  setChatTtl,
  openSafetyVerificationModal,
  openEncryptedMedia,
} from '../store/app-store.mjs';
import { Icon, TTL_CHOICES, ttlText } from './boss-screen.mjs';

export function InspectorPanel() {
  const { chats, messages, decryptedMediaUrls, ui, activeTransportId, me } = store;
  const chat = ui.activeChatId ? chats[ui.activeChatId] : null;
  if (!chat || !ui.inspectorOpen) return null;

  const initials = (chat.username || chat.title || '?').replace(/^@/, '').slice(0, 2).toUpperCase();
  const chatMsgs = messages[chat.id] || [];
  const mediaItems = chatMsgs.filter((m) => m.media && !m.media.once);

  const cycleTtl = () => {
    const idx = TTL_CHOICES.findIndex(([sec]) => sec === Number(chat.ttlSec || 0));
    const next = TTL_CHOICES[(idx + 1) % TTL_CHOICES.length][0];
    setChatTtl(chat.id, next);
  };

  const toggleMute = () => {
    chat.muted = !chat.muted;
    notifyStore();
  };

  return html`<aside class="inspector-pane">
    <button
      type="button"
      class="inspector-close"
      title="Закрыть панель"
      onClick=${() => { store.ui.inspectorOpen = false; notifyStore(); }}
    ><${Icon} name="close" size=${15} /></button>

    <div class="inspector-profile">
      <div class="avatar xl" style=${`background:${chat.avatarColor || '#1E3A5F'}`}>
        ${chat.kind === 'ask' ? html`<${Icon} name="inbox" size=${30} />` : html`<span>${initials}</span>`}
        <span class="profile-badge" title=${chat.verified ? 'Ключи верифицированы' : 'E2E активно'}>
          <${Icon} name=${chat.verified ? 'shield' : 'lock'} size=${13} />
        </span>
      </div>
      <h3 class="inspector-name">${chat.title}</h3>
      <button
        type="button"
        class="inspector-sublink"
        onClick=${() => chat.kind === 'dm' && openSafetyVerificationModal(chat.id)}
      >
        ${chat.kind === 'ask'
          ? `Шлюз: /q/${me?.username}`
          : chat.verified
            ? 'Отпечаток безопасности подтверждён'
            : 'Проверить криптоотпечаток (HEX / 60 цифр)'}
      </button>

      <div class="inspector-circle-row">
        ${chat.kind === 'dm' && html`<button
          type="button"
          class="action-circle green"
          title="Аудиоканал P2P (DTLS-SRTP)"
          onClick=${() => { store.ui.modal = 'call'; store.ui.modalData = { chat }; notifyStore(); }}
        ><${Icon} name="phone" size=${17} /></button>`}

        ${chat.kind === 'dm' && html`<button
          type="button"
          class="action-circle lavender"
          title="Верификация ключей безопасности"
          onClick=${() => openSafetyVerificationModal(chat.id)}
        ><${Icon} name="shield" size=${17} /></button>`}

        <button
          type="button"
          class="action-circle dark"
          title="Сетевые параметры"
          onClick=${() => { store.ui.modal = 'settings'; notifyStore(); }}
        ><${Icon} name="settings" size=${17} /></button>
      </div>
    </div>

    <div class="inspector-rows">
      <div class="insp-row" onClick=${toggleMute}>
        <span class="insp-icon blue"><${Icon} name="bell" size=${15} /></span>
        <span class="insp-label">Звуковые оповещения</span>
        <span class=${`ios-switch ${!chat.muted ? 'on' : ''}`}><i></i></span>
      </div>

      ${chat.kind === 'dm' && html`<div class="insp-row" onClick=${cycleTtl}>
        <span class="insp-icon teal"><${Icon} name="clock" size=${15} /></span>
        <span class="insp-label">Автоудаление (TTL): <b>${ttlText(chat.ttlSec || 0)}</b></span>
        <span class="insp-arrow">›</span>
      </div>`}

      <div class="insp-row" onClick=${() => { store.ui.modal = 'settings'; notifyStore(); }}>
        <span class="insp-icon violet"><${Icon} name="globe" size=${15} /></span>
        <span class="insp-label">Транспорт: <b>${activeTransportId.toUpperCase()}</b> · ISO паддинг</span>
        <span class="insp-arrow">›</span>
      </div>
    </div>

    <div class="shared-media-head">
      <span>Вложения сессии</span>
      <span class="muted-count">${mediaItems.length}</span>
    </div>

    <div class="shared-media-grid">
      ${mediaItems.length === 0 && html`<div class="media-empty">
        Передаваемые файлы шифруются локально по AES-256-GCM до отправки на узел.
      </div>`}
      ${mediaItems.slice(-6).map((m) => {
        const url = decryptedMediaUrls[m.media.blobId];
        return html`<div
          key=${m.id}
          class="media-thumb"
          onClick=${() => openEncryptedMedia(m)}
          title=${m.media.name}
        >
          ${url && m.media.mime?.startsWith('image/')
            ? html`<img src=${url} alt=${m.media.name} />`
            : html`<div class="media-thumb-placeholder">
                <${Icon} name="lock" size=${15} />
                <span>${m.media.name.slice(0, 12)}</span>
              </div>`}
        </div>`;
      })}
    </div>
  </aside>`;
}
