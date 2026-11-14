// Центральная панель зашифрованного диалога MeshChat v1.7:
// 4-стадийные E2EE статусы (✓ / ✓✓ / Прочитано), индикатор набора текста, поиск внутри чата,
// редактирование и двустороннее удаление сообщений, запись голосовых сообщений AES-256-GCM
// со встроенным аудиоплеером и реальный P2P аудиовызов WebRTC (DTLS-SRTP).

import { html, useState, useRef, useEffect } from '../../vendor/preact.mjs';
import {
  store,
  notifyStore,
  sendChatMessage,
  editChatMessage,
  deleteChatMessage,
  notifyTypingInChat,
  sendEncryptedAttachment,
  openEncryptedMedia,
  saveDecryptedMediaToDevice,
  openPeerProfileModal,
  togglePinChat,
  toggleMessageReaction,
  blockAnonQuestionAuthor,
  toggleBossMode,
  startVoiceCall,
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
  if (status === 'sending') return 'Шифрование…';
  if (status === 'queued') return 'В очереди';
  if (status === 'read') return '✓✓ Прочитано';
  if (status === 'delivered') return '✓✓ Доставлено';
  return '✓ Отправлено';
}

function formatSecClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Встроенный плеер для зашифрованных голосовых сообщений и аудиофайлов */
function EncryptedAudioPlayer({ msg, previewUrl }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [curSec, setCurSec] = useState(0);
  const [durSec, setDurSec] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurSec(el.currentTime || 0);
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setDurSec(el.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setCurSec(0);
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
    };
  }, [previewUrl]);

  const onTogglePlay = async (e) => {
    e.stopPropagation();
    let url = previewUrl;
    if (!url) {
      setLoading(true);
      url = await openEncryptedMedia(msg);
      setLoading(false);
      if (!url) return;
      setTimeout(() => {
        audioRef.current?.play().then(() => setPlaying(true)).catch(() => {});
      }, 40);
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play().then(() => setPlaying(true)).catch(() => {});
    }
  };

  const pct = durSec > 0 ? Math.min(100, (curSec / durSec) * 100) : 0;

  return html`<div class="voice-player-card" onClick=${(e) => e.stopPropagation()}>
    ${previewUrl && html`<audio ref=${audioRef} src=${previewUrl} preload="metadata" />`}
    <button type="button" class="voice-play-btn" disabled=${loading} onClick=${onTogglePlay}>
      <${Icon} name=${playing ? 'pause' : 'play'} size=${15} />
    </button>
    <div class="voice-track-col">
      <div class="voice-progress-bar">
        <div class="voice-progress-fill" style=${`width:${pct.toFixed(1)}%`}></div>
      </div>
      <div class="voice-meta-line">
        <span>${loading ? 'Расшифровка AES-GCM…' : `${formatSecClock(curSec)}${durSec ? ` / ${formatSecClock(durSec)}` : ''}`}</span>
        <span>${formatBytes(msg.media?.size || 0)} · E2EE</span>
      </div>
    </div>
  </div>`;
}

