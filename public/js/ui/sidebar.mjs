// Панель «Чаты» MeshChat v1.7:
// закреплённые диалоги, живые фильтры, QR-визитка, индикатор набора текста «печатает…»,
// превью статусов прочтения ✓✓ и защита превью от посторонних глаз.

import { html } from '../../vendor/preact.mjs';
import {
  store,
  selectChat,
  syncNow,
  notifyStore,
  setNavTab,
  openSettingsSection,
  uiText,
  uninstallLegacyApk,
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
    messages,
    drafts,
    typingByChat,
    ui,
    settings,
    transportState,
    sessionAuthenticated,
    rehydratingSession,
    activeTransportId,
    rttMs,
    meshStats,
    outbox,
    update,
    android,
  } = store;

  const allChatItems = Object.values(chats);
  const unreadChatsCount = allChatItems.filter((c) => (c.unread || 0) > 0).length;
  const enabledSys = Array.isArray(settings.enabledSystemFolders)
    ? settings.enabledSystemFolders
    : ['unread', 'dm', 'verified', 'pinned', 'ask'];
  const customFolders = Array.isArray(settings.customFolders) ? settings.customFolders : [];
  const activeCustomFolder = customFolders.find((f) => f.id === ui.spaceFilter);

  const filteredChats = allChatItems
    .filter((c) => {
      if (activeCustomFolder) return (activeCustomFolder.chatIds || []).includes(c.id);
      if (ui.spaceFilter === 'unread') return (c.unread || 0) > 0;
      if (ui.spaceFilter === 'dm') return c.kind === 'dm';
      if (ui.spaceFilter === 'verified') return Boolean(c.verified) || c.kind === 'echo';
      if (ui.spaceFilter === 'pinned') return Boolean(c.pinned);
      if (ui.spaceFilter === 'ask') return c.kind === 'ask';
      return true;
    })
    .filter((c) => {
      if (!ui.searchQuery.trim()) return true;
      const q = ui.searchQuery.trim().toLowerCase();
      const peerName = c.peerProfile?.displayName || '';
      return (
        (c.title || '').toLowerCase().includes(q) ||
        peerName.toLowerCase().includes(q) ||
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
    const isTyping = (typingByChat[c.id] || 0) > Date.now();
    const list = messages[c.id] || [];
    const last = list[list.length - 1];

    const savedDraft = settings.autoSaveDrafts !== false ? (drafts?.[c.id] || '') : '';
    const checkPrefix = last?.out
      ? (last.status === 'read' || last.status === 'delivered' ? '✓✓ ' : '✓ ')
      : '';
    const previewBody = isTyping
      ? 'печатает…'
      : savedDraft
        ? `Черновик: ${savedDraft}`
        : last
          ? `${checkPrefix}${last.text || (last.media?.mime?.startsWith('audio/') ? '[Голосовое E2EE]' : '[Зашифрованный файл]')}`
          : (c.lastPreview || 'Зашифрованный канал Double Ratchet');

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
        online=${!settings.hideOnlinePresence && (c.kind === 'echo' || (isOnline && c.kind === 'dm'))}
      />

      <div class="chat-item-body">
        <div class="chat-item-top">
          <span class="chat-title">
            ${displayTitle}
            <${ProfileBadgeIcon} badge=${badge} size=${13} />
          </span>
          <span class="chat-time-box">
            ${c.muted && html`<span class="muted-dot" title="Уведомления отключены">×</span>`}
            ${c.pinned && html`<span class="pin-mini" title="Закреплён"><${Icon} name="pin" size=${11} /></span>`}
            <span>${formatTime(last?.ts || c.lastTs, settings.timeFormat)}</span>
          </span>
        </div>

        <div class="chat-item-bottom">
          ${settings.previewInList === false
            ? html`<span class="chat-preview muted-preview">Скрыто настройками приватности</span>`
            : html`<span class=${`chat-preview ${isTyping ? 'typing-preview' : ''}`}>${previewBody}</span>`}
          ${c.ttlSec > 0 && html`<span class="ttl-mini-badge"><${Icon} name="clock" size=${10} /></span>`}
          ${c.unread > 0 && html`<span class="unread-pill">${c.unread}</span>`}
        </div>
      </div>
    </div>`;
  };

  return html`<aside class=${`sidebar ${ui.activeChatId ? 'mobile-hidden' : ''}`}>
    <div class="chats-hero-header">
      <div class="chats-hero-left">
        <h1 class="screen-big-title">${uiText('chats')}</h1>
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
          class="square-action-btn festive-trigger-btn"
          title="Новогодняя атмосфера, снежинки и градиенты"
          onClick=${() => { store.ui.modal = 'atmosphere'; notifyStore(); }}
        ><${Icon} name="snowflake" size=${18} /></button>

        <button
          type="button"
          class="square-action-btn"
          title="Моя QR-визитка и быстрый обмен"
          onClick=${() => { store.ui.modal = 'qr'; notifyStore(); }}
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

    ${android?.legacyInstalled && html`<div class="sidebar-update-card">
      <div class="sidebar-update-top">
        <span class="sidebar-update-title">На телефоне осталась старая копия v1.2</span>
      </div>
      <div class="sidebar-update-sub">
        Удалите старый пакет в 1 нажатие — все будущие обновления теперь идут поверх текущей версии v${APP_VERSION}
      </div>
      <button type="button" class="btn-update-now full" onClick=${uninstallLegacyApk}>
        Удалить старую копию v1.2
      </button>
    </div>`}

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
        placeholder="Поиск по чатам и контактам"
        value=${ui.searchQuery}
        onInput=${(e) => { store.ui.searchQuery = e.target.value; notifyStore(); }}
      />
    </div>

    <div class=${`filter-pills-scroll ${settings.compactFolderTabs ? 'compact' : ''}`}>
      <button
        type="button"
        class=${`filter-pill ${ui.spaceFilter === 'all' ? 'active' : ''}`}
        onClick=${() => { store.ui.spaceFilter = 'all'; notifyStore(); }}
      >Все</button>

      ${[
        ['unread', 'Непрочитанные', unreadChatsCount],
        ['dm', 'Личные', allChatItems.filter((c) => c.kind === 'dm' && (c.unread || 0) > 0).length],
        ['verified', 'Проверенные', allChatItems.filter((c) => (c.verified || c.kind === 'echo') && (c.unread || 0) > 0).length],
        ['pinned', 'Закреплённые', allChatItems.filter((c) => c.pinned && (c.unread || 0) > 0).length],
        ['ask', 'Шлюз', allChatItems.filter((c) => c.kind === 'ask' && (c.unread || 0) > 0).length],
      ]
        .filter(([id]) => enabledSys.includes(id))
        .map(([id, label, cnt]) => html`<button
          key=${id}
          type="button"
          class=${`filter-pill ${ui.spaceFilter === id ? 'active' : ''}`}
          onClick=${() => { store.ui.spaceFilter = id; notifyStore(); }}
        >${settings.showFolderCounts !== false && cnt > 0 ? `${label} · ${cnt}` : label}</button>`)}

      ${customFolders.map((fld) => {
        const cnt = allChatItems.filter((c) => (fld.chatIds || []).includes(c.id) && (c.unread || 0) > 0).length;
        return html`<button
          key=${fld.id}
          type="button"
          class=${`filter-pill custom-folder-pill ${ui.spaceFilter === fld.id ? 'active' : ''}`}
          onClick=${() => { store.ui.spaceFilter = fld.id; notifyStore(); }}
        >
          <${Icon} name="folder" size=${12} />
          <span>${settings.showFolderCounts !== false && cnt > 0 ? `${fld.title} · ${cnt}` : fld.title}</span>
        </button>`;
      })}

      <button
        type="button"
        class="filter-pill folder-cfg-pill"
        title="Настроить папки с чатами"
        onClick=${() => { openSettingsSection('folders'); setNavTab('settings'); }}
      ><${Icon} name="folder" size=${13} /></button>
    </div>

    <div class="chat-list">
      ${pinnedChats.length > 0 && html`<div>
        <div class="sidebar-section-label">ЗАКРЕПЛЁННЫЕ</div>
        ${pinnedChats.map(renderChatRow)}
      </div>`}

      <div class="sidebar-section-label">ВСЕ ЧАТЫ</div>
      ${regularChats.length === 0 && pinnedChats.length === 0 && html`<div class="empty-list-hint">
        Диалогов по выбранному фильтру нет. Нажмите кнопку справа внизу и укажите <code>@username</code>.
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
