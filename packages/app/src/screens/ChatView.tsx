import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContactView, MeshChatClient, Snapshot } from '../../../core/src/engine';
import { Icon } from '../icons';
import { Avatar, FilePreview, Identicon, StateTicks, CopyButton } from '../ui';
import { bytes, clock, dayLabel, ttlLabel, TTL_OPTIONS } from '../format';

export function ChatView({
  client,
  snap,
  contact,
  onBack,
  onOpenInfo,
  onToast,
  t,
  lang,
}: {
  client: MeshChatClient;
  snap: Snapshot;
  contact: ContactView;
  onBack: () => void;
  onOpenInfo: () => void;
  onToast: (text: string, kind?: 'info' | 'error' | 'success') => void;
  t: (key: string) => string;
  lang: 'ru' | 'en';
}) {
  const [draft, setDraft] = useState('');
  const [ttlOpen, setTtlOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const messages = useMemo(
    () => snap.messages.filter((m) => m.chat === contact.tag).sort((a, b) => a.ts - b.ts),
    [snap.messages, contact.tag],
  );

  useEffect(() => {
    void client.markRead(contact.tag as string);
  }, [client, contact.tag, messages.length]);

  useEffect(() => {
    if (atBottom.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, contact.typing]);

  useEffect(() => {
    setDraft('');
    atBottom.current = true;
    setTimeout(() => bottomRef.current?.scrollIntoView({ block: 'end' }), 30);
  }, [contact.tag]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setSending(true);
    try {
      await client.sendText(contact.tag, text);
    } catch (err) {
      onToast((err as Error).message, 'error');
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const pickFile = () => fileInput.current?.click();

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      onToast(t('chat.fileTooBig'), 'error');
      return;
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    try {
      await client.sendFile(contact.tag, { name: file.name || 'file', mime: file.type || 'application/octet-stream', bytes: buffer });
    } catch (err) {
      onToast((err as Error).message, 'error');
    }
  };

  let lastDay = '';

  return (
    <section className="chat-view">
      <header className="chat-head">
        <button type="button" className="icon-btn only-mobile" onClick={onBack} aria-label={t('app.back')}>
          <Icon name="back" />
        </button>
        <button type="button" className="chat-head-id" onClick={onOpenInfo}>
          <Avatar seed={contact.edPub} name={contact.name} size={40} />
          <span className="chat-head-text">
            <span className="chat-head-name">
              {contact.name}
              {contact.verified && <Icon name="shield" size={14} className="verified" />}
            </span>
            <span className="muted tiny">
              {contact.typing ? (
                <span className="typing-text">{t('chat.typing')}</span>
              ) : contact.hasSession ? (
                <span className="mono">#{contact.shortId} · E2EE</span>
              ) : (
                <span className="mono">#{contact.shortId} · {t('info.sessionNone')}</span>
              )}
            </span>
          </span>
        </button>

        <div className="chat-head-actions">
          <div className="ttl-wrap">
            <button
              type="button"
              className={`btn ghost small ${contact.ttl ? 'is-on' : ''}`}
              onClick={() => setTtlOpen((v) => !v)}
              title={t('chat.disappearing')}
            >
              <Icon name="clock" size={15} />
              <span className="only-desktop">{ttlLabel(contact.ttl, t)}</span>
            </button>
            {ttlOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setTtlOpen(false)} />
                <div className="menu">
                  <div className="menu-title small muted">{t('chat.disappearing')}</div>
                  {TTL_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option}
                      className={contact.ttl === option || (!contact.ttl && option === 0) ? 'is-active' : ''}
                      onClick={() => {
                        void client.setTtl(contact.tag, option);
                        setTtlOpen(false);
                      }}
                    >
                      {ttlLabel(option, t)}
                      {(contact.ttl === option || (!contact.ttl && option === 0)) && <Icon name="check" size={14} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button type="button" className="icon-btn" onClick={onOpenInfo} title={t('info.title')}>
            <Icon name="info" />
          </button>
        </div>
      </header>

      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <Identicon seed={contact.edPub} size={72} className="empty-identicon" />
            <h3>{t('chat.emptyTitle')}</h3>
            <p className="muted small">{t('chat.emptyBody')}</p>
            <div className="safety-card">
              <span className="tiny muted">{t('info.safety')}</span>
              <span className="mono safety-number">{contact.safetyNumber}</span>
              <CopyButton value={contact.safetyNumber} label={t('app.copy')} />
            </div>
          </div>
        )}

        {messages.map((message) => {
          const day = dayLabel(message.ts, lang, t);
          const showDay = day !== lastDay;
          lastDay = day;
          if (message.system) {
            return (
              <div key={message.id} className="system-line">
                {message.text}
              </div>
            );
          }
          const outgoing = message.dir === 'out';
          return (
            <div key={message.id}>
              {showDay && <div className="day-sep">{day}</div>}
              <div className={`message-row ${outgoing ? 'is-out' : 'is-in'}`}>
                <div className={`bubble ${message.file ? 'has-file' : ''}`}>
                  {message.file ? (
                    <FilePreview
                      mime={message.file.mime}
                      data={message.file.data}
                      name={message.file.name}
                      size={message.file.size}
                    />
                  ) : (
                    <span className="bubble-text">{message.text}</span>
                  )}
                  <span className="bubble-meta">
                    {message.expiresAt && <Icon name="clock" size={11} className="meta-icon" />}
                    {message.transport && <span className="via mono">{message.transport.replace(/^https?:\/\//, '').slice(0, 18)}</span>}
                    <span className="mono tiny">{clock(message.ts)}</span>
                    {outgoing && <StateTicks state={message.state} />}
                  </span>
                  <span className="bubble-actions">
                    {message.text && <CopyButton value={message.text} label="" />}
                    <button
                      type="button"
                      className="icon-btn tiny-btn"
                      title={t('app.delete')}
                      onClick={() => void client.deleteMessage(contact.tag, message.id)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                  {message.state === 'queued' && <span className="bubble-note">{t('chat.queued')}</span>}
                  {message.state === 'failed' && <span className="bubble-note is-error">{message.error}</span>}
                </div>
              </div>
            </div>
          );
        })}
        {contact.typing && (
          <div className="message-row is-in">
            <div className="bubble typing-bubble">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={bottomRef} className="scroll-anchor" />
      </div>

      <footer className="composer">
        <input ref={fileInput} type="file" hidden onChange={onFile} />
        <button type="button" className="icon-btn" onClick={pickFile} title={t('chat.attach')}>
          <Icon name="attach" />
        </button>
        <textarea
          value={draft}
          rows={1}
          placeholder={t('chat.placeholder')}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value) void client.sendTyping(contact.tag, true);
            const el = e.target as HTMLTextAreaElement;
            el.style.height = 'auto';
            el.style.height = `${Math.min(160, el.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="send-btn" onClick={send} disabled={!draft.trim() || sending} title={t('chat.send')}>
          <Icon name="send" size={19} />
        </button>
      </footer>
      <span className="sr-only">{bytes(draft.length)}</span>
    </section>
  );
}
