import { useState } from 'react';
import type { ContactView, MeshChatClient, Snapshot } from '../../../core/src/engine';
import { Avatar, CopyButton } from '../ui';
import { Icon } from '../icons';
import { ttlLabel, TTL_OPTIONS } from '../format';

export function ContactInfo({
  client,
  snap,
  contact,
  onClose,
  onDeleted,
  onToast,
  t,
}: {
  client: MeshChatClient;
  snap: Snapshot;
  contact: ContactView;
  onClose: () => void;
  onDeleted: () => void;
  onToast: (text: string, kind?: 'info' | 'error' | 'success') => void;
  t: (key: string) => string;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(contact.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <aside className="info-panel">
      <header className="info-head">
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('app.close')}>
          <Icon name="close" />
        </button>
        <span className="small muted">{t('info.title')}</span>
      </header>

      <div className="info-hero">
        <Avatar seed={contact.edPub} name={contact.name} size={78} />
        {renaming ? (
          <input
            className="input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void client.renameContact(contact.tag, name).then(() => {
                  setRenaming(false);
                  onToast(t('toast.renamed'), 'success');
                });
              }
            }}
          />
        ) : (
          <h3 onDoubleClick={() => setRenaming(true)}>{contact.name}</h3>
        )}
        <span className="mono tiny muted">#{contact.shortId}</span>
        <div className="tag-row">
          {contact.verified ? (
            <span className="pill ok tiny">
              <Icon name="shield" size={12} /> {t('info.verified')}
            </span>
          ) : (
            <span className="pill tiny">{t('info.notVerified')}</span>
          )}
          {contact.ttl ? (
            <span className="pill tiny">
              <Icon name="clock" size={12} /> {ttlLabel(contact.ttl, t)}
            </span>
          ) : null}
          {contact.blocked && <span className="pill danger tiny">{t('info.block')}</span>}
        </div>
      </div>

      <div className="info-body">
        <section className="info-block">
          <h4>{t('info.safety')}</h4>
          <p className="muted tiny">{t('info.safetyHint')}</p>
          <div className="safety-card compact">
            <span className="mono safety-number small">{contact.safetyNumber}</span>
            <CopyButton value={contact.safetyNumber} label="" />
          </div>
          <button
            type="button"
            className={`btn block small ${contact.verified ? 'ghost' : 'primary'}`}
            onClick={() => void client.setVerified(contact.tag, !contact.verified)}
          >
            <Icon name="shield" size={15} />
            {contact.verified ? t('info.unmarkVerified') : t('info.markVerified')}
          </button>
        </section>

        <section className="info-block">
          <h4>{t('info.session')}</h4>
          <p className="small">
            {contact.hasSession ? (
              <span className="ok-text">{t('info.sessionActive')}</span>
            ) : (
              <span className="muted">{t('info.sessionNone')}</span>
            )}
          </p>
          <div className="kv small">
            <span className="muted">{t('settings.publicKey')}</span>
            <span className="mono tiny wrap ellipsis">{contact.edPub}</span>
          </div>
          <div className="row-actions">
            <CopyButton value={contact.edPub} label={t('info.copyId')} />
            {!contact.hasSession && (
              <button type="button" className="btn ghost small" onClick={() => void client.resetSession(contact.tag)}>
                <Icon name="key" size={14} /> bootstrap
              </button>
            )}
          </div>
        </section>

        <section className="info-block">
          <h4>{t('info.relays')}</h4>
          <ul className="plain-list mono tiny">
            {contact.relays.length ? contact.relays.map((r) => <li key={r}>{r}</li>) : <li className="muted">—</li>}
          </ul>
        </section>

        <section className="info-block">
          <h4>{t('chat.disappearing')}</h4>
          <div className="chip-row">
            {TTL_OPTIONS.map((option) => (
              <button
                type="button"
                key={option}
                className={`chip ${(contact.ttl ?? 0) === option ? 'is-active' : ''}`}
                onClick={() => void client.setTtl(contact.tag, option)}
              >
                {ttlLabel(option, t)}
              </button>
            ))}
          </div>
        </section>

        <section className="info-block danger-zone">
          <button
            type="button"
            className="btn ghost block small"
            onClick={() => void client.setBlocked(contact.tag, !contact.blocked)}
          >
            <Icon name="lock" size={15} />
            {contact.blocked ? t('info.unblock') : t('info.block')}
          </button>
          <button
            type="button"
            className="btn ghost block small"
            onClick={() => {
              void client.clearChat(contact.tag);
              onToast(t('toast.saved'), 'success');
            }}
          >
            <Icon name="trash" size={15} />
            {t('info.clear')}
          </button>
          {/* stats: messages in this chat */}
          <p className="muted tiny">
            {snap.messages.filter((m) => m.chat === contact.tag).length} msg · {snap.messages.filter((m) => m.chat === contact.tag && m.dir === 'in').length} in /{' '}
            {snap.messages.filter((m) => m.chat === contact.tag && m.dir === 'out').length} out
          </p>
          {confirmDelete ? (
            <div className="row-actions">
              <button
                type="button"
                className="btn danger small"
                onClick={() => {
                  void client.deleteContact(contact.tag);
                  onDeleted();
                }}
              >
                {t('app.confirm')}
              </button>
              <button type="button" className="btn ghost small" onClick={() => setConfirmDelete(false)}>
                {t('app.cancel')}
              </button>
            </div>
          ) : (
            <button type="button" className="btn ghost block small danger-text" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={15} />
              {t('info.remove')}
            </button>
          )}
        </section>
      </div>
    </aside>
  );
}
