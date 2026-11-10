import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { initCrypto } from '../../core/src/sodium';
import { MeshChatClient, restoreClient, type Snapshot } from '../../core/src/engine';
import { openStorage } from './idb';
import { detectLang, rememberLang, translate, type Lang } from './i18n';
import { Sidebar } from './screens/Sidebar';
import { ChatView } from './screens/ChatView';
import { ContactInfo } from './screens/ContactInfo';
import { AddContact } from './screens/AddContact';
import { Settings } from './screens/Settings';
import { Onboarding } from './screens/Onboarding';
import { Icon } from './icons';
import { Identicon } from './ui';

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export default function App() {
  const [lang, setLangState] = useState<Lang>(detectLang());
  const t = useCallback((key: string) => translate(lang, key), [lang]);
  const [client, setClient] = useState<MeshChatClient | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [booting, setBooting] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [otherTab, setOtherTab] = useState(false);
  const toastId = useRef(1);
  const tabId = useRef(`tab-${Math.random().toString(36).slice(2)}-${Date.now()}`);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    rememberLang(next);
  }, []);

  const toast = useCallback((text: string, kind: 'info' | 'error' | 'success' = 'info') => {
    const id = toastId.current++;
    setToasts((list) => [...list.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 4200);
  }, []);

  const defaultRelay = useMemo(() => {
    if (typeof window === 'undefined') return 'http://localhost:8787';
    const origin = window.location.origin;
    if (origin.startsWith('http')) return origin;
    return 'http://localhost:8787';
  }, []);

  const handleDeepLink = useCallback(
    async (instance: MeshChatClient) => {
      const hash = window.location.hash;
      const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : window.location.search.slice(1);
      if (hash.includes('new')) setShowAdd(true);
      if (!query.includes('k=')) return;
      try {
        const contact = await instance.addContact(`meshchat://add?${query}`);
        setSelected(contact.tag);
        toast(`${translate(lang, 'toast.contactAdded')}: ${contact.name}`, 'success');
      } catch (err) {
        toast((err as Error).message, 'error');
      } finally {
        history.replaceState(null, '', window.location.pathname);
      }
    },
    [lang, toast],
  );

  const attach = useCallback(async (instance: MeshChatClient) => {
    await instance.start();
    setClient(instance);
    setSnap(instance.snapshot());
    const unsubscribe = instance.subscribe((event) => {
      if (event.type === 'toast') toast(event.text, event.kind);
      setSnap(instance.snapshot());
    });
    await handleDeepLink(instance);
    // First run: show the invite panel right away so there is an obvious next step.
    if (!localStorage.getItem('meshchat/seen-invite') && instance.snapshot().contacts.length === 0) {
      localStorage.setItem('meshchat/seen-invite', '1');
      setShowAdd(true);
    }
    return unsubscribe;
  }, [handleDeepLink, toast]);

  // boot
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      await initCrypto();
      const storage = await openStorage();
      const existing = await MeshChatClient.load(storage, { relays: [defaultRelay] });
      if (existing) {
        cleanup = await attach(existing);
        const saved = localStorage.getItem('meshchat/selected');
        if (saved) setSelected(saved);
      }
      setBooting(false);
    })().catch((err) => {
      console.error(err);
      toast((err as Error).message, 'error');
      setBooting(false);
    });
    return () => cleanup?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async (name: string, relays: string[]) => {
    const storage = await openStorage();
    const instance = await MeshChatClient.create(storage, name, { relays: relays.length ? relays : [defaultRelay] });
    await attach(instance);
  };

  const onRestore = async (backup: string, passphrase: string, relays: string[]) => {
    const storage = await openStorage();
    const instance = await restoreClient(storage, backup, passphrase, {
      relays: relays.length ? relays : [defaultRelay],
    });
    await attach(instance);
  };

  // One active tab per browser profile: two tabs share one ratchet state.
  useEffect(() => {
    const key = 'meshchat/tab-lock';
    const beat = () => {
      const now = Date.now();
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const lock = JSON.parse(raw) as { id: string; ts: number };
          if (lock.id !== tabId.current && now - lock.ts < 9000) {
            setOtherTab(true);
            return;
          }
        } catch {
          /* ignore corrupt lock */
        }
      }
      setOtherTab(false);
      localStorage.setItem(key, JSON.stringify({ id: tabId.current, ts: now }));
    };
    beat();
    const timer = setInterval(beat, 4000);
    const release = () => {
      try {
        const raw = localStorage.getItem(key);
        if (raw && (JSON.parse(raw) as { id: string }).id === tabId.current) localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pagehide', release);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', release);
      release();
    };
  }, []);

  const select = (tag: string) => {
    setSelected(tag);
    localStorage.setItem('meshchat/selected', tag);
    setShowInfo(false);
    if (client) void client.markRead(tag);
  };

  const wipe = async () => {
    if (!client) return;
    await client.wipe();
    localStorage.removeItem('meshchat/selected');
    location.reload();
  };

  const contact = useMemo(
    () => (selected && snap ? snap.contacts.find((c) => c.tag === selected) ?? null : null),
    [selected, snap],
  );

  if (booting) {
    return (
      <div className="splash">
        <Identicon seed="meshchat-boot" size={64} />
        <p className="mono small muted">{t('app.loading')}</p>
      </div>
    );
  }

  if (!client || !snap) {
    return (
      <Onboarding
        t={t}
        lang={lang}
        setLang={setLang}
        defaultRelay={defaultRelay}
        onCreate={onCreate}
        onRestore={onRestore}
      />
    );
  }

  if (otherTab) {
    return (
      <div className="splash tab-lock">
        <Identicon seed="meshchat-lock" size={64} />
        <h2>{t('tabLock.title')}</h2>
        <p className="muted small">{t('tabLock.body')}</p>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            localStorage.setItem('meshchat/tab-lock', JSON.stringify({ id: tabId.current, ts: Date.now() }));
            setOtherTab(false);
          }}
        >
          {t('tabLock.take')}
        </button>
      </div>
    );
  }

  return (
    <div className={`app ${contact ? 'has-chat' : ''} ${showInfo && contact ? 'has-info' : ''}`}>
      <Sidebar
        snap={snap}
        selected={selected}
        onSelect={select}
        onNewContact={() => setShowAdd(true)}
        onSettings={() => setShowSettings(true)}
        onProfile={() => setShowSettings(true)}
        t={t}
      />

      {contact ? (
        <ChatView
          client={client}
          snap={snap}
          contact={contact}
          onBack={() => {
            setSelected(null);
            setShowInfo(false);
          }}
          onOpenInfo={() => setShowInfo((v) => !v)}
          onToast={toast}
          t={t}
          lang={lang}
        />
      ) : (
        <section className="chat-placeholder">
          <Identicon seed={snap.identity.edPub} size={96} className="float" />
          <h2>{t('chat.select')}</h2>
          <p className="muted">{t('chat.selectHint')}</p>
          <button type="button" className="btn primary" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={17} /> {t('nav.new')}
          </button>
          <div className="placeholder-badges">
            {snap.transports.map((transport) => (
              <span key={transport.id} className={`pill tiny ${transport.state === 'online' ? 'ok' : ''}`}>
                <span className={`dot ${transport.state === 'online' ? 'is-on' : ''}`} />
                {transport.kind}
                {transport.kind !== 'local' ? ` · ${transport.label}` : ''}
              </span>
            ))}
          </div>
        </section>
      )}

      {showInfo && contact && (
        <ContactInfo
          client={client}
          snap={snap}
          contact={contact}
          onClose={() => setShowInfo(false)}
          onDeleted={() => {
            setSelected(null);
            setShowInfo(false);
          }}
          onToast={toast}
          t={t}
        />
      )}

      <AddContact
        client={client}
        snap={snap}
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={(name) => {
          const created = snap.contacts.find((c) => c.name === name);
          if (created) setSelected(created.tag);
          toast(t('toast.contactAdded'), 'success');
        }}
        t={t}
      />

      <Settings
        client={client}
        snap={snap}
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onToast={toast}
        onWipe={wipe}
        lang={lang}
        setLang={setLang}
        t={t}
      />

      <div className="toasts">
        {toasts.map((item) => (
          <div key={item.id} className={`toast is-${item.kind}`}>
            <Icon name={item.kind === 'error' ? 'info' : item.kind === 'success' ? 'check' : 'bolt'} size={15} />
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
