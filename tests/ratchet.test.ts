import { describe, expect, it, beforeAll } from 'vitest';
import { initCrypto, b64 } from '../packages/core/src/sodium';
import { createIdentity } from '../packages/core/src/identity';
import { createPreKeyState, findOpkSecret, opkList, publicBundle } from '../packages/core/src/prekeys';
import { x3dhInitiate, x3dhRespond } from '../packages/core/src/x3dh';
import {
  ratchetDecrypt,
  ratchetDeserialize,
  ratchetEncrypt,
  ratchetInitInitiator,
  ratchetInitResponder,
  ratchetSerialize,
  type RatchetState,
} from '../packages/core/src/ratchet';

beforeAll(async () => {
  await initCrypto();
});

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

function establish(): { a: RatchetState; b: RatchetState } {
  const alice = createIdentity('alice');
  const bob = createIdentity('bob');
  const bobPrekeys = createPreKeyState(bob);
  const opk = opkList(bobPrekeys)[0];
  const init = x3dhInitiate(alice, publicBundle(bob, bobPrekeys, opk));
  const skBob = x3dhRespond({
    identity: bob,
    spkSec: bobPrekeys.spk.sec,
    opkSec: findOpkSecret(bobPrekeys, opk.id),
    ikA: alice.edPub,
    ekA: init.ekPub,
  });
  expect(b64(skBob)).toBe(b64(init.sk));
  return {
    a: ratchetInitInitiator(init.sk, init.ekPub, init.ekSec, init.spk),
    b: ratchetInitResponder(skBob, bobPrekeys.spk.pub, bobPrekeys.spk.sec, init.ekPub),
  };
}

describe('double ratchet', () => {
  it('exchanges messages in both directions', () => {
    const { a, b } = establish();
    const m1 = ratchetEncrypt(a, enc('hello bob'));
    expect(dec(ratchetDecrypt(b, m1))).toBe('hello bob');
    const m2 = ratchetEncrypt(b, enc('hello alice'));
    expect(dec(ratchetDecrypt(a, m2))).toBe('hello alice');
    const m3 = ratchetEncrypt(a, enc('third'));
    expect(dec(ratchetDecrypt(b, m3))).toBe('third');
  });

  it('advances keys for every message (forward secrecy)', () => {
    const { a, b } = establish();
    const first = ratchetEncrypt(a, enc('one'));
    const second = ratchetEncrypt(a, enc('two'));
    expect(first.ct).not.toBe(second.ct);
    expect(dec(ratchetDecrypt(b, first))).toBe('one');
    expect(dec(ratchetDecrypt(b, second))).toBe('two');
    // replaying is rejected because the message key is gone
    expect(() => ratchetDecrypt(b, second)).toThrow();
  });

  it('handles out-of-order delivery with skipped keys', () => {
    const { a, b } = establish();
    const m1 = ratchetEncrypt(a, enc('one'));
    const m2 = ratchetEncrypt(a, enc('two'));
    const m3 = ratchetEncrypt(a, enc('three'));
    expect(dec(ratchetDecrypt(b, m3))).toBe('three');
    expect(dec(ratchetDecrypt(b, m1))).toBe('one');
    expect(dec(ratchetDecrypt(b, m2))).toBe('two');
  });

  it('recovers after a DH ratchet step with lost messages', () => {
    const { a, b } = establish();
    const lost = ratchetEncrypt(a, enc('lost'));
    expect(dec(ratchetDecrypt(b, lost))).toBe('lost');
    const reply = ratchetEncrypt(b, enc('reply'));
    expect(dec(ratchetDecrypt(a, reply))).toBe('reply');
    const after = ratchetEncrypt(a, enc('after'));
    expect(dec(ratchetDecrypt(b, after))).toBe('after');
  });

  it('rejects tampered headers and ciphertexts', () => {
    const { a, b } = establish();
    const msg = ratchetEncrypt(a, enc('authentic'));
    expect(() => ratchetDecrypt(b, { ...msg, n: msg.n + 5 })).toThrow();
    const tampered = { ...msg, ct: `${msg.ct.slice(0, -4)}AAAA` };
    expect(() => ratchetDecrypt(b, tampered)).toThrow();
  });

  it('serialises and restores state', () => {
    const { a, b } = establish();
    const msg = ratchetEncrypt(a, enc('persisted'));
    const restoredB = ratchetDeserialize(ratchetSerialize(b));
    expect(dec(ratchetDecrypt(restoredB, msg))).toBe('persisted');
  });

  it('does not let a third party decrypt', () => {
    const { a, b } = establish();
    const eve = establish().b;
    const msg = ratchetEncrypt(a, enc('private'));
    expect(() => ratchetDecrypt(eve, msg)).toThrow();
  });
});
