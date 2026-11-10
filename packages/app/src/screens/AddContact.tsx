import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { MeshChatClient, Snapshot } from '../../../core/src/engine';
import { Modal, CopyButton } from '../ui';
import { Icon } from '../icons';

export function AddContact({
  client,
  snap,
  open,
  onClose,
  onAdded,
  t,
}: {
  client: MeshChatClient;
  snap: Snapshot;
  open: boolean;
  onClose: () => void;
  onAdded: (name: string) => void;
  t: (key: string) => string;
}) {
  const [tab, setTab] = useState<'mine' | 'add'>('mine');
  const [qr, setQr] = useState('');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const link = client.inviteLink(window.location.origin);
  const deepLink = client.inviteUrl();

  useEffect(() => {
    if (!open) return;
    setError('');
    QRCode.toDataURL(deepLink, {
      margin: 1,
      width: 320,
      color: { dark: '#0b0f12', light: '#d6fff2' },
      errorCorrectionLevel: 'M',
    })
      .then(setQr)
      .catch(() => setQr(''));
  }, [open, deepLink]);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const contact = await client.addContact(input.trim());
      onAdded(contact.name);
      setInput('');
      onClose();
    } catch (err) {
      const message = (err as Error).message;
      setError(message === 'this is your own invite' ? t('add.self') : message === 'invalid invite link' ? t('add.badInvite') : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('add.title')} subtitle={t('app.tagline')}>
      <div className="tabs">
        <button type="button" className={tab === 'mine' ? 'is-active' : ''} onClick={() => setTab('mine')}>
          {t('add.tabMine')}
        </button>
        <button type="button" className={tab === 'add' ? 'is-active' : ''} onClick={() => setTab('add')}>
          {t('add.tabAdd')}
        </button>
      </div>

      {tab === 'mine' ? (
        <div className="invite-panel">
          <div className="qr-box">
            {qr ? <img src={qr} alt="QR" width={208} height={208} /> : <div className="qr-placeholder" />}
            <span className="tiny muted">{t('add.qrHint')}</span>
          </div>
          <div className="invite-meta">
            <h3>{t('add.myLink')}</h3>
            <p className="muted small">{t('add.myLinkHint')}</p>
            <div className="code-block mono small">{link}</div>
            <div className="row-actions">
              <CopyButton value={link} label={t('app.copy')} />
              <CopyButton value={deepLink} label="meshchat://" />
            </div>
            <div className="kv small">
              <span className="muted">{t('info.shortId')}</span>
              <span className="mono">#{snap.identity.shortId}</span>
            </div>
            <div className="kv small">
              <span className="muted">{t('info.safety')}</span>
              <span className="mono tiny">{snap.identity.safetyNumber}</span>
            </div>
            <div className="kv small">
              <span className="muted">{t('info.relays')}</span>
              <span className="mono tiny wrap">{snap.relays.join(' · ') || '—'}</span>
            </div>
            <p className="muted tiny">{t('add.uniqueHint')}</p>
          </div>
        </div>
      ) : (
        <div className="add-panel">
          <label className="field">
            <span className="field-label">{t('add.paste')}</span>
            <textarea
              className="input mono textarea"
              rows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('add.pastePlaceholder')}
              spellCheck={false}
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="button" className="btn primary block" disabled={!input.trim() || busy} onClick={add}>
            <Icon name="user" size={17} />
            {busy ? t('app.loading') : t('add.action')}
          </button>
        </div>
      )}
    </Modal>
  );
}
