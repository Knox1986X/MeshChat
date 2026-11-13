// Центральная панель зашифрованного диалога: заголовок с кастомным профилем собеседника,
// лента сообщений с индикацией доставки, однократными вложениями [1×], реакциями и вводом.

import { html, useState, useRef, useEffect } from '../../vendor/preact.mjs';
import {
  store,
  notifyStore,
  sendChatMessage,
  sendEncryptedAttachment,
  openEncryptedMedia,
  openPeerProfileModal,
  togglePinChat,
  toggleMessageReaction,
  blockAnonQuestionAuthor,
  toggleBossMode,
  copyWithPrivacy,
  showToast,
} from '../store/app-store.mjs';
import {
  Icon,
  AvatarBox,
  ProfileBadgeIcon,
  RichMessageText,
  formatTime,
  formatDatePill,
  formatBytes,
  ttlText,
} from './boss-screen.mjs';

function statusLabel(status) {
  if (status === 'sending') return 'Шифрование';
  if (status === 'queued') return 'В очереди';
  return 'Доставлено';
}

export function ChatView() {
  const { chats, messages, decryptedMediaUrls, ui, me, settings } = store;
  const chat = ui.activeChatId ? chats[ui.activeChatId] : null;
  const list = (chat && messages[chat.id]) || [];

  const [draft, setDraft] = useState('');
  const [onceToggle, setOnceToggle] = useState(false);
  const [activeMsgActionsId, setActiveMsgActionsId] = useState(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat?.id, list.length]);

  if (!chat) {
    return html`<main class="chat-pane empty-pane">
      <div class="empty-card">
        <div class="empty-icon"><${Icon} name="mesh" size=${34} /></div>
        <h2>Сквозное шифрование Signal Protocol</h2>
        <p>
          Все сообщения, файлы и кастомные профили защищены <b>X3DH + Double Ratchet</b> (NIST P-256,
          HKDF-SHA256, AES-256-GCM) в конвертах <b>Sealed Sender</b>.
          Узел ретрансляции не хранит метаданные и IP-адреса.
        </p>
        <div class="empty-actions">
          <button type="button" class="btn-primary" onClick=${() => { store.ui.modal = 'new-chat'; notifyStore(); }}>
            <${Icon} name="plus" size=${15} /> Новый диалог
          </button>
          <button type="button" class="btn-ghost" onClick=${() => toggleBossMode(true)}>
            <${Icon} name="eyeOff" size=${15} /> Блокировка (Esc×2)
          </button>
        </div>
      </div>
    </main>`;
  }

  const displayTitle = chat.peerProfile?.displayName || chat.title;
  const peerBadge = chat.peerProfile?.badge || (chat.verified ? 'verified' : 'none');

  const onSubmit = async (e) => {
    e?.preventDefault();
    if (!draft.trim()) return;
    const text = draft;
    setDraft('');
    await sendChatMessage(chat.id, text);
  };

  const onFileSelected = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const file of files) {
      await sendEncryptedAttachment(chat.id, file, { once: onceToggle, caption: draft.trim() });
    }
    if (draft.trim()) setDraft('');
  };

  const copyAskLink = () => {
    const base = store.settings.serverUrl ? store.settings.serverUrl.replace(/\/+$/, '') : location.origin;
    const link = `${base}/q/${me?.username}`;
    copyWithPrivacy(link, `Адрес приёмного шлюза скопирован: ${link}`);
  };

  const copyMessageText = (txt) => {
    if (!txt) return;
    copyWithPrivacy(txt, 'Текст скопирован в буфер обмена');
  };

  const startCallFlow = () => {
    if (settings.confirmCall) {
      if (typeof window !== 'undefined' && !window.confirm(`Начать защищённый голосовой P2P-вызов с ${displayTitle}?`)) {
        return;
      }
    }
    store.ui.modal = 'call';
    store.ui.modalData = { chat };
    notifyStore();
  };

  const onBubbleDoubleAction = (m) => {
    const action = settings.doubleTapAction || 'reply';
    if (action === 'none') return;
    if (action === 'reply' && (chat.kind === 'dm' || chat.kind === 'echo')) {
      store.ui.replyTo = m;
      notifyStore();
      showToast('Сообщение добавлено в цитату');
    } else if (action === 'copy' && m.text) {
      copyMessageText(m.text);
    } else if (action === 'react' && (chat.kind === 'dm' || chat.kind === 'echo')) {
      toggleMessageReaction(chat.id, m.id, '👍');
    }
  };

  const onComposerKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    const enterSends = settings.enterToSend !== false;
    if (enterSends && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    } else if (!enterSends && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  let lastDateLabel = '';

  return html`<main class="chat-pane">
    <header class="chat-header">
      <button
        type="button"
        class="icon-btn mobile-back-btn"
        title="Назад к списку чатов"
        onClick=${() => { store.ui.activeChatId = null; notifyStore(); }}
      ><${Icon} name="back" size=${20} /></button>

      <div class="chat-header-peer" onClick=${() => chat.kind === 'dm' && openPeerProfileModal(chat.id)}>
        <${AvatarBox}
          title=${displayTitle}
          username=${chat.username}
          avatarDataUrl=${chat.peerProfile?.avatarDataUrl || ''}
          color=${chat.avatarColor || '#3B4CCA'}
          kind=${chat.kind}
          size=${40}
        />
        <div class="peer-meta-col">
          <div class="peer-name">
            <span>${displayTitle}</span>
            <${ProfileBadgeIcon} badge=${peerBadge} size=${13} />
          </div>
          <div class="peer-sub">
            <${Icon} name=${chat.verified || chat.kind !== 'dm' ? 'shield' : 'lock'} size=${12} />
            <span>
              ${chat.kind === 'echo'
                ? 'Локальный сейф и самопроверка AES-256-GCM'
                : chat.kind === 'ask'
                  ? 'Внешний E2E-шлюз приёма обращений'
                  : chat.peerProfile?.statusText || (chat.verified ? 'Ключ подтверждён · Double Ratchet' : `@${chat.username} · нажмите для профиля`)}
            </span>
            ${chat.ttlSec > 0 && html`<span class="ttl-pill">TTL ${ttlText(chat.ttlSec)}</span>`}
          </div>
        </div>
      </div>

      <div class="chat-header-actions">
        <button
          type="button"
          class=${`circle-btn ghost ${chat.pinned ? 'active' : ''}`}
          title=${chat.pinned ? 'Открепить чат' : 'Закрепить чат'}
          onClick=${() => togglePinChat(chat.id)}
        ><${Icon} name="pin" size=${15} /></button>

        <button
          type="button"
          class="circle-btn ghost"
          title="Экстренная блокировка экрана (двойной Esc)"
          onClick=${() => toggleBossMode(true)}
        ><${Icon} name="eyeOff" size=${15} /></button>

        ${chat.kind === 'dm' && html`<button
          type="button"
          class="circle-btn green"
          title="Голосовой P2P-канал (DTLS-SRTP)"
          onClick=${startCallFlow}
        ><${Icon} name="phone" size=${15} /></button>`}

        <button
          type="button"
          class=${`circle-btn blue ${ui.inspectorOpen ? 'active' : ''}`}
          title="Параметры шифрования и TTL"
          onClick=${() => { store.ui.inspectorOpen = !store.ui.inspectorOpen; notifyStore(); }}
        ><${Icon} name="info" size=${15} /></button>
      </div>
    </header>

    <div class="messages-scroll" ref=${scrollRef}>
      ${list.map((m) => {
        const dayStr = formatDatePill(m.ts);
        const showDay = dayStr !== lastDateLabel;
        lastDateLabel = dayStr;

        const isSystemNotice = m.type === 'highlight' || m.type === 'ask';
        const mediaObj = m.media;
        const previewUrl = mediaObj && !mediaObj.once ? decryptedMediaUrls[mediaObj.blobId] : null;

        return html`<div key=${m.id}>
          ${showDay && html`<div class="date-pill-wrap"><span class="date-pill">${dayStr}</span></div>`}

          <div class=${`msg-row ${m.out ? 'outgoing' : 'incoming'}`}>
            ${!m.out && settings.showChatAvatars !== false && html`<${AvatarBox}
              title=${displayTitle}
              username=${chat.username}
              avatarDataUrl=${chat.peerProfile?.avatarDataUrl || ''}
              color=${chat.avatarColor || '#3B4CCA'}
              kind=${chat.kind}
              size=${30}
            />`}

            <div
              class=${`msg-bubble ${m.out ? 'bubble-out' : isSystemNotice ? 'bubble-amber' : 'bubble-in'} ${activeMsgActionsId === m.id ? 'actions-open' : ''}`}
              onClick=${() => setActiveMsgActionsId((cur) => (cur === m.id ? null : m.id))}
              onDblClick=${() => onBubbleDoubleAction(m)}
            >
              <div class="msg-meta-top">
                <span class="msg-author">
                  ${m.out ? 'Вы' : m.type === 'ask' ? 'Анонимный отправитель (E2E)' : displayTitle}
                </span>
                <span class="msg-time">
                  ${formatTime(m.ts, settings.timeFormat)}
                  ${m.expiresAt > 0 && html` · TTL`}
                  ${m.out && html` · <span class=${`msg-status-tag ${m.status || 'sent'}`}>${statusLabel(m.status)}</span>`}
                </span>
              </div>

              ${m.replyTo && html`<div class="msg-reply-quote">
                <span>${m.replyTo.text}</span>
              </div>`}

              ${mediaObj && html`<div class="media-card">
                ${mediaObj.once
                  ? html`<button
                      type="button"
                      class=${`once-media-btn ${mediaObj.burned ? 'burned' : ''}`}
                      disabled=${Boolean(mediaObj.burned)}
                      onClick=${() => openEncryptedMedia(m)}
                    >
                      <${Icon} name="once" size=${18} />
                      <div>
                        <b>${mediaObj.burned ? 'Вложение [1×] уничтожено' : 'Зашифрованное вложение [1×]'}</b>
                        <span>${mediaObj.burned ? 'Стерто с узла после однократного чтения' : `${formatBytes(mediaObj.size)} · Доступно 1 открытие`}</span>
                      </div>
                    </button>`
                  : previewUrl && mediaObj.mime?.startsWith('image/')
                    ? html`<img class="decrypted-img" src=${previewUrl} alt=${mediaObj.name} />`
                    : html`<button type="button" class="file-dl-btn" onClick=${async () => {
                        const url = await openEncryptedMedia(m);
                        if (url && !mediaObj.mime?.startsWith('image/')) {
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = mediaObj.name || 'decrypted.bin';
                          a.click();
                        }
                      }}>
                        <${Icon} name="lock" size=${16} />
                        <div>
                          <b>${mediaObj.name}</b>
                          <span>${formatBytes(mediaObj.size)} · AES-256-GCM</span>
                        </div>
                      </button>`}
              </div>`}

              ${m.text && html`<div class="msg-text"><${RichMessageText} text=${m.text} /></div>`}

              ${m.reactions && Object.keys(m.reactions).length > 0 && html`<div class="msg-reactions-row" onClick=${(e) => e.stopPropagation()}>
                ${Object.entries(m.reactions).map(([emoji, users]) => html`<button
                  key=${emoji}
                  type="button"
                  class=${`reaction-pill ${users.includes(me?.userId) ? 'mine' : ''}`}
                  onClick=${() => toggleMessageReaction(chat.id, m.id, emoji)}
                ><span>${emoji}</span><b>${users.length}</b></button>`)}
              </div>`}

              ${m.type === 'ask' && m.senderBlockTag && html`<div class="ask-actions">
                <button type="button" onClick=${() => blockAnonQuestionAuthor(m.senderBlockTag)}>
                  Заблокировать отправителя (слепой HMAC)
                </button>
              </div>`}

              ${(chat.kind === 'dm' || chat.kind === 'echo') && html`<div class="msg-hover-bar" onClick=${(e) => e.stopPropagation()}>
                <button
                  type="button"
                  title="Отметка 👍"
                  onClick=${() => {
                    toggleMessageReaction(chat.id, m.id, '👍');
                    setActiveMsgActionsId(null);
                  }}
                >👍</button>
                <button
                  type="button"
                  title="Цитировать сообщение"
                  onClick=${() => {
                    store.ui.replyTo = m;
                    setActiveMsgActionsId(null);
                    notifyStore();
                  }}
                ><${Icon} name="reply" size=${13} /></button>
                ${m.text && html`<button
                  type="button"
                  title="Копировать текст"
                  onClick=${() => {
                    copyMessageText(m.text);
                    setActiveMsgActionsId(null);
                  }}
                ><${Icon} name="copy" size=${13} /></button>`}
              </div>`}
            </div>
          </div>
        </div>`;
      })}
    </div>

    ${chat.kind === 'ask'
      ? html`<div class="composer-bar ask-share-bar">
          <span>Внешний адрес приёма E2E-обращений: <code>/q/${me?.username}</code></span>
          <button type="button" class="btn-primary compact" onClick=${copyAskLink}>Копировать адрес</button>
        </div>`
      : html`<form class="composer-wrap" onSubmit=${onSubmit}>
          ${ui.replyTo && html`<div class="composer-reply-banner">
            <span>Цитата: ${(ui.replyTo.text || 'вложение').slice(0, 80)}</span>
            <button type="button" onClick=${() => { store.ui.replyTo = null; notifyStore(); }}>
              <${Icon} name="close" size=${14} />
            </button>
          </div>`}

          <div class="composer-bar">
            <input
              ref=${fileInputRef}
              type="file"
              hidden
              multiple
              onChange=${onFileSelected}
            />
            <button
              type="button"
              class="composer-icon"
              title="Прикрепить зашифрованный файл (AES-256-GCM)"
              onClick=${() => fileInputRef.current?.click()}
            ><${Icon} name="clip" size=${17} /></button>

            ${chat.kind === 'dm' && html`<button
              type="button"
              class=${`composer-icon ${onceToggle ? 'once-active' : ''}`}
              title="Однократный просмотр [1×]: физическое удаление с узла после первого чтения"
              onClick=${() => setOnceToggle((v) => !v)}
            ><${Icon} name="once" size=${17} /></button>`}

            <textarea
              class="composer-input"
              rows="1"
              spellcheck=${settings.spellcheck !== false}
              placeholder=${chat.kind === 'echo'
                ? 'Текст для эхо-проверки E2EE…'
                : settings.enterToSend === false
                  ? 'Сообщение (Ctrl+Enter — отправить)…'
                  : 'Сообщение (E2EE)…'}
              value=${draft}
              onInput=${(e) => setDraft(e.target.value)}
              onKeyDown=${onComposerKeyDown}
            ></textarea>

            <button
              type="button"
              class="composer-icon"
              title="Скрытый фрагмент текста ||...||"
              onClick=${() => setDraft((d) => (d ? `||${d}||` : '||скрытый текст||'))}
            ><${Icon} name="eyeOff" size=${16} /></button>

            <button type="submit" class="composer-send" title="Зашифровать и отправить">
              <${Icon} name="send" size=${17} />
            </button>
          </div>
        </form>`}
  </main>`;
}
