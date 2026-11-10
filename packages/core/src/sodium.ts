/**
 * Thin, typed wrapper around libsodium (sumo).
 *
 * Everything MeshChat does cryptographically goes through this module so there
 * is exactly one place to audit. Primitives:
 *   - Ed25519        identity / signatures
 *   - X25519         key agreement (converted from the Ed25519 identity key)
 *   - XChaCha20-Poly1305 IETF   AEAD for messages and local storage
 *   - BLAKE2b        hashing, PoW and routing tags
 *   - HMAC-SHA256    chains + HKDF
 *   - Argon2id       passphrase based backup encryption
 */
import sodiumFactory from 'libsodium-wrappers-sumo';

type Sodium = typeof sodiumFactory;

let sodium: Sodium | null = null;

/** Must be awaited once before any other function in this file is used. */
export async function initCrypto(): Promise<void> {
  if (sodium) return;
  await (sodiumFactory as unknown as { ready: Promise<void> }).ready;
  sodium = sodiumFactory;
}

export function S(): Sodium {
  if (!sodium) throw new Error('meshchat: crypto not initialised (await initCrypto())');
  return sodium;
}

export const B64 = () => S().base64_variants.URLSAFE_NO_PADDING;

export function b64(bytes: Uint8Array): string {
  return S().to_base64(bytes, B64());
}
export function unb64(text: string): Uint8Array {
  return S().from_base64(text, B64());
}
export function b64len(len: number): number {
  return Math.ceil((len * 4) / 3);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const utf8 = (s: string): Uint8Array => encoder.encode(s);
export const str = (b: Uint8Array): string => decoder.decode(b);

export function random(n: number): Uint8Array {
  return S().randombytes_buf(n);
}
export function randomHex(n = 16): string {
  return Array.from(random(n), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return S().memcmp(a, b);
}

/** BLAKE2b-256 over the concatenation of the parts. */
export function hash(...parts: Array<Uint8Array | string>): Uint8Array {
  return S().crypto_generichash(32, concat(...parts.map((p) => (typeof p === 'string' ? utf8(p) : p))));
}

export function hashToB64(...parts: Array<Uint8Array | string>): string {
  return b64(hash(...parts));
}

function sha256(data: Uint8Array): Uint8Array {
  return S().crypto_hash_sha256(data);
}

/**
 * RFC 2104 HMAC-SHA256 with arbitrary key length.
 * libsodium's `crypto_auth_hmacsha256` only accepts 32 byte keys, which is too
 * narrow for HKDF (its salt is a full hash and may be shorter or longer), so we
 * build HMAC from the plain SHA-256 primitive.
 */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  const keyBlock = new Uint8Array(blockSize);
  if (key.length > blockSize) keyBlock.set(sha256(key));
  else keyBlock.set(key);
  const inner = new Uint8Array(blockSize);
  const outer = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    inner[i] = keyBlock[i] ^ 0x36;
    outer[i] = keyBlock[i] ^ 0x5c;
  }
  return sha256(concat(outer, sha256(concat(inner, message))));
}

/** HKDF-SHA256 (RFC 5869). */
export function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array | string, length = 32): Uint8Array {
  const infoBytes = typeof info === 'string' ? utf8(info) : info;
  const prk = hmacSha256(salt.length ? salt : new Uint8Array(32), ikm);
  const chunks: Uint8Array[] = [];
  let prev = new Uint8Array(0);
  let counter = 1;
  let produced = 0;
  while (produced < length) {
    prev = hmacSha256(prk, concat(prev, infoBytes, new Uint8Array([counter])));
    chunks.push(prev);
    produced += prev.length;
    counter++;
  }
  return concat(...chunks).slice(0, length);
}

// ---------------------------------------------------------------- AEAD ------

export const AEAD_KEYBYTES = 32;
export const AEAD_NONCEBYTES = 24;
export const AEAD_ABYTES = 16;

export interface Sealed {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/** XChaCha20-Poly1305 with a random 24 byte nonce. */
export function seal(key: Uint8Array, plaintext: Uint8Array, ad?: Uint8Array): Sealed {
  if (key.length !== AEAD_KEYBYTES) throw new Error('bad key length');
  const nonce = random(AEAD_NONCEBYTES);
  const ciphertext = S().crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    ad ?? null,
    null,
    nonce,
    key,
  );
  return { nonce, ciphertext };
}

export function open(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, ad?: Uint8Array): Uint8Array {
  const out = S().crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, ad ?? null, nonce, key);
  if (!out) throw new Error('decryption failed');
  return out;
}

/** AEAD with a caller supplied nonce (used by the ratchet where the KDF makes the nonce). */
export function sealWithNonce(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  ad?: Uint8Array,
): Uint8Array {
  return S().crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, ad ?? null, null, nonce, key);
}

export function openWithNonce(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  ad?: Uint8Array,
): Uint8Array {
  const out = S().crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, ad ?? null, nonce, key);
  if (!out) throw new Error('decryption failed');
  return out;
}

// ------------------------------------------------------------- keys ---------

export interface XKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export function x25519KeyPair(): XKeyPair {
  return S().crypto_kx_keypair();
}

export function x25519(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return S().crypto_scalarmult(secretKey, publicKey);
}

export function x25519Public(secretKey: Uint8Array): Uint8Array {
  return S().crypto_scalarmult_base(secretKey);
}

export interface EdKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export function ed25519FromSeed(seed: Uint8Array): EdKeyPair {
  return S().crypto_sign_seed_keypair(seed);
}

export function edToX25519Public(edPublic: Uint8Array): Uint8Array {
  return S().crypto_sign_ed25519_pk_to_curve25519(edPublic);
}

export function edToX25519Secret(edSecret: Uint8Array): Uint8Array {
  return S().crypto_sign_ed25519_sk_to_curve25519(edSecret);
}

export function sign(message: Uint8Array, edSecret: Uint8Array): Uint8Array {
  return S().crypto_sign_detached(message, edSecret);
}

export function verify(signature: Uint8Array, message: Uint8Array, edPublic: Uint8Array): boolean {
  try {
    return S().crypto_sign_verify_detached(signature, message, edPublic);
  } catch {
    return false;
  }
}

// ------------------------------------------------------- passphrase KDF -----

/**
 * Argon2id, interactive-ish parameters that are still comfortable in a browser
 * on a phone (64 MiB, 3 passes). Used only for local backup files.
 */
export function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Uint8Array {
  return S().crypto_pwhash(
    32,
    passphrase,
    salt,
    3,
    64 * 1024 * 1024,
    S().crypto_pwhash_ALG_ARGON2ID13,
  );
}

export function wipe(bytes: Uint8Array): void {
  try {
    S().memzero(bytes);
  } catch {
    /* ignore */
  }
}
