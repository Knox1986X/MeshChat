import { describe, expect, it, beforeAll } from 'vitest';
import { initCrypto } from '../packages/core/src/sodium';
import {
  createIdentity,
  exportIdentity,
  importIdentity,
  parseInvite,
  encodeInvite,
  routingTag,
  safetyNumber,
  identityFromSeed,
} from '../packages/core/src/identity';
import {
  createPreKeyState,
  opkList,
  publicBundle,
  verifyBundle,
  findOpkSecret,
  maybeRotateSignedPreKey,
} from '../packages/core/src/prekeys';
import { x3dhInitiate, x3dhRespond } from '../packages/core/src/x3dh';
import { seal, open, b64, random } from '../packages/core/src/sodium';
import { encodePayload, decodePayload } from '../packages/core/src/protocol';
import { newEnvelopeId, solvePow, verifyPow, isEnvelope, type Envelope } from '../packages/core/src/envelope';

beforeAll(async () => {
  await initCrypto();
});

describe('identity', () => {
  it('creates an anonymous identity with derived x25519 keys', () => {
    const id = createIdentity('alice');
    expect(id.edPub).toHaveLength(43);
    expect(id.xPub).toHaveLength(43);
    expect(id.name).toBe('alice');
  });

  it('round-trips through an encrypted backup', () => {
    const id = createIdentity('bob');
    const backup = exportIdentity(id, 'correct horse battery staple');
    expect(backup.startsWith('meshchat-id-v1.')).toBe(true);
    expect(backup).not.toContain(id.edSec);
    const restored = importIdentity(backup, 'correct horse battery staple');
    expect(restored.edPub).toBe(id.edPub);
    expect(restored.edSec).toBe(id.edSec);
    expect(() => importIdentity(backup, 'wrong password')).toThrow();
  });

  it('produces stable routing tags and safety numbers', () => {
    const id = identityFromSeed(new Uint8Array(32).fill(7), 'carol');
    expect(routingTag(id.edPub)).toBe(routingTag(id.edPub));
    expect(safetyNumber(id.edPub)).toMatch(/^\d{5}( \d{5}){11}$/);
    expect(routingTag(id.edPub)).not.toBe(routingTag(createIdentity('dave').edPub));
  });

  it('parses invite links', () => {
    const id = createIdentity('erin');
    const link = encodeInvite({ v: 1, key: id.edPub, name: 'erin', relays: ['https://relay.example'], about: 'hi' });
    const parsed = parseInvite(link);
    expect(parsed?.key).toBe(id.edPub);
    expect(parsed?.relays).toEqual(['https://relay.example']);
    expect(parseInvite('garbage')).toBeNull();
    expect(parseInvite('meshchat://add?k=notakey')).toBeNull();
  });
});

describe('prekeys', () => {
  it('signs bundles and verifies signatures', () => {
    const id = createIdentity('frank');
    const state = createPreKeyState(id);
    const opk = opkList(state)[0];
    const bundle = publicBundle(id, state, opk);
    expect(verifyBundle(bundle)).toBe(true);
    const tampered = { ...bundle, spk: createIdentity('mallory').xPub };
    expect(verifyBundle(tampered)).toBe(false);
  });

  it('rotates signed prekeys and keeps the old secret', () => {
    const id = createIdentity('gina');
    const state = createPreKeyState(id);
    const oldId = state.spk.id;
    const oldSec = state.spk.sec;
    expect(maybeRotateSignedPreKey(id, state, 0)).toBe(true);
    expect(state.spk.id).not.toBe(oldId);
    expect(state.history?.find((h) => h.id === oldId)?.sec).toBe(oldSec);
  });
});

describe('x3dh', () => {
  it('derives the same session key on both sides', () => {
    const alice = createIdentity('alice');
    const bob = createIdentity('bob');
    const bobPrekeys = createPreKeyState(bob);
    const opk = opkList(bobPrekeys)[3];
    const bundle = publicBundle(bob, bobPrekeys, opk);
    const init = x3dhInitiate(alice, bundle);
    const skBob = x3dhRespond({
      identity: bob,
      spkSec: bobPrekeys.spk.sec,
      opkSec: findOpkSecret(bobPrekeys, opk.id),
      ikA: alice.edPub,
      ekA: init.ekPub,
    });
    expect(b64(skBob)).toBe(b64(init.sk));
  });

  it('works without a one-time prekey', () => {
    const alice = createIdentity('alice');
    const bob = createIdentity('bob');
    const bobPrekeys = createPreKeyState(bob);
    const bundle = publicBundle(bob, bobPrekeys);
    const init = x3dhInitiate(alice, bundle);
    const skBob = x3dhRespond({
      identity: bob,
      spkSec: bobPrekeys.spk.sec,
      ikA: alice.edPub,
      ekA: init.ekPub,
    });
    expect(b64(skBob)).toBe(b64(init.sk));
  });

  it('rejects a forged bundle', () => {
    const alice = createIdentity('alice');
    const bob = createIdentity('bob');
    const mallory = createIdentity('mallory');
    const bobPrekeys = createPreKeyState(bob);
    const bundle = publicBundle(bob, bobPrekeys);
    const forged = { ...bundle, spk: mallory.xPub };
    expect(() => x3dhInitiate(alice, forged)).toThrow(/signature/);
  });
});

describe('aead + padding', () => {
  it('encrypts and decrypts, and rejects tampering', () => {
    const key = random(32);
    const sealed = seal(key, new TextEncoder().encode('secret'));
    expect(new TextDecoder().decode(open(key, sealed.nonce, sealed.ciphertext))).toBe('secret');
    const bad = new Uint8Array(sealed.ciphertext);
    bad[0] ^= 1;
    expect(() => open(key, sealed.nonce, bad)).toThrow();
  });

  it('pads every payload to a 256 byte block', () => {
    const a = encodePayload({ t: 'msg', id: 'a', ts: 1, text: 'x' });
    const b = encodePayload({ t: 'msg', id: 'b', ts: 1, text: 'y'.repeat(200) });
    expect(a.length % 256).toBe(0);
    expect(b.length % 256).toBe(0);
    expect(decodePayload(a)).toMatchObject({ t: 'msg', text: 'x' });
    expect(decodePayload(b)).toMatchObject({ t: 'msg', text: 'y'.repeat(200) });
  });
});

describe('proof of work', () => {
  it('solves and verifies', async () => {
    const env = { to: routingTag(createIdentity('x').edPub), id: newEnvelopeId() };
    const nonce = await solvePow(env, 10);
    const full = { v: 1, ...env, ts: Date.now(), k: 'n', rm: { dh: 'x', pn: 0, n: 0, ct: 'A'.repeat(44) }, pow: nonce } as unknown as Envelope;
    expect(verifyPow(full, 10)).toBe(true);
    expect(verifyPow(full, 40)).toBe(false);
    expect(isEnvelope(full)).toBe(true);
  });
});
