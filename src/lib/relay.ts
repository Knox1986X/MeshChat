import { useCallback, useEffect, useRef, useState } from 'react'
import { recordBytes } from './metrics'

export interface RelayConfig {
  url: string
  key: string
}

const KEY = 'meshchat_relay'

export const EMPTY_RELAY: RelayConfig = { url: '', key: '' }

export function loadRelay(): RelayConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY_RELAY
    const parsed = JSON.parse(raw) as Partial<RelayConfig>
    return { url: parsed.url ?? '', key: parsed.key ?? '' }
  } catch {
    return EMPTY_RELAY
  }
}

export function saveRelay(cfg: RelayConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)) } catch {}
  window.dispatchEvent(new CustomEvent('meshchat-relay'))
}

export function isRelayConfigured(cfg = loadRelay()) {
  return /^https?:\/\//.test(cfg.url.trim())
}

export type Light = 'ok' | 'warn' | 'down' | 'off'

export interface RelayHealth {
  light: Light
  rtt: number | null
  jitter: number | null
  /** изменение задержки, доля (0.4 = +40%) */
  trend: number
  checkedAt: number
  version?: string
  colo?: string
  error?: string
}

export const OFFLINE_HEALTH: RelayHealth = {
  light: 'off', rtt: null, jitter: null, trend: 0, checkedAt: 0,
}

export async function pingRelay(cfg: RelayConfig, timeoutMs = 6000) {
  const base = cfg.url.trim().replace(/\/$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = performance.now()
  try {
    const res = await fetch(`${base}/health`, {
      headers: cfg.key ? { 'x-relay-key': cfg.key } : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })
    const rtt = Math.round(performance.now() - started)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { ok?: boolean; version?: string; colo?: string }
    if (!data.ok) throw new Error('relay unhealthy')
    return { rtt, version: data.version, colo: data.colo }
  } finally {
    clearTimeout(timer)
  }
}

export function lightFor(rtt: number | null, trend: number): Light {
  if (rtt === null) return 'down'
  if (rtt > 900 || trend > 0.9) return 'down'
  if (rtt > 300 || trend > 0.4) return 'warn'
  return 'ok'
}

/**
 * Транспортный светофор: пингуем /health каждые 20 с,
 * сравниваем текущий RTT с медианой прошлых замеров.
 */
export function useRelayHealth() {
  const [cfg, setCfg] = useState<RelayConfig>(() => loadRelay())
  const [health, setHealth] = useState<RelayHealth>(OFFLINE_HEALTH)
  const [checking, setChecking] = useState(false)
  const history = useRef<number[]>([])

  useEffect(() => {
    const sync = () => setCfg(loadRelay())
    window.addEventListener('meshchat-relay', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('meshchat-relay', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const check = useCallback(async (target?: RelayConfig) => {
    const c = target ?? loadRelay()
    if (!isRelayConfigured(c)) {
      history.current = []
      setHealth(OFFLINE_HEALTH)
      return OFFLINE_HEALTH
    }
    setChecking(true)
    try {
      const { rtt, version, colo } = await pingRelay(c)
      const prev = history.current
      const median = prev.length
        ? [...prev].sort((a, b) => a - b)[Math.floor(prev.length / 2)]
        : rtt
      const trend = median > 0 ? (rtt - median) / median : 0
      history.current = [...prev, rtt].slice(-6)
      const next: RelayHealth = {
        light: lightFor(rtt, trend),
        rtt,
        jitter: prev.length ? Math.abs(rtt - prev[prev.length - 1]) : 0,
        trend,
        checkedAt: Date.now(),
        version,
        colo,
      }
      recordBytes('relay', 180)
      setHealth(next)
      return next
    } catch (e) {
      const next: RelayHealth = {
        ...OFFLINE_HEALTH,
        light: 'down',
        checkedAt: Date.now(),
        error: e instanceof Error ? (e.name === 'AbortError' ? 'таймаут 6 с' : e.message) : 'ошибка',
      }
      setHealth(next)
      return next
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (!isRelayConfigured(cfg)) {
      setHealth(OFFLINE_HEALTH)
      return
    }
    check(cfg)
    const iv = window.setInterval(() => check(cfg), 20_000)
    return () => window.clearInterval(iv)
  }, [cfg, check])

  return { cfg, health, checking, check, save: (next: RelayConfig) => { saveRelay(next); setCfg(next); check(next) } }
}

export const LIGHT_COLOR: Record<Light, string> = {
  ok: '#34d399',
  warn: '#fbbf24',
  down: '#fb7185',
  off: '#475569',
}

export const LIGHT_LABEL: Record<Light, string> = {
  ok: 'канал здоров',
  warn: 'деградация',
  down: 'нет связи',
  off: 'не подключён',
}
