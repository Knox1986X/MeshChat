// Центральная область чата: парящая верхняя плашка с кнопкой «Прикрыться»,
// лента сообщений с E2E-карточками, одноразовыми медиа (once), спойлерами и капсула ввода.

import { html, useState, useRef, useEffect } from '../../vendor/preact.mjs';
import {
  store,
  notifyStore,
  sendChatMessage,
  sendEncryptedAttachment,
  openEncryptedMedia,
  toggleMessageReaction,
  openSafetyVerificationModal,
  blockAnonQuestionAuthor,
  toggleBossMode,
  showToast,
} from '../store/app-store.mjs';
import {
  Icon,
  RichMessageText,
  formatTime,
  formatDatePill,
  formatBytes,
  ttlText,
} from './boss-screen.mjs';

const QUICK_REACTIONS = ['👍', '🔥', '❤️', '🕶️', '⚡'];

export function ChatView() {
  const { chats, messages, decryptedMediaUrls, ui, me } = store;
  const chat = ui.activeChatId ? chats[ui.activeChatId] : null;
  const list = (chat && messages[chat.id]) || [];

  const [draft, setDraft] = useState('');
  const [onceToggle, setOnceToggle] = useState(false);
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
        <div class="empty-icon"><${Icon} name="shield" size=${36} /></div>
        <h2>Сквозное шифрование по умолчанию</h2>
        <p>
          Каждое личное сообщение защищено протоколом <b>X3DH + Double Ratchet</b> и обёрнуто
          в <b>Sealed Sender</b>. Сервер не знает, кто с кем общается, и удаляет конверты после доставки.
        </p>
        <div class="empty-actions">
          <button type="button" class="btn-primary" onClick=${() => { store.ui.modal = 'new-chat'; notifyStore(); }}>
            <${Icon} name="plus" size=${16} /> Начать диалог
          </button>
          <button type="button" class="btn-ghost" onClick=${() => toggleBossMode(true)}>
            <${Icon} name="glasses" size=${16} /> Прикрыться (Esc Esc)
          </button>
        </div>
      </div>
    </main>`;
  }

  const initials = (chat.username || chat.title || '?').replace(/^@/, '').slice(0, 2).toUpperCase();

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
    const link = `${location.origin}/q/${me?.username}`;
    navigator.clipboard?.writeText(link).catch(() => {});
    showToast(`Анонимная ссылка скопирована: ${link}`);
  };

  let lastDateLabel = '';

  return html`<main class="chat-pane">
    <!-- Парящая верхняя плашка из макета 1 -->
    <header class="chat-header">
      <button
        type="button"
        class="icon-btn mobile-back-btn"
        title="Назад к списку"
        onClick=${() => { store.ui.activeChatId = null; notifyStore(); }}
      ><${Icon} name="back" size=${20} /></button>

      <div class="chat-header-peer" onClick=${() => chat.kind === 'dm' && openSafetyVerificationModal(chat.id)}>
        <div class="avatar small" style=${`background:${chat.avatarColor || '#6D60F6'}`}>
          <span>${chat.kind === 'ask' ? '🎭' : initials}</span>
        </div>
        <div>
          <div class="peer-name">${chat.title}</div>
          <div class="peer-sub">
            <${Icon} name=${chat.verified ? 'shield' : 'lock'} size=${12} />
            <span>
              ${chat.kind === 'ask'
                ? 'Анонимные E2E-вопросы без регистрации'
                : chat.verified
                  ? 'Ключи сверены · Double Ratchet'
                  : 'Signal E2E · Нажмите для сверки ключей'}
            </span>
            ${chat.ttlSec > 0 && html`<span class="ttl-pill">⏱ ${ttlText(chat.ttlSec)}</span>`}
          </div>
        </div>
      </div>

      <div class="chat-header-actions">
        <button
          type="button"
          class="circle-btn ghost"
          title="Прикрыться (горячая клавиша: двойной Esc)"
          onClick=${() => toggleBossMode(true)}
        ><${Icon} name="glasses" size=${17} /></button>

        ${chat.kind === 'dm' && html`<button
          type="button"
          class="circle-btn green"
          title="Зашифрованный P2P-звонок (WebRTC)"
          onClick=${() => { store.ui.modal = 'call'; store.ui.modalData = { chat }; notifyStore(); }}
        ><${Icon} name="phone" size=${16} /></button>`}

        <button
          type="button"
          class=${`circle-btn blue ${ui.inspectorOpen ? 'active' : ''}`}
          title="Панель профиля и безопасности"
          onClick=${() => { store.ui.inspectorOpen = !store.ui.inspectorOpen; notifyStore(); }}
        ><${Icon} name="info" size=${16} /></button>
      </div>
    </header>

    <!-- Лента сообщений -->
    <div class="messages-scroll" ref=${scrollRef}>
      ${list.map((m) => {
        const dayStr = formatDatePill(m.ts);
        const showDay = dayStr !== lastDateLabel;
        lastDateLabel = dayStr;

        const isHighlight = m.type === 'highlight' || m.type === 'ask';
        const mediaObj = m.media;
        const previewUrl = mediaObj && !mediaObj.once ? decryptedMediaUrls[mediaObj.blobId] : null;

        return html`<div key=${m.id}>
          ${showDay && html`<div class="date-pill-wrap"><span class="date-pill">${dayStr}</span></div>`}

          <div class=${`msg-row ${m.out ? 'outgoing' : 'incoming'}`}>
            ${!m.out && html`<div class="avatar tiny" style=${`background:${chat.avatarColor || '#6D60F6'}`}>
              ${chat.kind === 'ask' ? '🎭' : initials}
            </div>`}

            <div class=${`msg-bubble ${m.out ? 'bubble-out' : isHighlight ? 'bubble-amber' : 'bubble-in'}`}>
              <div class="msg-meta-top">
                <span class="msg-author">
                  ${m.out ? 'Вы' : m.type === 'ask' ? 'Анонимный гость (E2E)' : chat.title}
                </span>
                <span class="msg-time">
                  ${formatTime(m.ts)}
                  ${m.expiresAt > 0 && html` · ⏱`}
                  ${m.out && html` · ${m.status === 'queued' ? '⏳ Outbox' : '✓'}`}
                </span>
              </div>

              ${m.replyTo && html`<div class="msg-reply-quote">
                <span>↩ ${m.replyTo.text}</span>
              </div>`}

              <!-- Карточка зашифрованного файла или одноразового медиа -->
              ${mediaObj && html`<div class="media-card">
                ${mediaObj.once
                  ? html`<button
                      type="button"
                      class=${`once-media-btn ${mediaObj.burned ? 'burned' : ''}`}
                      disabled=${Boolean(mediaObj.burned)}
                      onClick=${() => openEncryptedMedia(m)}
                    >
                      <${Icon} name="flame" size=${18} />
                      <div>
                        <b>${mediaObj.burned ? 'Одноразовое медиа уничтожено' : 'Одноразовое фото/файл'}</b>
                        <span>${mediaObj.burned ? 'Удалено с сервера после просмотра' : `${formatBytes(mediaObj.size)} · Нажмите для 1 просмотра`}</span>
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
                          <span>${formatBytes(mediaObj.size)} · Расшифровать AES-256-GCM</span>
                        </div>
                      </button>`}
              </div>`}

              ${m.text && html`<div class="msg-text"><${RichMessageText} text=${m.text} /></div>`}

              <!-- Действия для вопросов «Голой правды» -->
              ${m.type === 'ask' && m.senderBlockTag && html`<div class="ask-actions">
                <button type="button" onClick=${() => blockAnonQuestionAuthor(m.senderBlockTag)}>
                  Заблокировать автора (по слепому HMAC)
                </button>
              </div>`}

              <!-- Реакции -->
              ${m.reactions && Object.keys(m.reactions).length > 0 && html`<div class="reactions-bar">
                ${Object.entries(m.reactions).map(([em, users]) => html`<button
                  key=${em}
                  type="button"
                  class=${`reaction-chip ${users.includes(me?.userId) ? 'mine' : ''}`}
                  onClick=${() => toggleMessageReaction(chat.id, m.id, em)}
                >${em} ${users.length}</button>`)}
              </div>`}

              ${chat.kind === 'dm' && html`<div class="msg-hover-bar">
                ${QUICK_REACTIONS.map((em) => html`<button
                  key=${em}
                  type="button"
                  onClick=${() => toggleMessageReaction(chat.id, m.id, em)}
                >${em}</button>`)}
                <button type="button" title="Ответить" onClick=${() => { store.ui.replyTo = m; notifyStore(); }}>↩</button>
              </div>`}
            </div>
          </div>
        </div>`;
      })}
    </div>

    <!-- Нижняя капсула ввода -->
    ${chat.kind === 'ask'
      ? html`<div class="composer-bar ask-share-bar">
          <span>Поделитесь своей ссылкой для приёма E2E-вопросов: <code>/q/${me?.username}</code></span>
          <button type="button" class="btn-primary compact" onClick=${copyAskLink}>Скопировать ссылку</button>
        </div>`
      : html`<form class="composer-wrap" onSubmit=${onSubmit}>
          ${ui.replyTo && html`<div class="composer-reply-banner">
            <span>Ответ: ${(ui.replyTo.text || 'медиа').slice(0, 80)}</span>
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
              title="Прикрепить файл (будет зашифрован на клиенте до отправки)"
              onClick=${() => fileInputRef.current?.click()}
            ><${Icon} name="clip" size=${18} /></button>

            <button
              type="button"
              class=${`composer-icon ${onceToggle ? 'once-active' : ''}`}
              title="Режим одноразового файла (удаляется с сервера сразу после просмотра)"
              onClick=${() => setOnceToggle((v) => !v)}
            ><${Icon} name="flame" size=${17} /></button>

            <input
              class="composer-input"
              type="text"
              placeholder=${'Напишите сообщение… (||спойлер||, **жирный**, `код`)'}
              value=${draft}
              onInput=${(e) => setDraft(e.target.value)}
            />

            <button
              type="button"
              class="composer-icon"
              title="Обернуть выделенный/введённый текст в спойлер"
              onClick=${() => setDraft((d) => (d ? `||${d}||` : '||секрет||'))}
            >🍃</button>

            <button type="submit" class="composer-send" title="Зашифровать и отправить">
              <${Icon} name="send" size=${18} />
            </button>
          </div>
        </form>`}
  </main>`;
}
