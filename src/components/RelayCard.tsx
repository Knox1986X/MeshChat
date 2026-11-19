import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2, Plug, Radio, Server, TriangleAlert } from 'lucide-react'
import { LIGHT_COLOR, LIGHT_LABEL, useRelayHealth, type Light } from '../lib/relay'

const LIGHTS: Light[] = ['ok', 'warn', 'down']

export default function RelayCard() {
  const { cfg, health, checking, check, save } = useRelayHealth()
  const [url, setUrl] = useState(cfg.url)
  const [key, setKey] = useState(cfg.key)
  const [saved, setSaved] = useState(false)
  const [open, setOpen] = useState(!cfg.url)

  const apply = async () => {
    save({ url: url.trim(), key: key.trim() })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
    setOpen(false)
  }

  const active = health.light

  return (
    <div className="card p-4 mb-5 relative overflow-hidden">
      <div className="flex items-start gap-3">
        {/* Светофор */}
        <div className="flex flex-col gap-1.5 bg-black/40 border border-white/[.08] rounded-2xl p-2 shrink-0">
          {LIGHTS.map(l => {
            const on = active === l
            return (
              <div key={l} className="relative w-4 h-4 rounded-full transition-colors" style={{ background: on ? LIGHT_COLOR[l] : 'rgba(255,255,255,.10)' }}>
                {on && (
                  <motion.span
                    layoutId="relay-glow"
                    className="absolute inset-0 rounded-full"
                    style={{ boxShadow: `0 0 14px 2px ${LIGHT_COLOR[l]}` }}
                    animate={{ opacity: [0.55, 1, 0.55] }}
                    transition={{ duration: 2.2, repeat: Infinity }}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Radio size={15} className="text-sky-300" />
            <p className="font-extrabold text-[15px]">Транспортный светофор</p>
            <span
              className="ml-auto text-[10.5px] font-black px-2 py-0.5 rounded-md"
              style={{ background: `${LIGHT_COLOR[active]}22`, color: LIGHT_COLOR[active] }}
            >
              {LIGHT_LABEL[active].toUpperCase()}
            </span>
          </div>

          <p className="text-[12.5px] text-slate-400 mt-1 leading-relaxed">
            {cfg.url
              ? health.rtt !== null
                ? `RTT ${health.rtt} мс · джиттер ${health.jitter ?? 0} мс · тренд ${health.trend >= 0 ? '+' : ''}${Math.round(health.trend * 100)}%${health.colo ? ` · ${health.colo}` : ''}`
                : health.error
                  ? `Ошибка: ${health.error}`
                  : 'ожидание первого замера…'
              : 'Relay не подключён — сообщения никуда не уходят (fail-closed).'}
          </p>

          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={() => setOpen(v => !v)}
              className="text-[12px] font-bold px-3 py-1.5 rounded-full bg-white/[.06] border border-white/[.08] hover:bg-white/[.1] transition-colors"
            >
              {cfg.url ? 'Изменить адрес' : 'Подключить relay'}
            </button>
            {cfg.url && (
              <button
                onClick={() => check()}
                disabled={checking}
                className="text-[12px] font-bold px-3 py-1.5 rounded-full bg-sky-500/15 border border-sky-400/25 text-sky-200 disabled:opacity-60 flex items-center gap-1.5"
              >
                {checking ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
                Проверить
              </button>
            )}
          </div>
        </div>
      </div>

      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
          <div className="mt-3.5 space-y-2">
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://meshchat-relay.<субдомен>.workers.dev"
              className="w-full bg-[#0b1226] border border-white/10 rounded-xl px-3 py-2.5 text-[13px] font-mono"
            />
            <input
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="RELAY_KEY (если задан в воркере)"
              className="w-full bg-[#0b1226] border border-white/10 rounded-xl px-3 py-2.5 text-[13px] font-mono"
            />
            <div className="flex gap-2">
              <button onClick={apply} className="flex-1 grad-btn rounded-xl py-2.5 text-[13px] font-bold flex items-center justify-center gap-1.5">
                {saved ? <><Check size={14} /> Сохранено</> : <><Server size={14} /> Подключить</>}
              </button>
              <a
                href="https://github.com/Knox1986X/MeshChat/blob/arena/f1e61635-meshchat/DEPLOY.md"
                target="_blank"
                rel="noreferrer"
                className="px-3.5 rounded-xl bg-white/[.06] border border-white/10 text-[12.5px] font-bold flex items-center"
              >
                Как развернуть
              </a>
            </div>
            <p className="text-[11px] text-slate-500 flex items-start gap-1.5 leading-relaxed">
              <TriangleAlert size={12} className="mt-0.5 shrink-0 text-amber-300" />
              Пока relay не отвечает, MeshChat не отправляет ничего в открытую сеть — это защита от утечки IP.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  )
}
