// @vitest-environment jsdom
/**
 * Boots the real application in a DOM: IndexedDB via fake-indexeddb, the real
 * engine, the real screens. Catches the class of bugs component tests miss —
 * hook order, storage, first-run flow, settings wiring.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../packages/app/src/App';

const realFetch = globalThis.fetch;

beforeAll(() => {
  localStorage.setItem('meshchat/lang', 'ru');
  Element.prototype.scrollIntoView = () => undefined;
  if (typeof window !== 'undefined') {
    // jsdom has no fetch/WebSocket; Node 22 has both.
    vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) => realFetch(...args));
  }
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('application boot', () => {
  it('creates an identity and lands in the messenger', async () => {
    render(<App />);

    const nameInput = await screen.findByPlaceholderText('например, alex', {}, { timeout: 15000 });
    fireEvent.change(nameInput, { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: /Создать ключ/i }));

    // first run opens the invite panel automatically
    await screen.findByText('Мой код', {}, { timeout: 20000 });
    expect(screen.getByText('Ссылка-приглашение')).toBeTruthy();

    // close the modal → shell is visible with our name
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    await waitFor(() => expect(screen.getAllByText('alice').length).toBeGreaterThan(0));

    // settings open and expose the privacy controls
    fireEvent.click(screen.getByTitle('Настройки'));
    await screen.findByText('Приватность', {}, { timeout: 10000 });
    expect(screen.getByText('Транспорты')).toBeTruthy();
    expect(screen.getByText('Личность')).toBeTruthy();
  }, 60000);
});
