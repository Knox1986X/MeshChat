import { useCallback, useEffect, useState } from 'react'
import { GIGACHAT_DEFAULTS, type GigaChatConfig } from './gigachat'

export type SupportMode = 'rules' | 'ai' | 'human'

export interface SupportPrefs {
  mode: SupportMode
  gigachat: GigaChatConfig
  /** оставлять тикет даже если ответил ИИ */
  alwaysTicket: boolean
}

const KEY = 'meshchat_support_prefs'

export const DEFAULT_PREFS: SupportPrefs = {
  mode: 'rules',
  gigachat: GIGACHAT_DEFAULTS,
  alwaysTicket: false,
}

export function loadSupportPrefs(): SupportPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<SupportPrefs>
    return {
      mode: parsed.mode ?? 'rules',
      alwaysTicket: parsed.alwaysTicket ?? false,
      gigachat: { ...GIGACHAT_DEFAULTS, ...(parsed.gigachat ?? {}) },
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function saveSupportPrefs(prefs: SupportPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch {}
  window.dispatchEvent(new CustomEvent('meshchat-support-prefs'))
}

export function useSupportPrefs() {
  const [prefs, setPrefs] = useState<SupportPrefs>(() => loadSupportPrefs())

  useEffect(() => {
    const sync = () => setPrefs(loadSupportPrefs())
    window.addEventListener('meshchat-support-prefs', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('meshchat-support-prefs', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const update = useCallback((patch: Partial<SupportPrefs>) => {
    const next = { ...loadSupportPrefs(), ...patch }
    saveSupportPrefs(next)
    setPrefs(next)
  }, [])

  return { prefs, update }
}

/* ───────────────────────── Операторы ───────────────────────── */

export interface Ticket {
  id: string
  createdAt: number
  subject: string
  status: 'queued' | 'answered' | 'closed'
  operator?: string
}

const TICKETS_KEY = 'meshchat_tickets'

export function loadTickets(): Ticket[] {
  try {
    return JSON.parse(localStorage.getItem(TICKETS_KEY) ?? '[]') as Ticket[]
  } catch {
    return []
  }
}

export function saveTickets(list: Ticket[]) {
  try { localStorage.setItem(TICKETS_KEY, JSON.stringify(list.slice(-30))) } catch {}
}

let seq = 5200

export function newTicket(subject: string): Ticket {
  seq += 1
  const t: Ticket = {
    id: `MC-${seq}`,
    createdAt: Date.now(),
    subject: subject.slice(0, 80),
    status: 'queued',
  }
  saveTickets([...loadTickets(), t])
  return t
}

export interface OperatorTeam {
  online: number
  avgReply: string
  queue: number
}

/** Демо-состояние дежурной смены: с реальным relay подтянем сюда /support/status */
export const OPERATOR_TEAM: OperatorTeam = { online: 2, avgReply: 'до 12 минут', queue: 3 }

export function operatorLabel(mode: SupportMode) {
  if (mode === 'ai') return 'GigaChat AI'
  if (mode === 'human') return 'Живой оператор'
  return 'База знаний'
}
