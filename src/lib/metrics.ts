/**
 * Честный счётчик: сколько байт реально покинуло устройство.
 * Считаем сами, на клиенте, без серверной телеметрии.
 */

export type EgressKind = 'relay' | 'p2p' | 'tor' | 'local'

export interface Egress {
  relay: number
  p2p: number
  tor: number
  local: number
  updatedAt: number
}

const KEY = 'meshchat_egress'

export const EMPTY_EGRESS: Egress = { relay: 0, p2p: 0, tor: 0, local: 0, updatedAt: 0 }

export function readEgress(): Egress {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY_EGRESS
    return { ...EMPTY_EGRESS, ...(JSON.parse(raw) as Partial<Egress>) }
  } catch {
    return EMPTY_EGRESS
  }
}

export function recordBytes(kind: EgressKind, bytes: number) {
  if (bytes <= 0) return
  const cur = readEgress()
  const next: Egress = { ...cur, [kind]: cur[kind] + bytes, updatedAt: Date.now() }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch {}
  window.dispatchEvent(new CustomEvent('meshchat-egress'))
}

export function resetEgress() {
  try { localStorage.removeItem(KEY) } catch {}
  window.dispatchEvent(new CustomEvent('meshchat-egress'))
}

export function formatBytes(b: number) {
  if (b < 1024) return `${b} Б`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`
  return `${(b / 1024 / 1024).toFixed(2)} МБ`
}

export function totalNetwork(e: Egress) {
  return e.relay + e.p2p + e.tor
}
