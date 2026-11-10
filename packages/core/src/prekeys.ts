/**
 * Prekey bundles (X3DH). Lets somebody start an encrypted session with you
 * while your device is offline — no key server knows who is talking to whom,
 * it only stores public key material under your routing tag.
 */
import {
  b64,
  concat,
  sign,
  unb64,
  utf8,
  verify,
  x25519KeyPair,
} from './sodium';
import type { Identity } from './identity';

export interface OneTimePreKey {
  id: number;
  pub: string;
}

export interface PreKeyBundle {
  v: 1;
  /** Identity key of the bundle owner (Ed25519). */
  ik: string;
  /** Signed prekey (X25519). */
  spk: string;
  spkId: number;
  /** Ed25519 signature over spk && spkId. */
  spkSig: string;
  /** Optional one-time prekey, consumed by the server on first fetch. */
  opk?: OneTimePreKey;
  ts: number;
}

export interface PreKeyState {
  v: 1;
  spk: { id: number; pub: string; sec: string; sig: string; createdAt: number };
  /** Previously rotated signed prekeys, kept so late X3DH messages still open. */
  history?: Array<{ id: number; pub: string; sec: string; createdAt: number }>;
  /** Unused one-time prekeys, private halves. */
  opks: Array<{ id: number; pub: string; sec: string }>;
  /** Prekeys already handed out; kept to decrypt late arrivals. */
  used: Array<{ id: number; pub: string; sec: string; usedAt: number }>;
  nextId: number;
}

function spkSignedMessage(spkPub: string, spkId: number): Uint8Array {
  return concat(utf8('meshchat/signed-prekey/v1'), unb64(spkPub), new Uint8Array([spkId & 0xff, (spkId >> 8) & 0xff]));
}

export const ONE_TIME_PREKEY_COUNT = 24;

export function createPreKeyState(identity: Identity, existing?: PreKeyState): PreKeyState {
  const state: PreKeyState = existing ?? {
    v: 1,
    spk: { id: 0, pub: '', sec: '', sig: '', createdAt: 0 },
    opks: [],
    used: [],
    nextId: 1,
  };
  if (!state.spk.pub) {
    const kp = x25519KeyPair();
    state.spk = {
      id: state.nextId++,
      pub: b64(kp.publicKey),
      sec: b64(kp.privateKey),
      sig: b64(sign(spkSignedMessage(b64(kp.publicKey), state.nextId - 1), unb64(identity.edSec))),
      createdAt: Date.now(),
    };
  }
  while (state.opks.length < ONE_TIME_PREKEY_COUNT) {
    const kp = x25519KeyPair();
    state.opks.push({ id: state.nextId++, pub: b64(kp.publicKey), sec: b64(kp.privateKey) });
  }
  return state;
}

/** Rotate the signed prekey every 7 days; old sessions keep working. */
export function maybeRotateSignedPreKey(identity: Identity, state: PreKeyState, maxAgeMs = 7 * 24 * 3600_000): boolean {
  if (Date.now() - state.spk.createdAt < maxAgeMs) return false;
  const kp = x25519KeyPair();
  const id = state.nextId++;
  state.history = [...(state.history ?? []), state.spk].slice(-4);
  state.spk = {
    id,
    pub: b64(kp.publicKey),
    sec: b64(kp.privateKey),
    sig: b64(sign(spkSignedMessage(b64(kp.publicKey), id), unb64(identity.edSec))),
    createdAt: Date.now(),
  };
  return true;
}

/** Re-sign the current signed prekey (idempotent, used after an import). */
export function resignPreKeys(identity: Identity, state: PreKeyState): void {
  state.spk.sig = b64(sign(spkSignedMessage(state.spk.pub, state.spk.id), unb64(identity.edSec)));
}

export function publicBundle(identity: Identity, state: PreKeyState, opk?: OneTimePreKey): PreKeyBundle {
  return {
    v: 1,
    ik: identity.edPub,
    spk: state.spk.pub,
    spkId: state.spk.id,
    spkSig: state.spk.sig,
    opk,
    ts: Date.now(),
  };
}

export function opkList(state: PreKeyState): OneTimePreKey[] {
  return state.opks.map((o) => ({ id: o.id, pub: o.pub }));
}

export function markOpkUsed(state: PreKeyState, id: number): void {
  const idx = state.opks.findIndex((o) => o.id === id);
  if (idx < 0) return;
  const [opk] = state.opks.splice(idx, 1);
  state.used.push({ ...opk, usedAt: Date.now() });
  // keep a bounded history of consumed prekeys
  const cutoff = Date.now() - 30 * 24 * 3600_000;
  state.used = state.used.filter((o) => o.usedAt > cutoff).slice(-200);
}

export function findOpkSecret(state: PreKeyState, id: number): string | undefined {
  return state.opks.find((o) => o.id === id)?.sec ?? state.used.find((o) => o.id === id)?.sec;
}

export function findSignedPreKeySecret(state: PreKeyState, spkId: number, spkPub?: string): string | undefined {
  if (state.spk.id === spkId && (!spkPub || state.spk.pub === spkPub)) return state.spk.sec;
  const old = state.history?.find((h) => h.id === spkId && (!spkPub || h.pub === spkPub));
  return old?.sec;
}

export function verifyBundle(bundle: PreKeyBundle): boolean {
  if (bundle.v !== 1) return false;
  if (!bundle.ik || !bundle.spk || !bundle.spkSig) return false;
  try {
    if (unb64(bundle.ik).length !== 32 || unb64(bundle.spk).length !== 32) return false;
    if (bundle.opk && unb64(bundle.opk.pub).length !== 32) return false;
  } catch {
    return false;
  }
  return verify(unb64(bundle.spkSig), spkSignedMessage(bundle.spk, bundle.spkId), unb64(bundle.ik));
}
