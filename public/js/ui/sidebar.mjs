// Левая навигационная панель чатов и контроля сетевого транспорта.
// Строгий корпоративно-криптографический интерфейс без декоративных метафор и эмодзи.

import { html } from '../../vendor/preact.mjs';
import {
  store,
  selectChat,
  syncNow,
  notifyStore,
  applyAppUpdate,
  dismissUpdateBanner,
  APP_VERSION,
} from '../store/app-store.mjs';
import { Icon, formatTime } from './boss-screen.mjs';

const TRANSPORT_LABELS = {
  ws: 'WSS Прямой',
  tor: 'Tor .onion',
  i2p: 'I2P Туннель',
  webrtc: 'WebRTC P2P',
  fallback: 'Мультитранспорт',
};

export function Sidebar() {
  const {
    me,
    chats,
    ui,
    transportState,
    sessionAuthenticated,
    activeTransportId,
    rttMs,
    outbox,
    update,
  } = store;

  const allChats = Object.values(chats)
    .filter((c) => {
      if (ui.spaceFilter === 'ask') return c.kind === 'ask';
      if (ui.spaceFilter === 'rooms') return c.kind === 'room';
      if (ui.searchQuery.trim()) {
        const q = ui.searchQuery.trim().toLowerCase();
        return (c.title || '').toLowerCase().includes(q) || (c.lastPreview || '').toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));

  const isOnline = (transportState === 'connected' || transportState === 'degraded') && sessionAuthenticated;
  const isConnecting = (transportState === 'connected' && !sessionAuthenticated) || transportState === 'connecting';

  const transportBadge = isOnline
    ? `${TRANSPORT_LABELS[activeTransportId] || activeTransportId.toUpperCase()}${rttMs ? ` · ${rttMs} мс` : ''}`
    : isConnecting
      ? 'Синхронизация канала…'
      : `Автономный режим${outbox.length ? ` · Очередь: ${outbox.length}` : ''}`;

  return html`<aside class=${`sidebar ${ui.activeChatId ? 'mobile-hidden' : ''}`}>
    <div class="sidebar-top">
      <div class="sidebar-brand-row">
        <div class="sidebar-brand-mark">
          <${Icon} name="mesh" size=${16} />
          <span>MESHCHAT</span>
          <code class="sidebar-ver-tag">v${APP_VERSION}</code>
        </div>

        <button
          type="button"
          class="space-add-btn"
          title="Новый зашифрованный диалог (X3DH)"
          onClick=${() => { store.ui.modal = 'new-chat'; notifyStore(); }}
        ><${Icon} name="plus" size=${16} /></button>
      </div>

      <div class="filter-segment">
        <button
          type="button"
          class=${`filter-segment-btn ${ui.spaceFilter === 'all' ? 'active' : ''}`}
          onClick=${() => { store.ui.spaceFilter = 'all'; notifyStore(); }}
        >Все</button>
        <button
          type="button"
          class=${`filter-segment-btn ${ui.spaceFilter === 'rooms' ? 'active' : ''}`}
          onClick=${() => { store.ui.spaceFilter = 'rooms'; notifyStore(); }}
        >Каналы</button>
        <button
          type="button"
          class=${`filter-segment-btn ${ui.spaceFilter === 'ask' ? 'active' : ''}`}
          onClick=${() => { store.ui.spaceFilter = 'ask'; notifyStore(); }}
        >Шлюз</button>
      </div>
    </div>

    <div class="workspace-banner">
      <div class="ws-banner-text">
        <div class="ws-title">@${me?.username || 'operator'}</div>
        <button
          type="button"
          class=${`transport-chip ${isOnline ? 'online' : 'offline'}`}
          onClick=${() => syncNow().catch(() => {})}
          title="Нажмите для немедленной проверки связи и синхронизации ящика"
        >
          <span class="status-dot"></span>
          <span>${transportBadge}</span>
        </button>
      </div>
      <button
        type="button"
        class="ws-edit-btn"
        title="Параметры узла, маршрутизации и безопасности"
        onClick=${() => { store.ui.modal = 'settings'; notifyStore(); }}
      ><${Icon} name="settings" size=${16} /></button>
    </div>

    ${update?.available && !update.dismissed && html`<div class="sidebar-update-card">
      <div class="sidebar-update-top">
        <span class="sidebar-update-title">Обновление MeshChat v${update.remoteVersion || APP_VERSION}</span>
        ${!update.downloading && html`<button type="button" class="icon-btn small" onClick=${dismissUpdateBanner}>
          <${Icon} name="close" size=${13} />
        </button>`}
      </div>
      <div class="sidebar-update-sub">
        ${update.downloading
          ? (update.statusText || `Загрузка пакета: ${update.progress}%`)
          : 'Проверенная сборка (контроль SHA-256)'}
      </div>
      ${update.downloading
        ? html`<div class="update-progress-track"><div class="update-progress-fill" style=${`width:${Math.max(6, update.progress)}%`}></div></div>`
        : html`<button type="button" class="btn-update-now full" onClick=${applyAppUpdate}>
            <${Icon} name="download" size=${14} /> Установить v${update.remoteVersion}
          </button>`}
    </div>`}

    <div class="sidebar-search">
      <${Icon} name="search" size=${15} />
      <input
        type="search"
        placeholder="Фильтр по локальной БД…"
        value=${ui.searchQuery}
        onInput=${(e) => { store.ui.searchQuery = e.target.value; notifyStore(); }}
      />
    </div>

    <div class="sidebar-section-label">АКТИВНЫЕ СЕССИИ</div>

    <div class="chat-list">
      ${allChats.length === 0 && html`<div class="empty-list-hint">
        Активных сессий нет. Нажмите <b>+</b> и укажите <code>@username</code> собеседника для обмена ключами X3DH.
      </div>`}

      ${allChats.map((c) => {
        const active = ui.activeChatId === c.id;
        const initials = (c.username || c.title || '?').replace(/^@/, '').slice(0, 2).toUpperCase();
        return html`<div
          key=${c.id}
          class=${`chat-item ${active ? 'active' : ''}`}
          onClick=${() => selectChat(c.id)}
        >
          <div class="avatar" style=${`background:${c.avatarColor || '#1E3A5F'}`}>
            ${c.kind === 'ask' ? html`<${Icon} name="inbox" size=${17} />` : html`<span>${initials}</span>`}
            <span class=${`avatar-dot ${c.verified ? 'verified' : 'e2e'}`} title=${c.verified ? 'Ключи верифицированы' : 'E2E активно'}></span>
          </div>
          <div class="chat-item-body">
            <div class="chat-item-row">
              <span class="chat-item-title">${c.title}</span>
              <span class="chat-item-time">${formatTime(c.lastTs)}</span>
            </div>
            <div class="chat-item-row">
              <span class="chat-item-sub">${c.lastPreview || 'Сквозное шифрование активно'}</span>
              ${c.unread > 0 && html`<span class="unread-badge">${c.unread}</span>`}
            </div>
          </div>
        </div>`;
      })}
    </div>

    <button
      type="button"
      class="mobile-fab"
      title="Новый диалог"
      onClick=${() => { store.ui.modal = 'new-chat'; notifyStore(); }}
    ><${Icon} name="plus" size=${21} /></button>

    <nav class="mobile-bottom-nav">
      <button type="button" class=${ui.spaceFilter === 'all' ? 'active' : ''} onClick=${() => { store.ui.spaceFilter = 'all'; notifyStore(); }}>
        <${Icon} name="chat" size=${18} /><span>Диалоги</span>
      </button>
      <button type="button" onClick=${() => { store.ui.modal = 'new-chat'; notifyStore(); }}>
        <${Icon} name="users" size=${18} /><span>Контакт</span>
      </button>
      <button type="button" class=${ui.spaceFilter === 'ask' ? 'active' : ''} onClick=${() => { store.ui.spaceFilter = 'ask'; selectChat('ask:inbox'); }}>
        <${Icon} name="inbox" size=${18} /><span>Шлюз</span>
      </button>
      <button type="button" onClick=${() => { store.ui.modal = 'settings'; notifyStore(); }}>
        <${Icon} name="globe" size=${18} /><span>Сеть</span>
      </button>
    </nav>
  </aside>`;
}
