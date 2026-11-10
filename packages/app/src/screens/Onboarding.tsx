import { useState } from 'react';
import { Icon } from '../icons';
import { Field } from '../ui';
import type { Lang } from '../i18n';

export function Onboarding({
  t,
  lang,
  setLang,
  defaultRelay,
  onCreate,
  onRestore,
}: {
  t: (key: string) => string;
  lang: Lang;
  setLang: (lang: Lang) => void;
  defaultRelay: string;
  onCreate: (name: string, relays: string[]) => Promise<void>;
  onRestore: (backup: string, passphrase: string, relays: string[]) => Promise<void>;
}) {
  const [mode, setMode] = useState<'create' | 'restore'>('create');
  const [name, setName] = useState('');
  const [relay, setRelay] = useState(defaultRelay);
  const [backup, setBackup] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const relays = () => (relay.trim() ? [relay.trim()] : []);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (mode === 'create') await onCreate(name.trim() || 'anonymous', relays());
      else await onRestore(backup, passphrase, relays());
    } catch (err) {
      setError((err as Error).message || t('error.generic'));
      setBusy(false);
    }
  };

  return (
    <div className="onboarding">
      <div className="onboarding-glow" />
      <section className="onboarding-brand">
        <div className="brand-mark">
          <span className="brand-dot" />
          <span className="brand-dot d2" />
          <span className="brand-dot d3" />
          <span className="brand-line" />
        </div>
        <h1>
          mesh<span>chat</span>
        </h1>
        <p className="tagline">{t('app.tagline')}</p>

        <ul className="feature-list">
          {['onboard.f1', 'onboard.f2', 'onboard.f3', 'onboard.f4'].map((key) => (
            <li key={key}>
              <Icon name="check" size={15} />
              {t(key)}
            </li>
          ))}
        </ul>

        <div className="lang-switch">
          <button type="button" className={lang === 'ru' ? 'is-active' : ''} onClick={() => setLang('ru')}>
            RU
          </button>
          <button type="button" className={lang === 'en' ? 'is-active' : ''} onClick={() => setLang('en')}>
            EN
          </button>
        </div>
      </section>

      <section className="onboarding-card">
        <div className="onboard-tabs">
          <button type="button" className={mode === 'create' ? 'is-active' : ''} onClick={() => setMode('create')}>
            {t('onboard.title')}
          </button>
          <button type="button" className={mode === 'restore' ? 'is-active' : ''} onClick={() => setMode('restore')}>
            {t('onboard.restore')}
          </button>
        </div>

        {mode === 'create' ? (
          <>
            <p className="muted">{t('onboard.subtitle')}</p>
            <Field label={t('onboard.name')} value={name} onChange={setName} placeholder={t('onboard.namePlaceholder')} />
            <Field
              label={t('onboard.relay')}
              value={relay}
              onChange={setRelay}
              mono
              hint={t('onboard.relayHint')}
              placeholder="https://relay.example"
            />
            <button type="button" className="btn primary block" disabled={busy} onClick={submit}>
              <Icon name="key" size={18} />
              {busy ? t('app.loading') : t('onboard.create')}
            </button>
          </>
        ) : (
          <>
            <Field label={t('onboard.backup')} value={backup} onChange={setBackup} mono placeholder="meshchat-id-v1.…" />
            <Field
              label={t('onboard.passphrase')}
              value={passphrase}
              onChange={setPassphrase}
              type="password"
              hint={t('settings.backupHint')}
            />
            <Field label={t('onboard.relay')} value={relay} onChange={setRelay} mono hint={t('onboard.relayHint')} />
            <button type="button" className="btn primary block" disabled={busy || !backup || !passphrase} onClick={submit}>
              <Icon name="download" size={18} />
              {busy ? t('app.loading') : t('onboard.restoreAction')}
            </button>
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <p className="legal muted small">
          no accounts · no phone · no analytics — {new Date().getFullYear()}
        </p>
      </section>
    </div>
  );
}
