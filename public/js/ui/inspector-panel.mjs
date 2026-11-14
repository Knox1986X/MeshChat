// Правая инспектор-панель параметров сессии, верификации ключей, очистки и управления диалогом.

import { html, useState } from '../../vendor/preact.mjs';
import {
  store,
  notifyStore,
  setChatTtl,
  toggleChatMute,
  clearSingleChatHistory,
  deleteChat,
  startVoiceCall,
  openSafetyVerificationModal,
  openPeerProfileModal,
  saveDecryptedMediaToDevice,
  openEncryptedMedia,
  setNavTab,
} from '../store/app-store.mjs';
import {
  Icon,
  AvatarBox,
  ProfileBadgeIcon,
  TTL_CHOICES,
  ttlText,
} from './boss-screen.mjs';

export function InspectorPanel() {
  const { chats, messages, decryptedMediaUrls, ui, activeTransportId, me } = store;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const chat = ui.activeChatId ? chats[ui.activeChatId] : null;
  if (!chat || !ui.inspectorOpen) return null;

  const displayTitle = chat.peerProfile?.displayName || chat.title;
  const peerBadge = chat.peerProfile?.badge || (chat.verified ? 'verified' : 'none');
  const chatMsgs = messages[chat.id] || [];
  const mediaItems = chatMsgs.filter((m) => m.media && !m.media.once);

  const cycleTtl = () => {
    const idx = TTL_CHOICES.findIndex(([sec]) => sec === Number(chat.ttlSec || 0));
    const next = TTL_CHOICES[(idx + 1) % TTL_CHOICES.length][0];
    setChatTtl(chat.id, next);
  };

  return html`<aside class="inspector-pane">
    <button
      type="button"
      class="inspector-close"
      title="Закрыть панель"
      onClick=${() => { store.ui.inspectorOpen = false; notifyStore(); }}
    ><${Icon} name="close" size=${15} /></button>

    <div class="inspector-profile">
      <div
        class="inspector-avatar-wrap"
        onClick=${() => chat.kind === 'dm' && openPeerProfileModal(chat.id)}
      >
        <${AvatarBox}
          title=${displayTitle}
          username=${chat.username}
          avatarDataUrl=${chat.peerProfile?.avatarDataUrl || ''}
          color=${chat.avatarColor || '#3B4CCA'}
          kind=${chat.kind}
          size=${72}
        />
        <span class="profile-badge" title=${chat.verified ? 'Ключи верифицированы' : 'E2EE активно'}>
          <${Icon} name=${chat.verified || chat.kind !== 'dm' ? 'shield' : 'lock'} size=${12} />
        </span>
      </div>

      <h3 class="inspector-name">
        <span>${displayTitle}</span>
        <${ProfileBadgeIcon} badge=${peerBadge} size=${13} />
      </h3>

      <button
        type="button"
        class="inspector-sublink"
        onClick=${() => chat.kind === 'dm' && openSafetyVerificationModal(chat.id)}
      >
        ${chat.kind === 'ask'
          ? `Шлюз: /q/${me?.username}`
          : chat.kind === 'echo'
            ? 'Локальный сейф AES-256-GCM'
            : chat.verified
              ? 'Отпечаток безопасности подтверждён'
              : 'Проверить криптоотпечаток (QR / 60 цифр)'}
      </button>

      <div class="inspector-circle-row">
        ${chat.kind === 'dm' && html`<button
          type="button"
          class="action-circle green"
          title="Аудиоканал P2P (DTLS-SRTP)"
          onClick=${() => startVoiceCall(chat.id)}
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
          title="Поиск в диалоге"
          onClick=${() => {
            store.ui.chatSearchOpen = true;
            store.ui.inspectorOpen = false;
            notifyStore();
          }}
        ><${Icon} name="search" size=${17} /></button>

        <button
          type="button"
          class="action-circle dark"
          title="Все настройки приложения"
          onClick=${() => {
            store.ui.inspectorOpen = false;
            setNavTab('settings');
          }}
        ><${Icon} name="settings" size=${17} /></button>
      </div>
    </div>

    <div class="inspector-rows">
      <div class="insp-row" onClick=${() => toggleChatMute(chat.id)}>
        <span class="insp-icon blue"><${Icon} name="bell" size=${15} /></span>
        <span class="insp-label">Звуковые оповещения</span>
        <span class=${`ios-switch ${!chat.muted ? 'on' : ''}`}><i></i></span>
      </div>

      ${chat.kind === 'dm' && html`<div class="insp-row" onClick=${cycleTtl}>
        <span class="insp-icon teal"><${Icon} name="clock" size=${15} /></span>
        <span class="insp-label">Автоудаление (TTL): <b>${ttlText(chat.ttlSec || 0)}</b></span>
        <span class="insp-arrow">›</span>
      </div>`}

      <div class="insp-row">
        <span class="insp-icon purple"><${Icon} name="globe" size=${15} /></span>
        <span class="insp-label">Транспорт: <b>${activeTransportId.toUpperCase()}</b></span>
      </div>

      <div class="insp-row" onClick=${() => clearSingleChatHistory(chat.id)}>
        <span class="insp-icon blue"><${Icon} name="trash" size=${15} /></span>
        <span class="insp-label">Очистить переписку (${chatMsgs.length})</span>
        <span class="insp-arrow">›</span>
      </div>

      ${chat.kind === 'dm' && !confirmDelete && html`<div class="insp-row" onClick=${() => setConfirmDelete(true)}>
        <span class="insp-icon danger"><${Icon} name="close" size=${15} /></span>
        <span class="insp-label" style="color:var(--accent-danger)">Удалить диалог с устройства</span>
        <span class="insp-arrow">›</span>
      </div>`}

      ${chat.kind === 'dm' && confirmDelete && html`<div class="insp-confirm-box">
        <span>Удалить этот диалог и его локальную историю?</span>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="btn-ghost compact" onClick=${() => setConfirmDelete(false)}>Отмена</button>
          <button type="button" class="btn-danger compact" onClick=${() => deleteChat(chat.id)}>Удалить</button>
        </div>
      </div>`}
    </div>

    <div class="inspector-media-section">
      <div class="insp-section-head">
        <span>ВЛОЖЕНИЯ E2EE</span>
        <span>${mediaItems.length}</span>
      </div>
      ${mediaItems.length === 0
        ? html`<p class="insp-empty">Зашифрованных файлов в диалоге пока нет.</p>`
        : html`<div class="insp-media-grid">
            ${mediaItems.slice(-9).map((m) => {
              const url = decryptedMediaUrls[m.media.blobId];
              return html`<button
                key=${m.id}
                type="button"
                class="insp-media-tile"
                title=${m.media.name}
                onClick=${() => m.media.mime?.startsWith('image/') ? openEncryptedMedia(m) : saveDecryptedMediaToDevice(m)}
              >
                ${url && m.media.mime?.startsWith('image/')
                  ? html`<img src=${url} alt="" />`
                  : html`<${Icon} name=${m.media.mime?.startsWith('audio/') ? 'mic' : 'lock'} size=${16} />`}
              </button>`;
            })}
          </div>`}
    </div>
  </aside>`;
}
