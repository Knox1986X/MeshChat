import { useState } from 'react'
import { Check, Copy, QrCode, Search, X } from 'lucide-react'
import type { Identity } from '../lib/types'
import Logo from './Logo'

interface Props {
  identity: Identity
  onClose: () => void
}

export default function NewChatModal({ identity, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [query, setQuery] = useState('')
  const link = `https://mesh.chat/invite/${identity.handle.replace('@', '').replace('#', '-')}`

  const copy = async () => {
    try { await navigator.clipboard.writeText(link) } catch {}
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center anim-fade-in" onClick={onClose}>
      <div className="w-full md:max-w-md glass-strong md:rounded-3xl rounded-t-3xl p-5 anim-pop max-h-[92dvh] overflow-y-auto scroll-slim" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-extrabold text-lg">Новый чат</h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-white/[.06] flex items-center justify-center"><X size={19} /></button>
        </div>

        <div className="relative mb-5">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Имя или @handle#xxxx"
            className="w-full bg-white/[.04] border border-white/[.08] rounded-2xl pl-10 pr-4 py-3 text-[14px] placeholder:text-slate-500"
          />
        </div>

        <div className="flex items-center gap-4 bg-white/[.04] rounded-3xl p-4 mb-4">
          <div className="w-24 h-24 rounded-2xl bg-white p-2 shrink-0 relative overflow-hidden">
            <div className="w-full h-full qr-pattern opacity-90" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Logo size={34} />
            </div>
          </div>
          <div className="min-w-0">
            <p className="font-bold flex items-center gap-2"><QrCode size={16} className="text-sky-300" /> Пригласить по QR</p>
            <p className="text-[12.5px] text-slate-400 mt-1 leading-relaxed">Друг сканирует код — и вы сразу в чате. Без телефона и регистрации.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-black/30 rounded-2xl p-2 pl-4 mb-3">
          <p className="flex-1 text-[12.5px] font-mono text-slate-400 truncate">{link}</p>
          <button onClick={copy} className="grad-btn rounded-xl px-3.5 py-2 text-[13px] font-bold flex items-center gap-1.5 shrink-0">
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>

        <p className="text-[11.5px] text-slate-500 text-center">Твой handle: <span className="font-mono text-sky-300">{identity.handle}</span></p>
      </div>
    </div>
  )
}
