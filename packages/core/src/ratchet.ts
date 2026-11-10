/**
 * Double Ratchet (Signal specification, simplified to one peer/one device).
 *
 *  - DH ratchet   : X25519, gives post-compromise security.
 *  - chain ratchet: HMAC-SHA256, gives forward secrecy per message.
 *  - AEAD         : XChaCha20-Poly1305, header authenticated as associated data.
 *
 * A new message key is burned for every single message, out-of-order delivery
 * is supported through skipped keys (bounded), and state serialises to JSON so
 * it can live in the client's encrypted local store.
 */
import {
  b64,
  concat,
  hkdf,
  hmacSha256,
  openWithNonce,
  sealWithNonce,
  unb64,
  utf8,
  x25519,
  x25519KeyPair,
} from './sodium';

export interface RatchetMessage {
  /** Sender's current ratchet public key. */
  dh: string;
  /** Number of messages in the previous sending chain. */
  pn: number;
  /** Index in the current sending chain. */
  n: number;
  /** base64url AEAD ciphertext. */
  ct: string;
}

export interface SkippedMessageKey {
  dh: string;
  n: number;
  mk: string;
}

export interface RatchetState {
  v: 1;
  role: 'i' | 'r';
  rk: string;
  dhs?: { pub: string; sec: string };
  dhr?: string;
  cks?: string;
  ckr?: string;
  ns: number;
  nr: number;
  pn: number;
  skipped: SkippedMessageKey[];
  sent: number;
  recv: number;
}

export const MAX_SKIP = 1000;
const MAX_SKIPPED_KEYS = 2000;

const SALT_MK = utf8('meshchat/msg-key/v1');
const SALT_ROOT = utf8('meshchat/ratchet/root/v1');

function kdfRoot(rk: Uint8Array, dhOut: Uint8Array): { rk: Uint8Array; ck: Uint8Array } {
  const out = hkdf(dhOut, rk, SALT_ROOT, 64);
  return { rk: out.slice(0, 32), ck: out.slice(32, 64) };
}

function kdfChain(ck: Uint8Array): { mk: Uint8Array; next: Uint8Array } {
  return {
    mk: hmacSha256(ck, new Uint8Array([1])),
    next: hmacSha256(ck, new Uint8Array([2])),
  };
}

function messageKeys(mk: Uint8Array): { key: Uint8Array; nonce: Uint8Array } {
  const out = hkdf(mk, SALT_MK, '', 56);
  return { key: out.slice(0, 32), nonce: out.slice(32, 56) };
}

function associatedData(msg: Pick<RatchetMessage, 'dh' | 'pn' | 'n'>): Uint8Array {
  return utf8(`meshchat/ratchet/v1|${msg.dh}|${msg.pn}|${msg.n}`);
}

export function ratchetInitInitiator(
  sk: Uint8Array,
  ekPub: string,
  ekSec: string,
  remoteSignedPreKey: string,
  role: 'i' | 'r' = 'i',
): RatchetState {
  const dhr = remoteSignedPreKey;
  const { rk, ck } = kdfRoot(sk, x25519(unb64(ekSec), unb64(dhr)));
  return {
    v: 1,
    role,
    rk: b64(rk),
    dhs: { pub: ekPub, sec: ekSec },
    dhr,
    cks: b64(ck),
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: [],
    sent: 0,
    recv: 0,
  };
}

export function ratchetInitResponder(
  sk: Uint8Array,
  signedPreKeyPub: string,
  signedPreKeySec: string,
  remoteEphemeral: string,
): RatchetState {
  const { rk, ck } = kdfRoot(sk, x25519(unb64(signedPreKeySec), unb64(remoteEphemeral)));
  const dhs = x25519KeyPair();
  return {
    v: 1,
    role: 'r',
    rk: b64(rk),
    dhs: { pub: b64(dhs.publicKey), sec: b64(dhs.privateKey) },
    dhr: remoteEphemeral,
    ckr: b64(ck),
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: [],
    sent: 0,
    recv: 0,
  };
}

function ensureSendingChain(state: RatchetState): Uint8Array {
  if (state.cks) return unb64(state.cks);
  if (!state.dhr) throw new Error('ratchet: no remote ratchet key yet');
  if (!state.dhs) {
    const kp = x25519KeyPair();
    state.dhs = { pub: b64(kp.publicKey), sec: b64(kp.privateKey) };
  }
  const step = kdfRoot(unb64(state.rk), x25519(unb64(state.dhs.sec), unb64(state.dhr)));
  state.rk = b64(step.rk);
  state.cks = b64(step.ck);
  return step.ck;
}

