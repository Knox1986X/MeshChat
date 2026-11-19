import { useState } from 'react'
import { Fingerprint, KeyRound, Loader2, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { generateIdentity } from '../lib/identity'
import type { Identity } from '../lib/types'
import Logo from './Logo'

export default function Onboarding({ onDone }: { onDone: (id: Identity) => void }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [generated, setGenerated] = useState<Identity | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    const id = await generateIdentity(name || 'mesh_user')
    setGenerated(id)
    setLoading(false)
  }

  return (
    <div className="navy-bg h-full w-full flex items-center justify-center p-4 overflow-y-auto scroll-slim relative">
      <div className="w-full max-w-md anim-fade-up relative z-10">
        <div className="flex flex-col items-center text-center mb-7">
          <div className="relative mb-5">
            <div className="absolute inset-0 rounded-[30px] bg-indigo-500/40 blur-2xl" />
            <div className="relative anim-floaty">
              <Logo size={84} />
            </div>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight">
            Mesh<span className="grad-text">Chat</span>
          </h1>
          <p className="text-slate-400 mt-2 text-[15px] leading-relaxed">
            Анонимный мессенджер нового поколения.<br />
            Без телефона. Без слежки. Бесплатно.
          </p>
        </div>

        <div className="card p-6">
          {!generated ? (
            <>
              <label className="text-sm font-semibold text-slate-200">Придумай имя</label>
              <div className="flex items-center gap-2 mt-2 mb-1">
                <span className="text-slate-500 font-mono">@</span>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="например, neo"
                  className="flex-1 bg-white/[.04] border border-white/[.08] rounded-2xl px-4 py-3 text-[15px] placeholder:text-slate-500 transition-all"
                  maxLength={20}
                />
              </div>
              <p className="text-xs text-slate-500 mb-5">Имя + криптографический ключ = твоя личность. Никакого телефона и email.</p>

              <button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full grad-btn rounded-2xl py-3.5 font-bold text-[15px] flex items-center justify-center gap-2 transition-all disabled:opacity-60"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
                {loading ? 'Генерируем ключи…' : 'Создать анонимный аккаунт'}
              </button>

              <div className="grid grid-cols-3 gap-2 mt-6 text-center">
                {[
                  { icon: ShieldCheck, label: 'E2E шифрование' },
                  { icon: Zap, label: 'Без VPN' },
                  { icon: Sparkles, label: 'Бесплатно' },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="bg-white/[.03] rounded-2xl py-3 px-1">
                    <Icon size={18} className="mx-auto text-sky-300 mb-1.5" />
                    <p className="text-[11px] text-slate-400 font-medium leading-tight">{label}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="anim-pop">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl grad-btn flex items-center justify-center font-extrabold text-lg">
                  {generated.username[0].toUpperCase()}
                </div>
                <div>
                  <p className="font-bold text-lg leading-tight">{generated.username}</p>
                  <p className="text-slate-400 text-sm font-mono">{generated.handle}</p>
                </div>
                <span className="ml-auto text-[11px] font-bold bg-emerald-400/15 text-emerald-300 px-2.5 py-1 rounded-full">ГОТОВО</span>
              </div>

              <div className="bg-black/30 rounded-2xl p-4 mb-4">
                <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold mb-2">
                  <Fingerprint size={14} /> Отпечаток ключа
                </div>
                <p className="font-mono text-[12px] leading-relaxed text-sky-200 break-all">{generated.fingerprint}</p>
                <p className="text-[11px] text-slate-500 mt-2">Сохрани его — по нему тебя узнают в MeshChat. Приватный ключ хранится только на этом устройстве.</p>
              </div>

              <button onClick={() => onDone(generated)} className="w-full grad-btn rounded-2xl py-3.5 font-bold text-[15px] transition-all">
                Войти в MeshChat →
              </button>
              <p className="text-center text-[11px] text-slate-500 mt-3">Демо-режим: серверные ключи Cloudflare/Fly.io пока не подключены</p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Open Source · Double Ratchet · Mesh-транспорт · v2.3.0
        </p>
      </div>
    </div>
  )
}
