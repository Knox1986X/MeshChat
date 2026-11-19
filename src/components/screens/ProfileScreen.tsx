import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Camera, Check, Copy, Fingerprint, Palette, Pencil, QrCode, ShieldCheck, X } from 'lucide-react'
import type { Identity } from '../../lib/types'
import KeyVerifyModal from '../KeyVerifyModal'
import { formatBytes, readEgress, resetEgress, totalNetwork } from '../../lib/metrics'
import { Gauge } from 'lucide-react'

interface Props {
  identity: Identity
  onLogout: () => void
}

export default function ProfileScreen({ identity, onLogout }: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  const [showVerify, setShowVerify] = useState(false)
  const [panic, setPanic] = useState(false)
  const [egress, setEgress] = useState(() => readEgress())
  const taps = useRef<{ n: number; at: number }>({ n: 0, at: 0 })

  // Паника-жест: три тапа по аватару за 2 секунды
  const tapAvatar = () => {
    const now = Date.now()
    const fresh = now - taps.current.at < 2000
    const n = fresh ? taps.current.n + 1 : 1
    taps.current = { n, at: now }
    navigator.vibrate?.(n >= 3 ? 40 : 12)
    if (n >= 3) {
      taps.current = { n: 0, at: 0 }
      setPanic(true)
    }
  }

  const copy = async (what: string, value: string) => {
    try { await navigator.clipboard.writeText(value) } catch {}
    setCopied(what)
    setTimeout(() => setCopied(null), 1800)
  }

  const shortKey = identity.publicKey.slice(0, 14) + ' ' + identity.publicKey.slice(14, 22) + '…'

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto scroll-slim px-4 pt-14 pb-28 md:pb-6">
        {/* Top pills */}
        <div className="flex items-center justify-between mb-3">
          <span className="bg-white/[.06] border border-white/[.07] text-slate-200 text-[11.5px] font-extrabold tracking-wider px-3.5 py-2 rounded-full">
            E2EE ПРОФИЛЬ
          </span>
          <button className="flex items-center gap-2 bg-white/[.06] border border-white/[.07] text-slate-200 text-[13px] font-bold px-3.5 py-2 rounded-full">
            <Palette size={15} className="text-sky-300" /> Тема
          </button>
        </div>

        {/* Header card */}
        <div className="card p-5 text-center mb-3">
          <span className="inline-block bg-white/[.06] border border-white/[.08] text-slate-200 text-[12.5px] font-bold px-4 py-1.5 rounded-full mb-4">
            На связи · E2EE
          </span>
          <div className="relative inline-block" onClick={tapAvatar}>
            <div className="w-[104px] h-[104px] rounded-[30px] grad-btn flex items-center justify-center text-[38px] font-extrabold mx-auto active:scale-95 transition-transform">
              {identity.username[0].toUpperCase()}
            </div>
            <button className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/40 border-[3px] border-[#131c3d]">
              <Camera size={16} />
            </button>
          </div>
          <h2 className="text-[26px] font-extrabold mt-3 flex items-center justify-center gap-2">
            {identity.username}
            <ShieldCheck size={22} className="text-sky-400" fill="rgba(56,189,248,.18)" />
          </h2>
          <p className="text-slate-400 text-[13.5px] mt-1">{identity.handle} · сессия защищена (без повторного входа)</p>

          <div className="grid grid-cols-3 gap-2 mt-5">
            {[
              { icon: Camera, label: 'Выбрать фото' },
              { icon: Pencil, label: 'Изменить' },
              { icon: Palette, label: 'Цвета и стиль' },
            ].map(({ icon: Icon, label }) => (
              <button key={label} className="bg-white/[.04] border border-white/[.06] rounded-2xl py-3.5 px-1 flex flex-col items-center gap-1.5 hover:bg-white/[.08] transition-all">
                <Icon size={20} className="text-slate-200" />
                <span className="text-[11.5px] font-bold text-slate-200 leading-tight text-center">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Identity cards */}
        <div className="card divide-y divide-white/[.05] overflow-hidden mb-3">
          <button onClick={() => copy('handle', identity.handle)} className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[.03] transition-all">
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-[16px] font-mono">{identity.handle}</p>
              <p className="text-[12.5px] text-slate-400 mt-0.5">Имя пользователя (нажмите для QR-визитки и копирования)</p>
            </div>
            {copied === 'handle' ? <Check size={19} className="text-emerald-400 shrink-0" /> : <QrCode size={19} className="text-slate-300 shrink-0" />}
          </button>
          <div className="flex items-center gap-3 p-4">
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-[15.5px] leading-snug">Сквозное шифрование Signal Protocol · Без метаданных</p>
              <p className="text-[12.5px] text-slate-400 mt-0.5">О себе · синхронизируется по Double Ratchet</p>
            </div>
            <Pencil size={17} className="text-slate-300 shrink-0" />
          </div>
          <button onClick={() => copy('gateway', `/q/${identity.username}`)} className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[.03] transition-all">
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-[16px] font-mono">/q/{identity.username}</p>
              <p className="text-[12.5px] text-slate-400 mt-0.5">Анонимный E2EE-шлюз приёма обращений</p>
            </div>
            {copied === 'gateway' ? <Check size={19} className="text-emerald-400 shrink-0" /> : <Copy size={19} className="text-slate-300 shrink-0" />}
          </button>
          <button onClick={() => copy('key', identity.publicKey)} className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[.03] transition-all">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[14px] font-mono truncate">{shortKey}</p>
              <p className="text-[12.5px] text-slate-400 mt-0.5">Публичный ключ личности NIST P-256 · extractable=false</p>
            </div>
            <ShieldCheck size={19} className="text-slate-300 shrink-0" />
          </button>
        </div>

        {/* Key verification */}
        <button
          onClick={() => setShowVerify(true)}
          className="w-full card card-hover p-4 flex items-center gap-3 text-left mb-3"
        >
          <span className="w-11 h-11 rounded-full bg-emerald-400/15 text-emerald-300 flex items-center justify-center shrink-0">
            <Fingerprint size={21} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-extrabold text-[15.5px]">Сверить ключ с собеседником</span>
            <span className="block text-[12.5px] text-slate-400 mt-0.5">6 эмодзи вместо 60 цифр · защита от MITM</span>
          </span>
          <ShieldCheck size={19} className="text-slate-400 shrink-0" />
        </button>

        {/* Честный счётчик утечки */}
        <div className="card p-4 mb-3">
          <div className="flex items-center gap-2">
            <Gauge size={17} className="text-emerald-300" />
            <p className="font-extrabold text-[15px]">Честный счётчик утечки</p>
            <button
              onClick={() => { resetEgress(); setEgress(readEgress()) }}
              className="ml-auto text-[11px] font-bold text-slate-400 px-2 py-1 rounded-lg bg-white/[.05]"
            >
              сброс
            </button>
          </div>
          <p className="text-[24px] font-extrabold mt-1.5 tabular-nums">
            {formatBytes(totalNetwork(egress))}
            <span className="text-[12px] font-semibold text-slate-400 ml-2">ушло в сеть</span>
          </p>
          <div className="grid grid-cols-3 gap-2 mt-2.5">
            {[
              { label: 'relay', value: egress.relay, color: '#38bdf8' },
              { label: 'P2P', value: egress.p2p, color: '#34d399' },
              { label: 'Tor', value: egress.tor, color: '#a78bfa' },
            ].map(x => (
              <div key={x.label} className="bg-black/25 rounded-xl px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{x.label}</p>
                <p className="text-[13px] font-bold tabular-nums" style={{ color: x.color }}>{formatBytes(x.value)}</p>
              </div>
            ))}
          </div>
          <p className="text-[11.5px] text-slate-500 mt-2 leading-relaxed">
            Локальная обработка: {formatBytes(egress.local)}. Пока транспорт в демо — в сеть не уходит ничего,
            и счётчик это подтверждает. В onion-only режиме здесь должен оставаться ноль.
          </p>
        </div>

        {/* Version card */}
        <div className="card p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-[16px]">
              MeshChat v2.4.0{' '}
              <span className="text-[11px] font-bold bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-md align-middle">build 12</span>
            </p>
            <p className="text-[12.5px] text-slate-400 mt-0.5">Автообновление через GitHub Releases без конфликта пакетов</p>
          </div>
          <button className="bg-white/[.06] border border-white/[.08] rounded-2xl px-5 py-2.5 font-bold text-[13.5px] shrink-0 hover:bg-white/[.1] transition-all">
            Проверить
          </button>
        </div>

        <button onClick={onLogout} className="w-full mt-4 text-rose-400 font-bold text-[14px] py-3 rounded-2xl hover:bg-rose-500/10 transition-all">
          Выйти и удалить ключи
        </button>
      </div>

      <AnimatePresence>
        {showVerify && <KeyVerifyModal identity={identity} onClose={() => setShowVerify(false)} />}
      </AnimatePresence>

      {/* Паника-жест */}
      <AnimatePresence>
        {panic && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-5">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setPanic(false)}
              className="absolute inset-0 bg-rose-950/70 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="relative w-full max-w-sm card p-5 border-rose-500/30"
              style={{ background: 'linear-gradient(160deg, rgba(76,5,25,.96), rgba(30,10,30,.96))' }}
            >
              <button onClick={() => setPanic(false)} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <X size={15} />
              </button>
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-300 flex items-center justify-center mb-3">
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-[19px] font-extrabold">Паника: стереть всё?</h3>
              <p className="text-[13px] text-slate-300 mt-2 leading-relaxed">
                Приватный ключ и локальная история будут уничтожены навсегда. Восстановить нельзя —
                у собеседников сообщения останутся, у тебя нет.
              </p>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setPanic(false)} className="flex-1 bg-white/[.08] rounded-xl py-3 font-bold text-[13.5px]">
                  Отмена
                </button>
                <button
                  onClick={() => { setPanic(false); onLogout() }}
                  className="flex-1 bg-rose-500 rounded-xl py-3 font-bold text-[13.5px] active:scale-95 transition-transform"
                >
                  Стереть ключи
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
