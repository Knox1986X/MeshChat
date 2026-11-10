/**
 * X3DH key agreement (Signal's "extended triple Diffie-Hellman"), with X25519
 * for agreement, Ed25519 for authentication and HKDF-SHA256 for derivation.
 *
 * Result is a 32 byte shared secret that seeds the Double Ratchet.
 */
import {
  b64,
  concat,
  edToX25519Public,
  hkdf,
  unb64,
  utf8,
  x25519,
  x25519KeyPair,
} from './sodium';
import { verifyBundle, type PreKeyBundle } from './prekeys';
import type { Identity } from './identity';

export interface X3DHInitiatorResult {
  sk: Uint8Array;
  /** Ephemeral public key that must travel in clear inside the first envelope. */
  ekPub: string;
  ekSec: string;
  spk: string;
  spkId: number;
  opkId?: number;
  bundle: PreKeyBundle;
}

const SALT = () => utf8('meshchat/x3dh/v1');

function derive(parts: Uint8Array[], ikA: string, ikB: string): Uint8Array {
  const f = concat(unb64(ikA), unb64(ikB));
  return hkdf(concat(f, ...parts), SALT(), 'meshchat/session/v1', 32);
}

export function x3dhInitiate(identity: Identity, bundle: PreKeyBundle): X3DHInitiatorResult {
  if (!verifyBundle(bundle)) throw new Error('prekey bundle signature is invalid');
  const ek = x25519KeyPair();
  const ikBx = edToX25519Public(unb64(bundle.ik));
  const dh1 = x25519(unb64(identity.xSec), unb64(bundle.spk));
  const dh2 = x25519(ek.privateKey, ikBx);
  const dh3 = x25519(ek.privateKey, unb64(bundle.spk));
  const parts = [dh1, dh2, dh3];
  if (bundle.opk) parts.push(x25519(ek.privateKey, unb64(bundle.opk.pub)));
  return {
    sk: derive(parts, identity.edPub, bundle.ik),
    ekPub: b64(ek.publicKey),
    ekSec: b64(ek.privateKey),
    spk: bundle.spk,
    spkId: bundle.spkId,
    opkId: bundle.opk?.id,
    bundle,
  };
}

export interface X3DHResponderInput {
  identity: Identity;
  spkSec: string;
  opkSec?: string;
  /** Initiator's Ed25519 identity key (in clear in the prekey envelope). */
  ikA: string;
  /** Initiator's ephemeral X25519 public key (in clear in the prekey envelope). */
  ekA: string;
}

export function x3dhRespond(input: X3DHResponderInput): Uint8Array {
  const { identity, spkSec, opkSec, ikA, ekA } = input;
  const ikAx = edToX25519Public(unb64(ikA));
  const dh1 = x25519(unb64(spkSec), ikAx);
  const dh2 = x25519(unb64(identity.xSec), unb64(ekA));
  const dh3 = x25519(unb64(spkSec), unb64(ekA));
  const parts = [dh1, dh2, dh3];
  if (opkSec) parts.push(x25519(unb64(opkSec), unb64(ekA)));
  return derive(parts, ikA, identity.edPub);
}
