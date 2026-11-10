/**
 * Runs the *built* relay bundle in a separate process, exactly as deployed.
 *
 * This exists because an in-process test can hide bugs that only appear in a
 * fresh server (e.g. crypto never initialised, so every envelope is rejected
 * as malformed). One real child process, real HTTP, real WebSocket, real PoW.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshChatClient } from '../packages/core/src/engine';
import { MemoryKV } from '../packages/core/src/storage';
import { parseInvite } from '../packages/core/src/identity';

const PORT = 19000 + Math.floor(Math.random() * 700);
const BUNDLE = 'packages/relay/dist/relay.mjs';

let child: ChildProcess | null = null;
let dataDir = '';
let url = '';

async function waitFor(check: () => Promise<boolean> | boolean, timeout = 15000, label = 'condition'): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

beforeAll(async () => {
  if (!existsSync(BUNDLE)) {
    execFileSync('npm', ['run', 'build:relay'], { stdio: 'ignore' });
  }
  dataDir = mkdtempSync(join(tmpdir(), 'meshchat-relay-'));
  url = `http://127.0.0.1:${PORT}`;
  child = spawn(
    process.execPath,
    [BUNDLE, '--port', String(PORT), '--host', '127.0.0.1', '--pow', '8', '--data', dataDir],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (!text.includes('ExperimentalWarning')) console.error('[relay]', text.trim());
  });
  await waitFor(async () => {
    try {
      const res = await fetch(`${url}/v1/health`);
      return res.ok;
    } catch {
      return false;
    }
  }, 20000, 'relay health');
}, 40000);

afterAll(async () => {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => child!.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe('production relay bundle', () => {
  it('reports a healthy mailbox with its own PoW policy', async () => {
    const health = (await (await fetch(`${url}/v1/health`)).json()) as { ok: boolean; pow: number };
    expect(health.ok).toBe(true);
    expect(health.pow).toBe(8);
  });

  it('accepts envelopes and delivers a real conversation', async () => {
    const alice = await MeshChatClient.create(new MemoryKV(), 'alice', { relays: [url] });
    const bob = await MeshChatClient.create(new MemoryKV(), 'bob', { relays: [url] });
    await alice.start();
    await bob.start();
    await alice.publishPreKeys(true);
    await bob.publishPreKeys(true);

    try {
      await bob.addContact(parseInvite(alice.inviteUrl())!);
      await alice.addContact(parseInvite(bob.inviteUrl())!);

      let contactTag = '';
      await waitFor(() => {
        // Alice needs a session with Bob before she can send anything.
        const contact = alice.contactByKey(bob.state.identity.edPub);
        contactTag = contact?.tag ?? '';
        return !!contact;
      }, 15000, 'session established');

      await alice.sendText(contactTag, 'hello from a child process');
      await waitFor(
        () => !!bob.snapshot().messages.find((m) => m.text === 'hello from a child process'),
        15000,
        'message delivered',
      );
      const incoming = bob.snapshot().messages.find((m) => m.text === 'hello from a child process')!;
      expect(incoming.dir).toBe('in');
    } finally {
      await alice.stop();
      await bob.stop();
    }
  }, 45000);
});