export function ChatView() {
  const { chats, messages, decryptedMediaUrls, typingByChat, ui, me, settings } = store;
  const chat = ui.activeChatId ? chats[ui.activeChatId] : null;
  const rawList = (chat && messages[chat.id]) || [];

  const [draft, setDraft] = useState('');
  const [onceToggle, setOnceToggle] = useState(false);
  const [activeMsgActionsId, setActiveMsgActionsId] = useState(null);

  // Запись зашифрованного голосового сообщения
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recorderRef = useRef(null);
  const recChunksRef = useRef([]);
  const recTimerRef = useRef(null);
  const recCanceledRef = useRef(false);

  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (ui.editingMsg && ui.editingMsg.chatId === chat?.id) {
      setDraft(ui.editingMsg.text || '');
    }
  }, [ui.editingMsg?.id, chat?.id]);

  useEffect(() => {
    if (scrollRef.current && !ui.chatSearchOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat?.id, rawList.length]);

  useEffect(() => () => {
    clearInterval(recTimerRef.current);
    try { recorderRef.current?.stream?.getTracks()?.forEach((t) => t.stop()); } catch { /* ignore */ }
  }, []);

  if (!chat) {
    return html`<main class="chat-pane empty-pane">
      <div class="empty-card">
        <div class="empty-icon"><${Icon} name="mesh" size=${34} /></div>
        <h2>Сквозное шифрование Signal Protocol</h2>
        <p>
          Все сообщения, голосовые записи, звонки и профили защищены <b>X3DH + Double Ratchet</b>
          (NIST P-256, HKDF-SHA256, AES-256-GCM) в конвертах <b>Sealed Sender</b>.
          Узел ретрансляции не хранит метаданные и IP-адреса.
        </p>
        <div class="empty-actions">
          <button type="button" class="btn-primary" onClick=${() => { store.ui.modal = 'new-chat'; notifyStore(); }}>
            <${Icon} name="plus" size=${15} /> Новый диалог
          </button>
          <button type="button" class="btn-ghost" onClick=${() => { store.ui.modal = 'qr'; notifyStore(); }}>
            <${Icon} name="qr" size=${15} /> Мой QR-код
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
  const isPeerTyping = (typingByChat[chat.id] || 0) > Date.now();

  const searchQ = (ui.chatSearchOpen && ui.chatSearchQuery || '').trim().toLowerCase();
  const list = searchQ
    ? rawList.filter((m) =>
        (m.text || '').toLowerCase().includes(searchQ) ||
        (m.media?.name || '').toLowerCase().includes(searchQ)
      )
    : rawList;

  const onSubmit = async (e) => {
    e?.preventDefault();
    if (!draft.trim()) return;
    const text = draft;
    setDraft('');
    if (ui.editingMsg && ui.editingMsg.chatId === chat.id) {
      await editChatMessage(chat.id, ui.editingMsg.id, text);
      return;
    }
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

  const startVoiceRecording = async () => {
    if (recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast('Запись микрофона недоступна в текущем браузере', 'err');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const mime = MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported?.('audio/mp4')
          ? 'audio/mp4'
          : '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recChunksRef.current = [];
      recCanceledRef.current = false;
      recorderRef.current = rec;

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recChunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        clearInterval(recTimerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setRecSec(0);
        if (recCanceledRef.current || !recChunksRef.current.length) return;
        const actualMime = (rec.mimeType || 'audio/webm').split(';')[0];
        const ext = actualMime.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(recChunksRef.current, { type: actualMime });
        if (blob.size < 256) return;
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: actualMime });
        await sendEncryptedAttachment(chat.id, file, { once: onceToggle });
      };

      rec.start(250);
      setRecording(true);
      setRecSec(0);
      clearInterval(recTimerRef.current);
      recTimerRef.current = setInterval(() => setRecSec((s) => s + 1), 1000);
    } catch (err) {
      showToast(`Микрофон недоступен: ${err.message}`, 'err');
    }
  };

  const finishVoiceRecording = (cancel = false) => {
    recCanceledRef.current = Boolean(cancel);
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      } else {
        setRecording(false);
      }
    } catch {
      setRecording(false);
    }
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
    startVoiceCall(chat.id);
  };

  const onBubbleDoubleAction = (m) => {
    const action = settings.doubleTapAction || 'reply';
    if (action === 'none') return;
    if (action === 'reply' && (chat.kind === 'dm' || chat.kind === 'echo')) {
      store.ui.editingMsg = null;
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
    if (e.key === 'Escape' && (ui.editingMsg || ui.replyTo)) {
      store.ui.editingMsg = null;
      store.ui.replyTo = null;
      setDraft('');
      notifyStore();
      return;
    }
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
            ${isPeerTyping
              ? html`<span class="typing-live-pill">печатает… (E2EE)</span>`
              : html`<span>
                  ${chat.kind === 'echo'
                    ? 'Локальный сейф и самопроверка AES-256-GCM'
                    : chat.kind === 'ask'
                      ? 'Внешний E2E-шлюз приёма обращений'
                      : chat.peerProfile?.statusText || (chat.verified ? 'Ключ подтверждён · Double Ratchet' : `@${chat.username} · нажмите для профиля`)}
                </span>`}
            ${chat.ttlSec > 0 && html`<span class="ttl-pill">TTL ${ttlText(chat.ttlSec)}</span>`}
          </div>
        </div>
      </div>

      <div class="chat-header-actions">
        <button
          type="button"
          class=${`circle-btn ghost ${ui.chatSearchOpen ? 'active' : ''}`}
          title="Поиск сообщений в диалоге"
          onClick=${() => {
            store.ui.chatSearchOpen = !store.ui.chatSearchOpen;
            if (!store.ui.chatSearchOpen) store.ui.chatSearchQuery = '';
            notifyStore();
          }}
        ><${Icon} name="search" size=${15} /></button>

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
          title="Параметры шифрования, очистка и TTL"
          onClick=${() => { store.ui.inspectorOpen = !store.ui.inspectorOpen; notifyStore(); }}
        ><${Icon} name="info" size=${15} /></button>
      </div>
    </header>

    ${ui.chatSearchOpen && html`<div class="inchat-search-bar">
      <${Icon} name="search" size=${14} />
      <input
        type="search"
        placeholder="Найти текст или файл в этом диалоге…"
        autofocus
        value=${ui.chatSearchQuery || ''}
        onInput=${(e) => { store.ui.chatSearchQuery = e.target.value; notifyStore(); }}
      />
      <span class="inchat-search-count">${searchQ ? `${list.length} совп.` : `${rawList.length} сообщ.`}</span>
      <button
        type="button"
        class="icon-btn small"
        onClick=${() => { store.ui.chatSearchOpen = false; store.ui.chatSearchQuery = ''; notifyStore(); }}
      ><${Icon} name="close" size=${13} /></button>
    </div>`}

    <div class="messages-scroll" ref=${scrollRef}>
      ${list.length === 0 && searchQ && html`<div class="empty-list-hint">
        По запросу «${ui.chatSearchQuery}» в этом диалоге ничего не найдено.
      </div>`}

      ${list.map((m) => {
        const dayStr = formatDatePill(m.ts);
        const showDay = dayStr !== lastDateLabel;
        lastDateLabel = dayStr;

        const isSystemNotice = m.type === 'highlight' || m.type === 'ask';
        const mediaObj = m.media;
        const previewUrl = mediaObj && !mediaObj.once ? decryptedMediaUrls[mediaObj.blobId] : null;
        const isAudio = Boolean(mediaObj?.mime?.startsWith('audio/'));

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
                  ${m.editedAt && html` · изм.`}
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
                  : isAudio
                    ? html`<${EncryptedAudioPlayer} msg=${m} previewUrl=${previewUrl} />`
                    : previewUrl && mediaObj.mime?.startsWith('image/')
                      ? html`<img class="decrypted-img" src=${previewUrl} alt=${mediaObj.name} />`
                      : html`<button type="button" class="file-dl-btn" onClick=${async () => {
                          if (mediaObj.mime?.startsWith('image/')) {
                            await openEncryptedMedia(m);
                          } else {
                            await saveDecryptedMediaToDevice(m);
                          }
                        }}>
                          <${Icon} name="lock" size=${16} />
                          <div>
                            <b>${mediaObj.name}</b>
                            <span>${formatBytes(mediaObj.size)} · AES-256-GCM · нажмите для расшифровки</span>
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

              ${!isSystemNotice && html`<div class="msg-hover-bar" onClick=${(e) => e.stopPropagation()}>
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
                    store.ui.editingMsg = null;
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
                ${m.out && m.text && !m.media && html`<button
                  type="button"
                  title="Редактировать сообщение"
                  onClick=${() => {
                    store.ui.replyTo = null;
                    store.ui.editingMsg = { id: m.id, chatId: chat.id, text: m.text };
                    setDraft(m.text);
                    setActiveMsgActionsId(null);
                    notifyStore();
                  }}
                ><${Icon} name="edit" size=${13} /></button>`}
                <button
                  type="button"
                  title=${m.out && chat.kind === 'dm' ? 'Удалить у обоих собеседников' : 'Удалить локально'}
                  onClick=${() => {
                    deleteChatMessage(chat.id, m.id, { forEveryone: Boolean(m.out && chat.kind === 'dm') });
                    setActiveMsgActionsId(null);
                  }}
                ><${Icon} name="trash" size=${13} /></button>
              </div>`}
            </div>
          </div>
        </div>`;
      })}
    </div>

    ${chat.kind === 'ask'
      ? html`<div class="composer-bar ask-share-bar">
          <span>Внешний адрес приёма E2E-обращений: <code>/q/${me?.username}</code></span>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn-ghost compact" onClick=${() => { store.ui.modal = 'qr'; store.ui.modalData = { tab: 'ask' }; notifyStore(); }}>
              <${Icon} name="qr" size=${14} /> QR
            </button>
            <button type="button" class="btn-primary compact" onClick=${copyAskLink}>Копировать адрес</button>
          </div>
        </div>`
      : recording
        ? html`<div class="composer-bar voice-rec-bar">
            <span class="voice-rec-dot"></span>
            <span class="voice-rec-label">Запись голосового E2EE · <b>${formatSecClock(recSec)}</b></span>
            <div style="display:flex;gap:6px;margin-left:auto">
              <button type="button" class="btn-ghost compact" onClick=${() => finishVoiceRecording(true)}>
                Отмена
              </button>
              <button type="button" class="btn-primary compact" onClick=${() => finishVoiceRecording(false)}>
                <${Icon} name="send" size=${14} /> Отправить
              </button>
            </div>
          </div>`
        : html`<form class="composer-wrap" onSubmit=${onSubmit}>
            ${ui.editingMsg && ui.editingMsg.chatId === chat.id && html`<div class="composer-reply-banner editing">
              <span>Редактирование: ${(ui.editingMsg.text || '').slice(0, 80)}</span>
              <button type="button" onClick=${() => { store.ui.editingMsg = null; setDraft(''); notifyStore(); }}>
                <${Icon} name="close" size=${14} />
              </button>
            </div>`}

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
                onInput=${(e) => {
                  setDraft(e.target.value);
                  if (e.target.value.trim()) notifyTypingInChat(chat.id);
                }}
                onKeyDown=${onComposerKeyDown}
              ></textarea>

              <button
                type="button"
                class="composer-icon"
                title="Скрытый фрагмент текста ||...||"
                onClick=${() => setDraft((d) => (d ? `||${d}||` : '||скрытый текст||'))}
              ><${Icon} name="eyeOff" size=${16} /></button>

              ${!draft.trim() && !ui.editingMsg
                ? html`<button
                    type="button"
                    class="composer-send mic-btn"
                    title="Записать голосовое сообщение E2EE"
                    onClick=${startVoiceRecording}
                  ><${Icon} name="mic" size=${17} /></button>`
                : html`<button type="submit" class="composer-send" title="Зашифровать и отправить">
                    <${Icon} name=${ui.editingMsg ? 'check' : 'send'} size=${17} />
                  </button>`}
            </div>
          </form>`}
  </main>`;
}
