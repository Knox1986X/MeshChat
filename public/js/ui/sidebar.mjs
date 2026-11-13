// Панель «Чаты» (в стиле современного тёмного мессенджера):
// закреплённые диалоги (включая Эхо-проверку E2EE), фильтры-пилюли, кастомные аватары и статус ретрансляции.

import { html } from '../../vendor/preact.mjs';
import {
  store,
  selectChat,
  syncNow,
  notifyStore,
  setNavTab,
  applyAppUpdate,
  dismissUpdateBanner,
  APP_VERSION,
} from '../store/app-store.mjs';
import { Icon, AvatarBox, ProfileBadgeIcon, formatTime } from './boss-screen.mjs';

const TRANSPORT_LABELS = {
  ws: 'relay онлайн',
  tor: 'tor .onion',
  i2p: 'i2p туннель',
  webrtc: 'p2p mesh',
  fallback: 'relay онлайн',
};

export function Sidebar() {
  const {
    me,
    profile,
    chats,
    ui,
    transportState,
    sessionAuthenticated,
    rehydratingSession,
    activeTransportId,
    rttMs,
    meshStats,
    outbox,
    update,
  } = store;

  const unreadChatsCount = Object.values(chats).filter((c) => (c.unread || 0) > 0).length;

  const filteredChats = Object.values(chats)
    .filter((c) => {
      if (ui.spaceFilter === 'unread') return (c.unread || 0) > 0;
      if (ui.spaceFilter === 'tor') return activeTransportId === 'tor' || c.kind === 'dm';
      if (ui.spaceFilter === 'mesh') return c.kind === 'echo' || c.kind === 'dm';
      if (ui.spaceFilter === 'ask') return c.kind === 'ask';
      return true;
    })
    .filter((c) => {
      if (!ui.searchQuery.trim()) return true;
      const q = ui.searchQuery.trim().toLowerCase();
      return (
        (c.title || '').toLowerCase().includes(q) ||
        (c.username || '').toLowerCase().includes(q) ||
        (c.lastPreview || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));

  const pinnedChats = filteredChats.filter((c) => c.pinned);
  const regularChats = filteredChats.filter((c) => !c.pinned);

  const isOnline = (transportState === 'connected' || transportState === 'degraded') && sessionAuthenticated;
  const isConnecting =
    rehydratingSession ||
    (transportState === 'connected' && !sessionAuthenticated) ||
    transportState === 'connecting';

  const displayRtt = meshStats.medianRttMs || rttMs;
  const statusText = isOnline
    ? `${TRANSPORT_LABELS[activeTransportId] || 'relay онлайн'}${displayRtt ? ` · ${displayRtt} мс` : ''}`
    : isConnecting
      ? 'восстановление канала…'
      : `автономно${outbox.length ? ` · очередь ${outbox.length}` : ''}`;

  const renderChatRow = (c) => {
    const active = ui.activeChatId === c.id;
    const displayTitle = c.peerProfile?.displayName || c.title;
    const badge = c.peerProfile?.badge || (c.verified ? 'verified' : 'none');

    return html`<div
      key=${c.id}
      class=${`chat-item ${active ? 'active' : ''}`}
      onClick=${() => selectChat(c.id)}
    >
      <${AvatarBox}
        title=${displayTitle}
        username=${c.username}
        avatarDataUrl=${c.peerProfile?.avatarDataUrl || ''}
        color=${c.avatarColor || '#3B4CCA'}
        kind=${c.kind}
        size=${48}
        online=${c.kind === 'echo' || (isOnline && c.kind === 'dm')}
      />

      <div class="chat-item-body">
        <div class="chat-item-top">
          <span class="chat-title">
            ${displayTitle}
            <${ProfileBadgeIcon} badge=${badge} size=${13} />
          </span>
          <span class="chat-time-box">
            ${c.pinned && html`<span class="pin-mini" title="Закреплён"><${Icon} name="pin" size=${11} /></span>`}
            <span>${formatTime(c.lastTs)}</span>
          </span>
        </div>

        <div class="chat-item-bottom">
          <span class="chat-preview">${c.lastPreview || 'Зашифрованный канал Double Ratchet'}</span>
          ${c.ttlSec > 0 && html`<span class="ttl-mini-badge"><${Icon} name="clock" size=${10} /></span>`}
          ${c.unread > 0 && html`<span class="unread-pill">${c.unread}</span>`}
        </div>
      </div>
    </div>`;
  };

  return html`<aside class=${`sidebar ${ui.activeChatId ? 'mobile-hidden' : ''}`}>
    <div class="chats-hero-header">
      <div class="chats-hero-left">
        <h1 class="screen-big-title">Чаты</h1>
        <div class="screen-pills-row">
          <button
            type="button"
            class=${`hero-status-pill ${isOnline ? 'online' : isConnecting ? 'warn' : 'offline'}`}
            onClick=${() => syncNow().catch(() => {})}
            title="Нажмите для немедленной синхронизации ящика"
          >
            <span class="status-dot"></span>
            <span>${statusText}</span>
          </button>
          <span class="hero-status-pill neutral">E2EE v${APP_VERSION}</span>
        </div>
      </div>

      <div class="chats-hero-actions">
        <button
          type="button"
          class="square-action-btn"
          title="Новый диалог по @username"
          onClick=${() => { store.ui.modal = 'new-chat'; notifyStore(); }}
        ><${Icon} name="qr" size=${18} /></button>

        <div class="header-me-avatar" title="Открыть кастомный профиль" onClick=${() => setNavTab('profile')}>
          <${AvatarBox}
            title=${profile.displayName || me?.username}
            username=${me?.username}
            avatarDataUrl=${profile.avatarDataUrl}
            color="#4338CA"
            size=${38}
            online=${isOnline}
          />
        </div>
      </div>
    </div>

    ${update?.available && !update.dismissed && html`<div class="sidebar-update-card">
      <div class="sidebar-update-top">
        <span class="sidebar-update-title">Доступен релиз MeshChat v${update.remoteVersion || APP_VERSION}</span>
        ${!update.downloading && html`<button type="button" class="icon-btn small" onClick=${dismissUpdateBanner}>
          <${Icon} name="close" size=${13} />
        </button>`}
      </div>
      <div class="sidebar-update-sub">
        ${update.downloading
          ? (update.statusText || `Загрузка пакета: ${update.progress}%`)
          : 'Обновление GitHub Releases без потери сессии'}
      </div>
      ${update.downloading
        ? html`<div class="update-progress-track"><div class="update-progress-fill" style=${`width:${Math.max(6, update.progress)}%`}></div></div>`
        : html`<button type="button" class="btn-update-now full" onClick=${applyAppUpdate}>
            <${Icon} name="download" size=${14} /> Установить v${update.remoteVersion}
          </button>`}
    </div>`}

    <div class="sidebar-search">
      <${Icon} name="search" size=${16} />
      <input
        type="search"
        placeholder="Поиск по чатам и ключам"
        value=${ui.searchQuery}
        onInput=${(e) => { store.ui.searchQuery = e.target.value; notifyStore(); }}
      />
    </div>

    <div class="filter-pills-scroll">
      ${[
        ['all', 'Все'],
        ['unread', unreadChatsCount > 0 ? `Непрочитанные · ${unreadChatsCount}` : 'Непрочитанные'],
        ['mesh', 'Mesh'],
        ['tor', 'Tor'],
        ['ask', 'Шлюз'],
      ].map(([id, label]) => html`<button
        key=${id}
        type="button"
        class=${`filter-pill ${ui.spaceFilter === id ? 'active' : ''}`}
        onClick=${() => { store.ui.spaceFilter = id; notifyStore(); }}
      >${label}</button>`)}
    </div>

    <div class="chat-list">
      ${pinnedChats.length > 0 && html`<div>
        <div class="sidebar-section-label">ЗАКРЕПЛЁННЫЕ</div>
        ${pinnedChats.map(renderChatRow)}
      </div>`}

      <div class="sidebar-section-label">ВСЕ ЧАТЫ</div>
      ${regularChats.length === 0 && pinnedChats.length === 0 && html`<div class="empty-list-hint">
        Диалогов по выбранному фильтру нет. Нажмите кнопку создания чата справа внизу и укажите <code>@username</code>.
      </div>`}
      ${regularChats.map(renderChatRow)}
    </div>

    <button
      type="button"
      class="compose-fab"
      title="Открыть зашифрованный диалог"
      onClick=${() => { store.ui.modal = 'new-chat'; notifyStore(); }}
    >
      <${Icon} name="edit" size=${20} />
    </button>
  </aside>`;
}
