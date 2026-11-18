import type { Identity } from './types'

const KEY = 'meshchat_identity'

function randomHex(len: number) {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

function fingerprintFrom(hex: string) {
  const groups: string[] = []
  for (let i = 0; i < hex.length; i += 4) groups.push(hex.slice(i, i + 4))
  return groups.join(' ').toUpperCase()
}

export async function generateIdentity(username: string): Promise<Identity> {
  const clean = username.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user'
  let publicKey = ''
  let fingerprint = ''
  try {
    const kp = await crypto.subtle.generateKey(
      { name: 'Ed25519' } as any,
      true,
      ['sign', 'verify'],
    )
    const raw = await crypto.subtle.exportKey('raw', kp.publicKey)
    publicKey = Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, '0')).join('')
    fingerprint = fingerprintFrom(publicKey.slice(0, 32))
  } catch {
    publicKey = randomHex(32)
    fingerprint = fingerprintFrom(publicKey.slice(0, 32))
  }
  const suffix = randomHex(2)
  const identity: Identity = {
    username: clean,
    handle: `@${clean}#${suffix}`,
    fingerprint,
    publicKey,
    createdAt: new Date().toISOString(),
  }
  localStorage.setItem(KEY, JSON.stringify(identity))
  return identity
}

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Identity) : null
  } catch {
    return null
  }
}

export function clearIdentity() {
  localStorage.removeItem(KEY)
}
