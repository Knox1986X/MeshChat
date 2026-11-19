import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bot, Check, ChevronRight, Cloud, Headphones, KeyRound, Loader2, Lock, ShieldCheck, Sparkles, Users, X,
} from 'lucide-react'
import { askGigaChat, clearGigaChatToken, isGigaChatReady } from '../lib/gigachat'
import {
  OPERATOR_TEAM, loadTickets, operatorLabel, useSupportPrefs, type SupportMode,
} from '../lib/supportPrefs'

const MODES: { id: SupportMode; title: string; sub: string; icon: typeof Bot }[] = [
  { id: 'rules', title: 'База знаний', sub: 'Офлайн, 0 мс, 27 тем', icon: Sparkles },
  { id: 'ai', title: 'GigaChat AI', sub: 'По твоему API-ключу', icon: Bot },
  { id: 'human', title: 'Живой оператор', sub: `Дежурная смена · ${OPERATOR_TEAM.online} онлайн`, icon: Users },
]

interface Props {
  onClose: () => void
}

export default function SupportConfig({ onClose }: Props) {
  const { prefs, update } = useSupportPrefs()
  const [draft, setDraft] = useState(prefs.gigachat)
  const [testing, setTesting] = useState<'idle' | 'run' | 'ok' | 'fail'>('idle')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const tickets = loadTickets()

  const set = (patch: Partial<typeof draft>) => {
    setDraft(d => ({ ...d, ...patch }))
    setTesting('idle')
    setError('')
  }

  const save = () => {
    update({ gigachat: draft })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
  }

  const test = async () => {
    if (!isGigaChatReady(draft)) {
      setTesting('fail')
      setError('Нужен relay URL или пара Client ID + Secret')
      return
    }
    setTesting('run')
    setError('')
    clearGigaChatToken()
    try {
      const answer = await askGigaChat('Ответь одним словом: работает?', [], draft)
      setTesting('ok')
      setError(answer.slice(0, 120))
      update({ gigachat: draft })
    } catch (e) {
      setTesting('fail')
      const msg = e instanceof Error ? e.message : 'ошибка'
      setError(
        msg === 'not-configured' ? 'Не заполнены ключи'
          : msg.includes('abort') ? 'Таймаут 20 с — relay не ответил'
            : msg.includes('401') || msg.includes('unauthorized') ? 'Ключи отклонены (401) — проверь Client ID/Secret'
              : `Не получилось: ${msg}. В браузере прямой вызов блокирует CORS — нужен relay.`,
      )
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />
      <motion.div
        initial={{ y: 60, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="relative w-full max-w-lg max-h-[92dvh] overflow-y-auto scroll-slim glass-strong rounded-t-[28px] md:rounded-[28px] p-5 pb-8"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[20px] font-extrabold">Поддержка</h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5">Режим ответа и подключение ключей</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/[.06] flex items-center justify-center active:scale-90 transition-transform">
            <X size={17} />
          </button>
        </div>

        {/* Режимы */}
        <div className="space-y-2 mb-5">
          {MODES.map(m => {
            const active = prefs.mode === m.id
            const Icon = m.icon
            return (
              <button
                key={m.id}
                onClick={() => update({ mode: m.id })}
                className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all ${
                  active ? 'bg-sky-500/[.13] border-sky-400/45' : 'bg-white/[.03] border-white/[.07] hover:bg-white/[.06]'
                }`}
              >
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${active ? 'bg-sky-500/25 text-sky-200' : 'bg-white/[.06] text-slate-300'}`}>
                  <Icon size={19} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-[14.5px]">{m.title}</span>
                  <span className="block text-[12px] text-slate-400 mt-0.5">{m.sub}</span>
                </span>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? 'border-sky-400 bg-sky-400' : 'border-white/25'}`}>
                  {active && <Check size={12} className="text-[#08122b]" strokeWidth={3} />}
                </span>
              </button>
            )
          })}
        </div>

        {/* GigaChat */}
        <div className={`rounded-2xl border p-4 mb-4 transition-colors ${prefs.mode === 'ai' ? 'border-sky-400/30 bg-sky-500/[.06]' : 'border-white/[.07] bg-white/[.02]'}`}>
          <div className="flex items-center gap-2 mb-1">
            <Bot size={17} className="text-sky-300" />
            <p className="font-extrabold text-[14.5px]">GigaChat (Сбер)</p>
            <span className={`ml-auto text-[10px] font-black px-2 py-0.5 rounded-md ${isGigaChatReady(prefs.gigachat) ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-slate-400'}`}>
              {isGigaChatReady(prefs.gigachat) ? 'КЛЮЧ ЕСТЬ' : 'НЕ НАСТРОЕН'}
            </span>
          </div>
          <p className="text-[12px] text-slate-400 leading-relaxed mb-3">
            OAuth + <code className="font-mono text-[11px]">/chat/completions</code>, модель <span className="font-mono text-[11px]">GigaChat</span>.
            Секреты хранятся только на этом устройстве; в интернет уходит запрос к relay.
          </p>

          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Relay URL (рекомендуется)</label>
          <input
            value={draft.relayUrl}
            onChange={e => set({ relayUrl: e.target.value.trim() })}
            placeholder="https://my-worker.workers.dev"
            className="w-full bg-[#0b1226] border border-white/10 rounded-xl px-3 py-2.5 text-[13.5px] font-mono mb-3"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Client ID</label>
              <input
                value={draft.clientId}
                onChange={e => set({ clientId: e.target.value.trim() })}
                placeholder="из личного кабинета"
                className="w-full bg-[#0b1226] border border-white/10 rounded-xl px-3 py-2.5 text-[13px] font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Client Secret</label>
              <input
                type="password"
                value={draft.clientSecret}
                onChange={e => set({ clientSecret: e.target.value.trim() })}
                placeholder="••••••••"
                className="w-full bg-[#0b1226] border border-white/10 rounded-xl px-3 py-2.5 text-[13px] font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 mt-2 text-[11.5px] text-slate-500">
            <Lock size={12} /> Ключи не уходят на наши серверы — только в запрос к Сберу или твоему relay.
          </div>

          <div className="flex gap-2 mt-3">
            <button
              onClick={test}
              disabled={testing === 'run'}
              className="flex-1 bg-white/[.07] hover:bg-white/[.11] border border-white/10 rounded-xl py-2.5 text-[13px] font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {testing === 'run' ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />}
              Проверить соединение
            </button>
            <button onClick={save} className="flex-1 grad-btn rounded-xl py-2.5 text-[13px] font-bold flex items-center justify-center gap-2">
              {saved ? <Check size={15} /> : <KeyRound size={15} />}
              {saved ? 'Сохранено' : 'Сохранить'}
            </button>
          </div>

          {testing !== 'idle' && error && (
            <p className={`mt-2.5 text-[11.5px] leading-relaxed ${testing === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>
              {testing === 'ok' ? `✓ Ответ модели: ${error}` : `✕ ${error}`}
            </p>
          )}
        </div>

        {/* Смена операторов */}
        <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Headphones size={16} className="text-cyan-300" />
            <p className="font-extrabold text-[14px]">Дежурная смена</p>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 blink-dot" />
              {OPERATOR_TEAM.online} на линии
            </span>
          </div>
          <p className="text-[12px] text-slate-400 leading-relaxed">
            Очередь: {OPERATOR_TEAM.queue} · средний ответ {OPERATOR_TEAM.avgReply}. Оператор отвечает в этом же чате,
            тикет привязан к ключу устройства — имя и телефон не нужны.
          </p>
          {tickets.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {tickets.slice(-3).reverse().map(t => (
                <div key={t.id} className="flex items-center gap-2 text-[11.5px] bg-black/25 rounded-lg px-2.5 py-1.5">
                  <span className="font-mono text-sky-300">{t.id}</span>
                  <span className="flex-1 truncate text-slate-400">{t.subject}</span>
                  <span className={`font-bold ${t.status === 'answered' ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {t.status === 'answered' ? 'ответ' : 'в очереди'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Политика */}
        <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <ShieldCheck size={16} className="text-emerald-300" />
            <p className="font-extrabold text-[13.5px]">Что уходит в облако</p>
          </div>
          <p className="text-[12px] text-slate-400 leading-relaxed">
            В режиме «База знаний» — ничего, всё локально. В «GigaChat» — только текст твоего вопроса
            (без ключей личности и истории чатов). В режиме «Оператор» — вопрос и номер тикета.
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-[11.5px] text-slate-500">
            <ChevronRight size={12} /> Активный режим: <span className="text-slate-300 font-semibold">{operatorLabel(prefs.mode)}</span>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
