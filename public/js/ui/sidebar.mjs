// Левая колонка чатов (Desktop 3-pane) и мобильный экран списка диалогов с нижним таббаром (Mobile 5-tab).
// Реализует дизайн с первого и второго макетов: вкладки пространств W/S/Q, лавандовый градиентный баннер,
// живой индикатор активного транспорта (WS / Tor / I2P / P2P) и список контактов.

import { html } from '../../vendor/preact.mjs';
import {
  store,
  selectChat,
  notifyStore,
  applyAppUpdate,
  dismissUpdateBanner,
  APP_VERSION,
} from '../store/app-store.mjs';
import { Icon, formatTime } from './boss-screen.mjs';

const TRANSPORT_LABELS = {
  ws: 'WSS Прямой',
  tor: 'Tor .onion',
  i2p: 'I2P Tunnel',
  webrtc: 'WebRTC P2P',
  fallback: 'Мульти-канал',
};

export function Sidebar() {
  const { me, chats, ui, transportState, activeTransportId, rttMs, outbox, update } = store;

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

  const isConnected = transportState === 'connected' || transportState === 'degraded';
  const transportBadge = isConnected
    ? `${TRANSPORT_LABELS[activeTransportId] || activeTransportId.toUpperCase()}${rttMs ? ` · ${rttMs} мс` : ''}`
    : `Офлайн${outbox.length ? ` · Outbox (${outbox.length})` : ''}`;

  return html`<aside class=${`sidebar ${ui.activeChatId ? 'mobile-hidden' : ''}`}>
    <!-- Оконные точки + переключатели пространств из макета Desktop -->
    <div class="sidebar-top">
      <div class="window-dots" aria-hidden="true">
        <span class="dot red"></span>
        <span class="dot yellow"></span>
        <span class="dot green"></span>
      </div>

      <div class="space-tabs">
        <div class="space-pills">
          <button
            type="button"
            class=${`space-tab tab-w ${ui.spaceFilter === 'all' ? 'active' : ''}`}
            title="Все зашифрованные чаты"
            onClick=${() => { store.ui.spaceFilter = 'all'; notifyStore(); }}
          >W</button>
          <button
            type="button"
            class=${`space-tab tab-h ${ui.spaceFilter === 'rooms' ? 'active' : ''}`}
            title="Каналы и группы"
            onClick=${() => { store.ui.spaceFilter = 'rooms'; notifyStore(); }}
          >S</button>
          <button
            type="button"
            class=${`space-tab tab-g ${ui.spaceFilter === 'ask' ? 'active' : ''}`}
            title="Голая правда (Анонимные E2E-вопросы)"
            onClick=${() => { store.ui.spaceFilter = 'ask'; notifyStore(); }}
          >Q</button>
        </div>

        <button
          type="button"
          class="space-add-btn"
          title="Начать новый E2E-чат по @username"
          onClick=${() => { store.ui.modal = 'new-chat'; notifyStore(); }}
        ><${Icon} name="plus" size=${16} /></button>
      </div>
    </div>

    <!-- Лавандово-фиолетовый баннер Work Space с живым статусом транспорта -->
    <div class="workspace-banner">
      <div class="ws-banner-text">
        <div class="ws-title">@${me?.username || 'anon'}</div>
        <button
          type="button"
          class=${`transport-chip ${isConnected ? 'online' : 'offline'}`}
          onClick=${() => { store.ui.modal = 'settings'; notifyStore(); }}
          title="Нажмите для переключения транспорта (WS / Tor / I2P / P2P)"
        >
          <span class="status-dot"></span>
          <span>${transportBadge}</span>
        </button>
      </div>
      <button
        type="button"
        class="ws-edit-btn"
        title="Настройки сети, обновлений и безопасности"
        onClick=${() => { store.ui.modal = 'settings'; notifyStore(); }}
      ><${Icon} name="settings" size=${16} /></button>
    </div>

    ${update?.available && !update.dismissed && html`<div class="sidebar-update-card">
      <div class="sidebar-update-top">
        <span class="sidebar-update-title">✨ MeshChat v${update.remoteVersion || APP_VERSION}</span>
        ${!update.downloading && html`<button type="button" class="icon-btn small" onClick=${dismissUpdateBanner}>
          <${Icon} name="close" size=${13} />
        </button>`}
      </div>
      <div class="sidebar-update-sub">
        ${update.downloading
          ? (update.statusText || `Скачивание ${update.progress}%…`)
          : 'Доступна свежая сборка с проверкой SHA-256'}
      </div>
      ${update.downloading
        ? html`<div class="update-progress-track"><div class="update-progress-fill" style=${`width:${Math.max(6, update.progress)}%`}></div></div>`
        : html`<button type="button" class="btn-update-now full" onClick=${applyAppUpdate}>
            <${Icon} name="download" size=${14} /> Установить обновление
          </button>`}
    </div>`}

    <!-- Поиск по локальной зашифрованной БД -->
    <div class="sidebar-search">
      <${Icon} name="search" size=${15} />
      <input
        type="search"
        placeholder="Поиск в локальном сейфе…"
        value=${ui.searchQuery}
        onInput=${(e) => { store.ui.searchQuery = e.target.value; notifyStore(); }}
      />
    </div>

    <div class="sidebar-section-label">НЕДАВНИЕ</div>

    <div class="chat-list">
      ${allChats.length === 0 && html`<div class="empty-list-hint">
        Пока нет диалогов. Нажмите <b>+</b>, чтобы начать зашифрованный X3DH-чат по <code>@username</code>.
      </div>`}

      ${allChats.map((c) => {
        const active = ui.activeChatId === c.id;
        const initials = (c.username || c.title || '?').replace(/^@/, '').slice(0, 2).toUpperCase();
        return html`<div
          key=${c.id}
          class=${`chat-item ${active ? 'active' : ''}`}
          onClick=${() => selectChat(c.id)}
        >
          <div class="avatar" style=${`background:${c.avatarColor || '#6D60F6'}`}>
            <span>${c.kind === 'ask' ? '🎭' : initials}</span>
            <span class=${`avatar-dot ${c.verified ? 'verified' : 'e2e'}`} title=${c.verified ? 'Ключи сверены' : 'Signal E2E'}></span>
          </div>
          <div class="chat-item-body">
            <div class="chat-item-row">
              <span class="chat-item-title">${c.title}</span>
              <span class="chat-item-time">${formatTime(c.lastTs)}</span>
            </div>
            <div class="chat-item-row">
              <span class="chat-item-sub">${c.lastPreview || '🔒 Зашифрованный канал'}</span>
              ${c.unread > 0 && html`<span class="unread-badge">${c.unread}</span>`}
            </div>
          </div>
        </div>`;
      })}
    </div>

    <!-- Плавающая кнопка + и нижняя навигация для мобильного режима (макет 2) -->
    <button
      type="button"
      class="mobile-fab"
      title="Новый зашифрованный чат"
      onClick=${() => { store.ui.modal = 'new-chat'; notifyStore(); }}
    ><${Icon} name="plus" size=${22} /></button>

    <nav class="mobile-bottom-nav">
      <button type="button" class=${ui.spaceFilter === 'all' ? 'active' : ''} onClick=${() => { store.ui.spaceFilter = 'all'; notifyStore(); }}>
        <${Icon} name="chat" size=${19} /><span>Чаты</span>
      </button>
      <button type="button" onClick=${() => { store.ui.modal = 'new-chat'; notifyStore(); }}>
        <${Icon} name="users" size=${19} /><span>Контакт</span>
      </button>
      <button type="button" class=${ui.spaceFilter === 'ask' ? 'active' : ''} onClick=${() => { store.ui.spaceFilter = 'ask'; selectChat('ask:inbox'); }}>
        <${Icon} name="flame" size=${19} /><span>Правда</span>
      </button>
      <button type="button" onClick=${() => { store.ui.modal = 'settings'; notifyStore(); }}>
        <${Icon} name="globe" size=${19} /><span>Сеть</span>
      </button>
    </nav>
  </aside>`;
}
