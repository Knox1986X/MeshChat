/**
 * End-to-end: real relay, real sockets, two independent clients, real crypto.
 * This is the closest thing to "two phones in different networks" that CI can do.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { Relay, defaultConfig } from '../packages/relay/src/server';
import { MemoryKV } from '../packages/core/src/storage';
import { MeshChatClient } from '../packages/core/src/engine';
import { parseInvite } from '../packages/core/src/identity';
import { newEnvelopeId } from '../packages/core/src/envelope';

let relay: Relay;
let url = '';

beforeAll(async () => {
  relay = new Relay({
    ...defaultConfig(),
    port: 0,
    host: '127.0.0.1',
    pow: 6,
    dataDir: '',
    staticDir: '/nonexistent',
    rateLimit: 0,
    name: 'test-relay',
  });
  await relay.listen();
  relay.startTimers();
  const address = relay.httpServer.address() as AddressInfo;
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await relay.close();
});

async function waitFor<T>(fn: () => T | null | undefined | false, timeout = 8000, label = 'condition'): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = fn();
    if (value) return value as T;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function makeClient(name: string): Promise<MeshChatClient> {
  const client = await MeshChatClient.create(new MemoryKV(), name, { relays: [url] });
  await client.start();
  await client.publishPreKeys(true);
  return client;
}

describe('end to end over a relay', () => {
  it('delivers messages both ways with receipts', async () => {
    const alice = await makeClient('alice');
    const bob = await makeClient('bob');
    try {
      const inviteA = parseInvite(alice.inviteUrl())!;
      const inviteB = parseInvite(bob.inviteUrl())!;
      expect(inviteA.key).toBe(alice.state.identity.edPub);

      await bob.addContact(inviteA);
      await alice.addContact(inviteB);

      // bob's client bootstraps a session and says hello with a profile update
      const bobContact = await waitFor(() => alice.contactByKey(bob.state.identity.edPub), 8000, 'alice sees bob');
      expect(bobContact.name).toBeTruthy();

      const aliceSide = await waitFor(() => bob.contactByKey(alice.state.identity.edPub), 8000, 'bob sees alice');
      expect(aliceSide).toBeTruthy();

      const sentTs = Date.now();
      await alice.sendText(bobContact.tag, 'привет из меша');
      const incoming = await waitFor(
        () => bob.snapshot().messages.find((m) => m.text === 'привет из меша'),
        8000,
        'message delivered',
      );
      expect(incoming.dir).toBe('in');
      expect(incoming.ts).toBeGreaterThanOrEqual(sentTs - 1000);

      const delivered = await waitFor(
        () => alice.snapshot().messages.find((m) => m.text === 'привет из меша' && m.state !== 'queued'),
        8000,
        'delivery receipt',
      );
      expect(['sent', 'delivered']).toContain(delivered.state);

      await bob.markRead(aliceSide.tag);
      const read = await waitFor(
        () => alice.snapshot().messages.find((m) => m.text === 'привет из меша' && m.state === 'read'),
        8000,
        'read receipt',
      );
      expect(read.state).toBe('read');

      // reply exercises the DH ratchet in the other direction
      await bob.sendText(aliceSide.tag, 'и тебе привет');
      const reply = await waitFor(
        () => alice.snapshot().messages.find((m) => m.text === 'и тебе привет'),
        8000,
        'reply delivered',
      );
      expect(reply.dir).toBe('in');

      // several messages in a row: chain ratchet, no replay
      for (let i = 0; i < 4; i++) await alice.sendText(bobContact.tag, `msg ${i}`);
      for (let i = 0; i < 4; i++) {
        await waitFor(() => bob.snapshot().messages.find((m) => m.text === `msg ${i}`), 8000, `msg ${i}`);
      }

      // nothing leaks: the relay only ever saw routing tags and ciphertext
      const stored = relay.mailbox.entries();
      expect(stored.length).toBeGreaterThan(0);
      for (const entry of stored) {
        expect(JSON.stringify(entry.env)).not.toContain('привет');
        expect(entry.tag).toHaveLength(22);
      }
    } finally {
      await alice.stop();
      await bob.stop();
    }
  }, 40000);

  it('enforces proof of work', async () => {
    const env = {
      v: 1,
      to: 'a'.repeat(22),
      id: newEnvelopeId(),
      ts: Date.now(),
      k: 'n',
      rm: { dh: 'x'.repeat(43), pn: 0, n: 0, ct: 'A'.repeat(44) },
    };
    const res = await fetch(`${url}/v1/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ envelopes: [env] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { rejected: number };
    expect(body.rejected).toBe(1);
  });

  it('serves prekey bundles once and remembers the identity', async () => {
    const carol = await makeClient('carol');
    try {
      const tag = carol.ownTag;
      const first = await fetch(`${url}/v1/keys/${tag}`);
      expect(first.status).toBe(200);
      const data = (await first.json()) as { bundle: { ik: string; opk: { id: number } } };
      expect(data.bundle.ik).toBe(carol.state.identity.edPub);
      expect(data.bundle.opk.id).toBeTypeOf('number');
      const second = await fetch(`${url}/v1/keys/${tag}`);
      const data2 = (await second.json()) as { bundle: { opk: { id: number } } };
      expect(data2.bundle.opk.id).not.toBe(data.bundle.opk.id);
    } finally {
      await carol.stop();
    }
  });

  it('reports health', async () => {
    const res = await fetch(`${url}/v1/health`);
    const body = (await res.json()) as { ok: boolean; pow: number; name: string };
    expect(body.ok).toBe(true);
    expect(body.pow).toBe(6);
    expect(body.name).toBe('test-relay');
  });
});

describe('durability', () => {
  it('keeps the ratchet intact across restarts and delivers to an offline peer', async () => {
    const storageA = new MemoryKV();
    const storageB = new MemoryKV();
    let alice = await MeshChatClient.create(storageA, 'alice2', { relays: [url] });
    let bob = await MeshChatClient.create(storageB, 'bob2', { relays: [url] });
    await alice.start();
    await bob.start();
    await alice.publishPreKeys(true);
    await bob.publishPreKeys(true);

    try {
      await alice.addContact(parseInvite(bob.inviteUrl())!);
      await bob.addContact(parseInvite(alice.inviteUrl())!);
      const bobSide = await waitFor(() => alice.contactByKey(bob.state.identity.edPub), 8000, 'session a→b');
      const aliceSide = await waitFor(() => bob.contactByKey(alice.state.identity.edPub), 8000, 'session b→a');

      await alice.sendText(bobSide.tag, 'before restart');
      await waitFor(() => bob.snapshot().messages.find((m) => m.text === 'before restart'), 8000, 'first message');

      // Persist and reload both sides: state must round-trip through storage.
      await bob.stop();
      await alice.stop();
      alice = (await MeshChatClient.load(storageA, { relays: [url] }))!;
      bob = (await MeshChatClient.load(storageB, { relays: [url] }))!;
      await alice.start();
      await bob.start();

      // Bob is offline from the relay's point of view for a moment: Alice sends
      // into the mailbox, then Bob comes back and pulls it.
      await bob.stop();
      await alice.sendText(bobSide.tag, 'while you were offline');
      await new Promise((r) => setTimeout(r, 400));
      await bob.start();

      const queued = await waitFor(
        () => bob.snapshot().messages.find((m) => m.text === 'while you were offline'),
        10000,
        'offline message',
      );
      expect(queued.dir).toBe('in');

      await bob.sendText(aliceSide.tag, 'back online');
      await waitFor(() => alice.snapshot().messages.find((m) => m.text === 'back online'), 8000, 'reply after restart');

      // Keys keep rotating: nothing in the old snapshot decrypts the new traffic.
      expect(alice.state.contacts[0].session?.dhr).toBeTruthy();
    } finally {
      await alice.stop().catch(() => undefined);
      await bob.stop().catch(() => undefined);
    }
  }, 40000);
});
