import { useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarClock, Check, Clock, Sunrise, X } from 'lucide-react'

interface Props {
  onClose: () => void
  onSchedule: (at: number) => void
}

function atHour(h: number, addDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + addDays)
  d.setHours(h, 0, 0, 0)
  return d.getTime()
}

export default function ScheduleSheet({ onClose, onSchedule }: Props) {
  const [custom, setCustom] = useState('')

  const presets = [
    { label: 'Через 5 минут', sub: 'пока не забыл', icon: Clock, at: Date.now() + 5 * 60_000 },
    { label: 'Через час', sub: 'в тот же день', icon: Clock, at: Date.now() + 60 * 60_000 },
    { label: 'Завтра в 09:00', sub: 'утренняя отправка', icon: Sunrise, at: atHour(9, 1) },
    { label: 'В понедельник 10:00', sub: 'начало недели', icon: CalendarClock, at: (() => { const d = new Date(); const diff = (8 - d.getDay()) % 7 || 7; return atHour(10, diff) })() },
  ]

  const submitCustom = () => {
    if (!custom) return
    const ts = new Date(custom).getTime()
    if (!Number.isNaN(ts) && ts > Date.now()) onSchedule(ts)
  }

  return (
    <div className="absolute inset-0 z-[60] flex items-end justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
      <motion.div
        initial={{ y: 340, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 340, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="relative w-full max-w-lg bg-[#0e1631] border-t border-white/10 rounded-t-[26px] px-4 pt-2.5 pb-7"
      >
        <div className="w-9 h-1 rounded-full bg-white/20 mx-auto mb-3" />
        <div className="flex items-center gap-2 mb-3">
          <CalendarClock size={18} className="text-sky-300" />
          <p className="font-extrabold text-[16px]">Отложенная отправка</p>
          <button onClick={onClose} className="ml-auto w-8 h-8 rounded-full bg-white/[.06] flex items-center justify-center">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-1.5">
          {presets.map(p => {
            const Icon = p.icon
            return (
              <button
                key={p.label}
                onClick={() => onSchedule(p.at)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-white/[.04] hover:bg-white/[.08] active:bg-white/[.12] transition-colors text-left"
              >
                <Icon size={18} className="text-sky-300 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold">{p.label}</span>
                  <span className="block text-[11.5px] text-slate-400">{p.sub}</span>
                </span>
                <span className="text-[11.5px] font-mono text-slate-500">
                  {new Date(p.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex gap-2 mt-3">
          <input
            type="datetime-local"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            className="flex-1 bg-[#0b1226] border border-white/10 rounded-xl px-3 py-2.5 text-[13px]"
          />
          <button onClick={submitCustom} className="grad-btn rounded-xl px-4 text-[13px] font-bold flex items-center gap-1.5">
            <Check size={14} /> ОК
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
          Сообщение хранится зашифрованным на устройстве и уйдёт по таймеру. Если транспорта нет — отправится,
          когда появится связь.
        </p>
      </motion.div>
    </div>
  )
}
