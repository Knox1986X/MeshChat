import { useState } from 'react';
import type { MeshChatClient, Snapshot } from '../../../core/src/engine';
import { Modal, CopyButton, Field, Toggle } from '../ui';
import { Icon } from '../icons';
import { TTL_OPTIONS, ttlLabel } from '../format';
import type { Lang } from '../i18n';

export function Settings({
  client,
  snap,
  open,
  onClose,
  onToast,
  onWipe,
  lang,
  setLang,
  t,
}: {
  client: MeshChatClient;
  snap: Snapshot;
  open: boolean;
  onClose: () => void;
  onToast: (text: string, kind?: 'info' | 'error' | 'success') => void;
  onWipe: () => void;
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}) {
  const [name, setName] = useState(snap.identity.name);
  const [about, setAbout] = useState(snap.identity.about ?? '');
  const [relayInput, setRelayInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [gitOwner, setGitOwner] = useState(snap.git?.owner ?? '');
  const [gitRepo, setGitRepo] = useState(snap.git?.repo ?? '');
  const [gitBranch, setGitBranch] = useState(snap.git?.branch ?? 'meshchat');
  const [gitToken, setGitToken] = useState('');
  const [gitBusy, setGitBusy] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [backup, setBackup] = useState('');
  const [confirmWipe, setConfirmWipe] = useState(false);

  const relayState = (url: string) => snap.transports.find((x) => x.kind === 'relay' && x.id === url);
  const gitTransport = snap.transports.find((x) => x.kind === 'git');
  const localTransport = snap.transports.find((x) => x.kind === 'local');

  const addRelay = async () => {
    if (!relayInput.trim()) return;
    try {
      await client.addRelay(relayInput.trim());
      setRelayInput('');
      onToast(t('toast.saved'), 'success');
    } catch (err) {
      onToast((err as Error).message, 'error');
    }
  };

  const checkRelays = async () => {
    setChecking(true);
    try {
      await client.probeRelays();
      onToast(t('toast.relayOk'), 'success');
    } finally {
      setChecking(false);
    }
  };

  const connectGit = async () => {
    setGitBusy(true);
    try {
      await client.setGitTransport({
        owner: gitOwner.trim(),
        repo: gitRepo.trim(),
        token: gitToken.trim(),
        branch: gitBranch.trim() || 'meshchat',
      });
      onToast(t('toast.gitOk'), 'success');
      setGitToken('');
    } catch (err) {
      onToast(`${t('toast.gitFail')}: ${(err as Error).message}`, 'error');
    } finally {
      setGitBusy(false);
    }
  };

  const makeBackup = () => {
    try {
      const result = client.exportBackup(passphrase);
      setBackup(result);
      onToast(t('toast.backupReady'), 'success');
    } catch (err) {
      onToast((err as Error).message, 'error');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('settings.title')} wide>
      <div className="settings">
        <section className="settings-section">
          <h3>
            <Icon name="user" size={16} /> {t('settings.profile')}
          </h3>
          <div className="settings-grid">
            <Field label={t('settings.name')} value={name} onChange={setName} />
            <Field label={t('settings.about')} value={about} onChange={setAbout} />
          </div>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              void client.setIdentityName(name);
              onToast(t('toast.saved'), 'success');
            }}
          >
            <Icon name="check" size={15} /> {t('app.save')}
          </button>
        </section>

        <section className="settings-section">
          <h3>
            <Icon name="wifi" size={16} /> {t('settings.transports')}
          </h3>
          <p className="muted small">{t('settings.relayHint')}</p>
          <ul className="relay-list">
            {snap.relays.map((url) => {
              const state = relayState(url);
              return (
                <li key={url}>
                  <span className={`dot ${state?.state === 'online' ? 'is-on' : state?.state === 'error' ? 'is-err' : ''}`} />
                  <span className="mono small ellipsis">{url}</span>
                  <span className="pill tiny">{state?.state ?? 'off'}</span>
                  <span className="grow" />
                  <button type="button" className="icon-btn tiny-btn" onClick={() => void client.removeRelay(url)} title={t('app.delete')}>
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              );
            })}
            {snap.relays.length === 0 && <li className="muted small">—</li>}
          </ul>
          <div className="inline-add">
            <input
              className="input mono"
              value={relayInput}
              onChange={(e) => setRelayInput(e.target.value)}
              placeholder={t('settings.relayPlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && void addRelay()}
            />
            <button type="button" className="btn small" onClick={addRelay}>
              <Icon name="plus" size={15} /> {t('settings.addRelay')}
            </button>
            <button type="button" className="btn ghost small" onClick={checkRelays} disabled={checking}>
              <Icon name="bolt" size={15} /> {t('settings.check')}
            </button>
          </div>
          <p className="muted tiny">
            {t('settings.transportLocal')}: <span className={localTransport?.state === 'online' ? 'ok-text' : 'muted'}>{localTransport?.state ?? 'off'}</span>
            {' — '}
            {t('settings.transportLocalHint')}
          </p>
        </section>

        <section className="settings-section">
          <h3>
            <Icon name="github" size={16} /> {t('settings.git')}
            {snap.git && <span className="pill ok tiny">{t('settings.gitConnected')}</span>}
          </h3>
          <p className="muted small">{t('settings.gitHint')}</p>
          <div className="settings-grid">
            <Field label={t('settings.gitOwner')} value={gitOwner} onChange={setGitOwner} mono placeholder="octocat" />
            <Field label={t('settings.gitRepo')} value={gitRepo} onChange={setGitRepo} mono placeholder="mesh-mailbox" />
            <Field label={t('settings.gitBranch')} value={gitBranch} onChange={setGitBranch} mono placeholder="meshchat" />
            <Field
              label={t('settings.gitToken')}
              value={gitToken}
              onChange={setGitToken}
              type="password"
              mono
              placeholder="github_pat_…"
            />
          </div>
          <div className="row-actions">
            <button type="button" className="btn small" onClick={connectGit} disabled={gitBusy || !gitOwner || !gitRepo || !gitToken}>
              <Icon name="link" size={15} /> {gitBusy ? t('app.loading') : t('settings.gitConnect')}
            </button>
            {snap.git && (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => {
                  void client.setGitTransport(null);
                  onToast(t('toast.saved'), 'success');
                }}
              >
                {t('settings.gitDisconnect')}
              </button>
            )}
            {gitTransport && (
              <span className={`pill tiny ${gitTransport.state === 'online' ? 'ok' : 'warn'}`}>
                {gitTransport.state} · ↑{gitTransport.sent} ↓{gitTransport.received}
              </span>
            )}
          </div>
        </section>

        <section className="settings-section">
          <h3>
            <Icon name="shield" size={16} /> {t('settings.privacy')}
          </h3>
          <div className="field">
            <span className="field-label">{t('settings.pow')}</span>
            <div className="chip-row">
              {[0, 12, 16, 20].map((bits) => (
                <button
                  type="button"
                  key={bits}
                  className={`chip ${snap.settings.powDifficulty === bits ? 'is-active' : ''}`}
                  onClick={() => void client.updateSettings({ powDifficulty: bits })}
                >
                  {bits === 0 ? t('settings.powAuto') : `${bits} bits`}
                </button>
              ))}
            </div>
            <span className="muted small">{t('settings.powHint')}</span>
          </div>
          <Toggle
            label={t('settings.typing')}
            checked={snap.settings.typingIndicators}
            onChange={(v) => void client.updateSettings({ typingIndicators: v })}
          />
          <Toggle
            label={t('settings.receipts')}
            checked={snap.settings.readReceipts}
            onChange={(v) => void client.updateSettings({ readReceipts: v })}
          />
          <div className="field">
            <span className="field-label">{t('settings.ttlDefault')}</span>
            <div className="chip-row">
              {TTL_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option}
                  className={`chip ${snap.settings.defaultTtl === option ? 'is-active' : ''}`}
                  onClick={() => void client.updateSettings({ defaultTtl: option })}
                >
                  {ttlLabel(option, t)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('settings.lang')}</span>
            <div className="chip-row">
              {(['ru', 'en'] as Lang[]).map((code) => (
                <button type="button" key={code} className={`chip ${lang === code ? 'is-active' : ''}`} onClick={() => setLang(code)}>
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h3>
            <Icon name="key" size={16} /> {t('settings.identity')}
          </h3>
          <div className="kv small">
            <span className="muted">{t('settings.publicKey')}</span>
            <span className="mono tiny wrap ellipsis">{snap.identity.edPub}</span>
          </div>
          <div className="kv small">
            <span className="muted">{t('info.safety')}</span>
            <span className="mono tiny">{snap.identity.safetyNumber}</span>
          </div>
          <div className="row-actions">
            <CopyButton value={snap.identity.edPub} label={t('info.copyId')} />
            <CopyButton value={client.inviteLink(window.location.origin)} label={t('add.myLink')} />
            <button type="button" className="btn small" onClick={() => setBackupOpen(true)}>
              <Icon name="download" size={15} /> {t('settings.backupAction')}
            </button>
          </div>
          <p className="muted tiny">{t('settings.backupHint')}</p>

          {confirmWipe ? (
            <div className="row-actions">
              <button type="button" className="btn danger small" onClick={onWipe}>
                {t('settings.wipe')}
              </button>
              <button type="button" className="btn ghost small" onClick={() => setConfirmWipe(false)}>
                {t('app.cancel')}
              </button>
            </div>
          ) : (
            <button type="button" className="btn ghost small danger-text" onClick={() => setConfirmWipe(true)}>
              <Icon name="trash" size={15} /> {t('settings.wipe')}
            </button>
          )}
          <p className="muted tiny">{t('settings.wipeHint')}</p>
        </section>

        <section className="settings-section about-app">
          <h3>{t('settings.aboutApp')}</h3>
          <p className="muted small">
            MeshChat v0.1.0 — {t('settings.version')} 0.1.0 · AGPL-3.0 · Ed25519 / X25519 / XChaCha20-Poly1305 / Argon2id /
            HKDF-SHA256 / BLAKE2b
          </p>
          <p className="muted tiny">
            {t('onboard.f2')} · {t('onboard.f3')}
          </p>
        </section>
      </div>

      <Modal open={backupOpen} onClose={() => setBackupOpen(false)} title={t('settings.backup')}>
        <p className="muted small">{t('settings.backupHint')}</p>
        <Field label={t('onboard.passphrase')} value={passphrase} onChange={setPassphrase} type="password" />
        <button type="button" className="btn primary block" disabled={passphrase.length < 6} onClick={makeBackup}>
          <Icon name="key" size={16} /> {t('settings.backupAction')}
        </button>
        {backup && (
          <>
            <textarea className="input mono textarea small" rows={4} readOnly value={backup} onFocus={(e) => e.target.select()} />
            <CopyButton value={backup} label={t('app.copy')} />
          </>
        )}
      </Modal>
    </Modal>
  );
}