export function ratchetEncrypt(state: RatchetState, plaintext: Uint8Array): RatchetMessage {
  let ck = ensureSendingChain(state);
  const { mk, next } = kdfChain(ck);
  ck = next;
  state.cks = b64(ck);
  const { key, nonce } = messageKeys(mk);
  const header = { dh: state.dhs!.pub, pn: state.pn, n: state.ns };
  const ct = sealWithNonce(key, nonce, plaintext, associatedData(header));
  state.ns += 1;
  state.sent += 1;
  return { ...header, ct: b64(ct) };
}

function skipMessageKeys(state: RatchetState, until: number): void {
  if (!state.ckr) {
    if (until > state.nr) throw new Error('ratchet: missing receiving chain');
    return;
  }
  if (until - state.nr > MAX_SKIP) throw new Error('ratchet: too many skipped messages');
  let ck = unb64(state.ckr);
  while (state.nr < until) {
    const { mk, next } = kdfChain(ck);
    if (state.dhr) state.skipped.push({ dh: state.dhr, n: state.nr, mk: b64(mk) });
    ck = next;
    state.nr += 1;
  }
  state.ckr = b64(ck);
  if (state.skipped.length > MAX_SKIPPED_KEYS) {
    state.skipped = state.skipped.slice(-MAX_SKIPPED_KEYS);
  }
}

function dhRatchet(state: RatchetState, remotePub: string): void {
  state.pn = state.ns;
  state.ns = 0;
  state.nr = 0;
  state.dhr = remotePub;
  if (!state.dhs) {
    const kp = x25519KeyPair();
    state.dhs = { pub: b64(kp.publicKey), sec: b64(kp.privateKey) };
  }
  const recv = kdfRoot(unb64(state.rk), x25519(unb64(state.dhs.sec), unb64(remotePub)));
  state.rk = b64(recv.rk);
  state.ckr = b64(recv.ck);
  const kp = x25519KeyPair();
  state.dhs = { pub: b64(kp.publicKey), sec: b64(kp.privateKey) };
  const send = kdfRoot(unb64(state.rk), x25519(unb64(state.dhs.sec), unb64(remotePub)));
  state.rk = b64(send.rk);
  state.cks = b64(send.ck);
}

function trySkipped(state: RatchetState, msg: RatchetMessage, ad: Uint8Array): Uint8Array | null {
  const idx = state.skipped.findIndex((k) => k.dh === msg.dh && k.n === msg.n);
  if (idx < 0) return null;
  const [{ mk }] = state.skipped.splice(idx, 1);
  const { key, nonce } = messageKeys(unb64(mk));
  return openWithNonce(key, nonce, unb64(msg.ct), ad);
}

export function ratchetDecrypt(state: RatchetState, msg: RatchetMessage): Uint8Array {
  if (!msg.dh || typeof msg.n !== 'number' || typeof msg.pn !== 'number') {
    throw new Error('ratchet: malformed header');
  }
  const ad = associatedData(msg);
  const skipped = trySkipped(state, msg, ad);
  if (skipped) {
    state.recv += 1;
    return skipped;
  }
  if (msg.dh !== state.dhr) {
    skipMessageKeys(state, msg.pn);
    dhRatchet(state, msg.dh);
  }
  skipMessageKeys(state, msg.n);
  if (!state.ckr) throw new Error('ratchet: no receiving chain');
  const { mk, next } = kdfChain(unb64(state.ckr));
  state.ckr = b64(next);
  state.nr += 1;
  const { key, nonce } = messageKeys(mk);
  const plaintext = openWithNonce(key, nonce, unb64(msg.ct), ad);
  state.recv += 1;
  return plaintext;
}

export function ratchetSerialize(state: RatchetState): string {
  return JSON.stringify(state);
}

export function ratchetDeserialize(text: string): RatchetState {
  const state = JSON.parse(text) as RatchetState;
  if (state.v !== 1) throw new Error('unsupported ratchet state version');
  return state;
}

// Kept for callers that want to log a human readable transcript.
export function describeRatchet(state: RatchetState): string {
  return `rk=${state.rk.slice(0, 6)} n=${state.ns}/${state.nr} sent=${state.sent} recv=${state.recv}`;
}
