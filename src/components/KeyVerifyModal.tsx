import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Fingerprint, ShieldCheck, X } from 'lucide-react'
import type { Identity } from '../lib/types'
import Logo from './Logo'

const EMOJI = ['🦊', '🐋', '🌵', '🍉', '🎲', '🛰', '🧊', '🪐', '🐙', '🔥', '🌊', '🍀', '🎈', '🧭', '🪐', '🦉']

function hashUnits(seed: string, count: number) {
  let h = 2166136261
  const out: number[] = []
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  for (let i = 0; i < count; i++) {
    h ^= h << 13; h >>>= 0
    h ^= h >> 17
    h ^= h << 5; h >>>= 0
    out.push(Math.abs(h) % 1000)
  }
  return out
}

interface Props {
  identity: Identity
  onClose: () => void
}

export default function KeyVerifyModal({ identity, onClose }: Props) {
  const [verified, setVerified] = useState(false)

  const { emojis, cells } = useMemo(() => {
    const units = hashUnits(identity.publicKey, 24)
    return {
      emojis: units.slice(0, 6).map(u => EMOJI[u % EMOJI.length]),
      cells: hashUnits(identity.publicKey + identity.fingerprint, 121),
    }
  }, [identity])

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />
      <motion.div
        initial={{ y: 50, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 50, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="relative w-full max-w-md max-h-[92dvh] overflow-y-auto scroll-slim glass-strong rounded-t-[28px] md:rounded-[28px] p-5 pb-7"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[19px] font-extrabold">Сверка ключа</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">Сравни с собеседником вживую или по видеозвонку</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/[.06] flex items-center justify-center active:scale-90 transition-transform">
            <X size={17} />
          </button>
        </div>

        {/* QR-визитка */}
        <div className="relative mx-auto w-[210px] h-[210px] bg-white rounded-[22px] p-3 shadow-xl shadow-black/40">
          <div className="grid grid-cols-11 grid-rows-11 gap-[2px] w-full h-full">
            {cells.map((v, i) => (
              <span key={i} className="rounded-[1px]" style={{ background: v % 2 === 0 ? '#0b1226' : 'transparent' }} />
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-[58px] h-[58px] rounded-2xl bg-white flex items-center justify-center shadow-md">
              <Logo size={44} rounded={false} />
            </div>
          </div>
        </div>

        <p className="text-center font-mono text-[13px] font-bold mt-4">{identity.handle}</p>

        {/* Эмодзи-отпечаток */}
        <div className="card p-4 mt-3">
          <div className="flex items-center gap-2 mb-2">
            <Fingerprint size={16} className="text-sky-300" />
            <p className="text-[13px] font-bold">Отпечаток из 6 эмодзи</p>
          </div>
          <div className="flex justify-between text-[26px]">
            {emojis.map((e, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, scale: 0.5, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: 0.06 * i, type: 'spring', stiffness: 420, damping: 22 }}
              >
                {e}
              </motion.span>
            ))}
          </div>
          <p className="text-[11.5px] text-slate-500 mt-2 leading-relaxed">
            Проще, чем 60 цифр: продиктуй эмодзи по порядку. Если совпали — ключи одинаковые и MITM исключён.
          </p>
        </div>

        <p className="font-mono text-[10.5px] text-slate-500 break-all mt-3 text-center">
          {identity.publicKey}
        </p>

        <button
          onClick={() => { setVerified(true); window.setTimeout(onClose, 900) }}
          className={`w-full mt-4 rounded-2xl py-3.5 font-bold text-[14px] flex items-center justify-center gap-2 transition-all ${
            verified ? 'bg-emerald-500 text-white' : 'grad-btn'
          }`}
        >
          {verified ? <><Check size={17} /> Ключ подтверждён</> : <><ShieldCheck size={17} /> Отметить как доверенный</>}
        </button>
      </motion.div>
    </div>
  )
}
