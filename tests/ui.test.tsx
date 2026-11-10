// @vitest-environment jsdom
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { initCrypto } from '../packages/core/src/sodium';
import { MeshChatClient, type ContactView, type Snapshot } from '../packages/core/src/engine';
import { MemoryKV } from '../packages/core/src/storage';
import { translate } from '../packages/app/src/i18n';
import { Onboarding } from '../packages/app/src/screens/Onboarding';
import { Sidebar } from '../packages/app/src/screens/Sidebar';
import { ChatView } from '../packages/app/src/screens/ChatView';

beforeAll(async () => {
  await initCrypto();
  Element.prototype.scrollIntoView = () => undefined;
});

const t = (key: string) => translate('ru', key);

describe('onboarding screen', () => {
  it('renders and creates an identity', async () => {
    const onCreate = vi.fn(async () => undefined);
    render(
      <Onboarding
        t={t}
        lang="ru"
        setLang={() => undefined}
        defaultRelay="http://localhost:8787"
        onCreate={onCreate}
        onRestore={async () => undefined}
      />,
    );
    expect(screen.getByText(/mesh/i)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('например, alex'), { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: /Создать ключ/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('alice', ['http://localhost:8787']));
  });
});

describe('chat ui', () => {
  it('renders contacts and messages, sends text', async () => {
    const client = await MeshChatClient.create(new MemoryKV(), 'alice', { relays: ['http://localhost:9'] });
    const snap: Snapshot = client.snapshot();
    const contact: ContactView = {
      tag: 'tag-1',
      edPub: 'pubkey',
      name: 'bob',
      relays: [],
      verified: true,
      blocked: false,
      unread: 0,
      lastActivity: Date.now(),
      safetyNumber: '12345 67890',
      shortId: 'abc123',
      hasSession: true,
      typing: false,
    };
    const snapWithContact: Snapshot = {
      ...snap,
      contacts: [contact],
      messages: [
        { id: 'm1', chat: 'tag-1', dir: 'in', ts: Date.now() - 1000, text: 'hi there', state: 'read' },
        { id: 'm2', chat: 'tag-1', dir: 'out', ts: Date.now(), text: 'hey', state: 'delivered' },
      ],
      transports: [
        { id: 'local', kind: 'local', label: 'this device', state: 'online', sent: 0, received: 0 },
      ],
    };

    render(
      <Sidebar
        snap={snapWithContact}
        selected="tag-1"
        onSelect={() => undefined}
        onNewContact={() => undefined}
        onSettings={() => undefined}
        onProfile={() => undefined}
        t={t}
      />,
    );
    expect(screen.getAllByText('bob').length).toBeGreaterThan(0);
    expect(screen.getByText('hey')).toBeTruthy();

    const sendText = vi.fn(async () => undefined);
    const fakeClient = {
      markRead: async () => undefined,
      sendText,
      sendFile: async () => undefined,
      sendTyping: async () => undefined,
      setTtl: async () => undefined,
      deleteMessage: async () => undefined,
    } as unknown as MeshChatClient;

    render(
      <ChatView
        client={fakeClient}
        snap={snapWithContact}
        contact={contact}
        onBack={() => undefined}
        onOpenInfo={() => undefined}
        onToast={() => undefined}
        t={t}
        lang="ru"
      />,
    );
    const input = screen.getByPlaceholderText(/Сообщение/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'привет' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(sendText).toHaveBeenCalledWith('tag-1', 'привет'));
    expect(screen.getByText('hi there')).toBeTruthy();
  });
});
