/**
 * Identity = a raw Ed25519 key pair. No phone number, no email, no server
 * account. The X25519 keys used for key agreement are derived from the same
 * seed, so one 32 byte secret is the whole account.
 */
import {
  b64,
  concat,
  deriveKeyFromPassphrase,
  ed25519FromSeed,
  edToX25519Secret,
  edToX25519Public,
  hash,
  open,
  random,
  seal,
  str,
  unb64,
  utf8,
} from './sodium';

export interface Identity {
  v: 1;
  /** Random device id, purely local. */
  id: string;
  name: string;
  /** Ed25519 public key, base64url (also the account address). */
  edPub: string;
  /** Ed25519 secret key (64 bytes), base64url. Never leaves the device. */
  edSec: string;
  /** X25519 public key derived from edPub. */
  xPub: string;
  /** X25519 secret key derived from edSec. */
  xSec: string;
  createdAt: number;
  about?: string;
}

export function createIdentity(name: string, about = ''): Identity {
  const seed = random(32);
  return identityFromSeed(seed, name, about);
}

export function identityFromSeed(seed: Uint8Array, name: string, about = ''): Identity {
  const kp = ed25519FromSeed(seed);
  const edPub = b64(kp.publicKey);
  const edSec = b64(kp.privateKey);
  return {
    v: 1,
    id: b64(random(9)),
    name: name.trim().slice(0, 48) || 'anonymous',
    edPub,
    edSec,
    xPub: b64(edToX25519Public(kp.publicKey)),
    xSec: b64(edToX25519Secret(kp.privateKey)),
    createdAt: Date.now(),
    about,
  };
}

/** Re-derive the X25519 half (useful when identity comes from a backup written by an older build). */
export function normalizeIdentity(identity: Identity): Identity {
  if (identity.xPub && identity.xSec) return identity;
  const pk = unb64(identity.edPub);
  const sk = unb64(identity.edSec);
  return {
    ...identity,
    xPub: b64(edToX25519Public(pk)),
    xSec: b64(edToX25519Secret(sk)),
  };
}

/** Routing tag the relay sees instead of the public key. 128 bits, not reversible. */
export function routingTag(edPubB64: string): string {
  return b64(hash('meshchat/routing-tag/v1', unb64(edPubB64)).slice(0, 16));
}

/** Human readable safety number: 60 digits, compared out of band. */
export function safetyNumber(edPubB64: string): string {
  const digest = hash('meshchat/safety-number/v1', unb64(edPubB64));
  let digits = '';
  for (let i = 0; i < 60; i++) digits += (digest[i % digest.length] % 10).toString();
  const lines: string[] = [];
  for (let i = 0; i < 60; i += 5) lines.push(digits.slice(i, i + 5));
  return lines.join(' ');
}

/** Short id shown under avatars, e.g. `a3f9 ··· 12c4`. */
export function shortId(edPubB64: string): string {
  const h = b64(hash('meshchat/short-id', unb64(edPubB64))).replace(/[-_]/g, '').slice(0, 12);
  return h.slice(0, 6);
}

// ------------------------------------------------------------- invites ------

export interface Invite {
  v: 1;
  /** Ed25519 public key of the person you are inviting. */
  key: string;
  name: string;
  /** Relay hints so the contact can find you without any global directory. */
  relays: string[];
  /** Optional short "about" line. */
  about?: string;
}

export function encodeInvite(invite: Invite): string {
  const params = new URLSearchParams();
  params.set('v', '1');
  params.set('k', invite.key);
  params.set('n', invite.name);
  if (invite.relays.length) params.set('r', invite.relays.join(','));
  if (invite.about) params.set('a', invite.about);
  return `meshchat://add?${params.toString()}`;
}

/** Also produce a link that works when opened in a browser. */
export function encodeInviteLink(invite: Invite, origin: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/#/add?${encodeInvite(invite).split('?')[1]}`;
}

export function parseInvite(input: string): Invite | null {
  const text = input.trim();
  const idx = text.indexOf('?');
  if (idx < 0) return null;
  const params = new URLSearchParams(text.slice(idx + 1));
  const key = params.get('k');
  if (!key) return null;
  try {
    if (unb64(key).length !== 32) return null;
  } catch {
    return null;
  }
  return {
    v: 1,
    key,
    name: (params.get('n') || 'anonymous').slice(0, 48),
    relays: (params.get('r') || '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    about: params.get('a') || undefined,
  };
}

// ------------------------------------------------------------- backups ------

const BACKUP_PREFIX = 'meshchat-id-v1.';

/** Encrypt the identity (and nothing else) with a passphrase using Argon2id + XChaCha20. */
export function exportIdentity(identity: Identity, passphrase: string): string {
  const salt = random(16);
  const key = deriveKeyFromPassphrase(passphrase, salt);
  const sealed = seal(key, utf8(JSON.stringify(identity)), concat(utf8('meshchat/identity-backup/v1'), salt));
  return BACKUP_PREFIX + b64(concat(salt, sealed.nonce, sealed.ciphertext));
}

export function importIdentity(backup: string, passphrase: string): Identity {
  const text = backup.trim();
  if (!text.startsWith(BACKUP_PREFIX)) throw new Error('not a MeshChat identity backup');
  const raw = unb64(text.slice(BACKUP_PREFIX.length));
  const salt = raw.slice(0, 16);
  const nonce = raw.slice(16, 40);
  const ciphertext = raw.slice(40);
  const key = deriveKeyFromPassphrase(passphrase, salt);
  const plain = open(key, nonce, ciphertext, concat(utf8('meshchat/identity-backup/v1'), salt));
  const identity = JSON.parse(str(plain)) as Identity;
  if (!identity.edPub || !identity.edSec) throw new Error('corrupted backup');
  return normalizeIdentity(identity);
}
