import { useMemo, useState } from 'react';
import type { Snapshot } from '../../../core/src/engine';
import { Icon } from '../icons';
import { Avatar } from '../ui';
import { shortClock } from '../format';

export function Sidebar({
  snap,
  selected,
  onSelect,
  onNewContact,
  onSettings,
  onProfile,
  t,
}: {
  snap: Snapshot;
  selected: string | null;
  onSelect: (tag: string) => void;
  onNewContact: () => void;
  onSettings: () => void;
  onProfile: () => void;
  t: (key: string) => string;
}) {
  const [query, setQuery] = useState('');
  const onlineTransports = snap.transports.filter((x) => x.state === 'online');
  const online = onlineTransports.length > 0;

  const contacts = useMemo(() => {
    const list = [...snap.contacts].sort((a, b) => b.lastActivity - a.lastActivity);
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(q) || c.shortId.includes(q));
  }, [snap.contacts, query]);

  const lastMessage = (tag: string) => {
    for (let i = snap.messages.length - 1; i >= 0; i--) {
      const message = snap.messages[i];
      if (message.chat === tag) return message;
    }
    return null;
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-top">
        <button type="button" className="me" onClick={onProfile} title={snap.identity.edPub}>
          <Avatar seed={snap.identity.edPub} name={snap.identity.name} size={42} online={online} />
          <span className="me-text">
            <strong>{snap.identity.name}</strong>
            <span className="mono tiny muted">#{snap.identity.shortId}</span>
          </span>
        </button>
        <div className="sidebar-actions">
          <button type="button" className="icon-btn accent" onClick={onNewContact} title={t('nav.new')}>
            <Icon name="plus" />
          </button>
          <button type="button" className="icon-btn" onClick={onSettings} title={t('nav.settings')}>
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <div className="search">
        <Icon name="search" size={16} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('nav.search')}
          aria-label={t('nav.search')}
        />
      </div>

      <div className="transport-strip">
        <span className={`dot ${online ? 'is-on' : ''}`} />
        <span className="tiny mono">
          {online ? t('app.online') : t('app.connecting')}
          {snap.status.relayCount > 0 && ` · ${onlineTransports.length}/${snap.transports.length}`}
        </span>
        {snap.status.outbox > 0 && <span className="pill warn tiny">{snap.status.outbox} ↑</span>}
        <span className="grow" />
        <button type="button" className="icon-btn tiny-btn" onClick={onSettings} title={t('settings.transports')}>
          <Icon name="wifi" size={14} />
        </button>
      </div>

      <div className="chat-list">
        {contacts.length === 0 && <p className="empty-hint muted small">{t('nav.empty')}</p>}
        {contacts.map((contact) => {
          const last = lastMessage(contact.tag);
          const preview = last
            ? last.file
              ? `📎 ${last.file.name}`
              : last.text ?? ''
            : contact.about || contact.shortId;
          return (
            <button
              type="button"
              key={contact.tag}
              className={`chat-item ${selected === contact.tag ? 'is-active' : ''} ${contact.blocked ? 'is-blocked' : ''}`}
              onClick={() => onSelect(contact.tag)}
            >
              <Avatar seed={contact.edPub} name={contact.name} size={46} />
              <span className="chat-item-main">
                <span className="chat-item-top">
                  <span className="chat-item-name">
                    {contact.name}
                    {contact.verified && <Icon name="shield" size={13} className="verified" />}
                  </span>
                  {last && <span className="tiny muted mono">{shortClock(last.ts)}</span>}
                </span>
                <span className="chat-item-bottom">
                  <span className={`preview ${contact.typing ? 'is-typing' : ''}`}>
                    {contact.typing ? t('chat.typing') : preview}
                  </span>
                  {contact.unread > 0 && <span className="badge">{contact.unread > 99 ? '99+' : contact.unread}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <footer className="sidebar-foot mono tiny">
        <span>Ed25519 · X3DH · DR</span>
        <span className="grow" />
        <span className="muted">v0.1.0</span>
      </footer>
    </aside>
  );
}
