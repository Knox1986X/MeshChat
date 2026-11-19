import { useState } from 'react'
import { Camera, Check, Copy, Palette, Pencil, QrCode, ShieldCheck } from 'lucide-react'
import type { Identity } from '../../lib/types'

interface Props {
  identity: Identity
  onLogout: () => void
}

export default function ProfileScreen({ identity, onLogout }: Props) {
  const [copied, setCopied] = useState<string | null>(null)

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
          <div className="relative inline-block">
            <div className="w-[104px] h-[104px] rounded-[30px] grad-btn flex items-center justify-center text-[38px] font-extrabold mx-auto">
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

        {/* Version card */}
        <div className="card p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-[16px]">
              MeshChat v2.1.0{' '}
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
    </div>
  )
}
