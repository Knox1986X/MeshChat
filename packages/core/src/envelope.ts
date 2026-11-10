/**
 * Envelope: the only thing a relay ever sees.
 *
 * It contains a routing tag (an HMAC-like BLAKE2b of the recipient's public
 * key), a random message id, a timestamp, optionally the X3DH preamble needed
 * to bootstrap a session, and the ratchet ciphertext. No sender, no recipient
 * name, no plaintext — the relay cannot tell who is talking to whom unless the
 * prekey preamble is present, and it can never read anything.
 */
import { b64, hash, random, unb64, utf8 } from './sodium';
import type { RatchetMessage } from './ratchet';

export interface Envelope {
  v: 1;
  /** Routing tag of the recipient (not their public key). */
  to: string;
  /** Random 72-bit id, used for de-duplication and PoW. */
  id: string;
  ts: number;
  /** k = kind: 'p' = prekey (session bootstrap), 'n' = normal. */
  k: 'p' | 'n';
  /** X3DH preamble, only for k === 'p'. */
  ik?: string;
  ek?: string;
  opk?: number;
  spk?: number;
  /** Ratchet ciphertext. */
  rm: RatchetMessage;
  /** Proof of work nonce (hex), asks the sender to burn a little CPU. */
  pow?: string;
}

export function newEnvelopeId(): string {
  return b64(random(9));
}

export function powTarget(env: Pick<Envelope, 'to' | 'id'>, nonce: string): Uint8Array {
  return hash('meshchat/pow/v1', env.to, '|', env.id, '|', nonce);
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function verifyPow(env: Envelope, difficulty: number): boolean {
  if (difficulty <= 0) return true;
  if (!env.pow) return false;
  return leadingZeroBits(powTarget(env, env.pow)) >= difficulty;
}

/**
 * Grind a nonce until the hash has `difficulty` leading zero bits.
 * Runs in slices so a UI can stay responsive on the main thread.
 */
export async function solvePow(
  env: Pick<Envelope, 'to' | 'id'>,
  difficulty: number,
  opts: { maxIterations?: number; sliceSize?: number; onProgress?: (frac: number) => void } = {},
): Promise<string> {
  if (difficulty <= 0) return '0';
  const maxIterations = opts.maxIterations ?? 1 << 26;
  const sliceSize = opts.sliceSize ?? 2000;
  const expected = 2 ** difficulty;
  for (let i = 0; i < maxIterations; ) {
    const end = Math.min(i + sliceSize, maxIterations);
    for (; i < end; i++) {
      const nonce = i.toString(16);
      if (leadingZeroBits(powTarget(env, nonce)) >= difficulty) return nonce;
    }
    opts.onProgress?.(Math.min(0.98, i / expected));
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('proof of work did not converge (difficulty too high?)');
}

export function envelopeBytes(env: Envelope): number {
  return utf8(JSON.stringify(env)).length;
}

/** Validate structure on the receiving side before we spend CPU on crypto. */
export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const e = value as Envelope;
  if (e.v !== 1) return false;
  if (typeof e.to !== 'string' || typeof e.id !== 'string') return false;
  if (typeof e.ts !== 'number' || (e.k !== 'p' && e.k !== 'n')) return false;
  if (!e.rm || typeof e.rm.dh !== 'string' || typeof e.rm.ct !== 'string') return false;
  if (typeof e.rm.n !== 'number' || typeof e.rm.pn !== 'number') return false;
  try {
    if (unb64(e.to).length !== 16) return false;
    if (unb64(e.rm.ct).length < 32) return false;
  } catch {
    return false;
  }
  if (e.k === 'p' && (!e.ik || !e.ek)) return false;
  return true;
}
