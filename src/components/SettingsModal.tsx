import { useState } from 'react'
import { Bell, ChevronRight, Fingerprint, LogOut, Moon, Palette, Shield, Timer, X } from 'lucide-react'
import type { Identity, TransportId } from '../lib/types'
import { TRANSPORTS } from '../lib/transports'
import { clearIdentity } from '../lib/identity'

interface Props {
  identity: Identity
  transport: TransportId
  setTransport: (t: TransportId) => void
  onClose: () => void
  onLogout: () => void
}

function Row({ icon: Icon, title, sub, right, onClick }: any) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3.5 px-4 py-3.5 hover:bg-white/[.04] transition-all text-left">
      <span className="w-10 h-10 rounded-2xl bg-white/[.05] flex items-center justify-center text-violet-300 shrink-0"><Icon size={19} /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14.5px] font-semibold">{title}</span>
        {sub && <span className="block text-[12px] text-white/40 truncate">{sub}</span>}
      </span>
      {right ?? <ChevronRight size={17} className="text-white/30" />}
    </button>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-11 h-6 rounded-full p-0.5 transition-all shrink-0 ${on ? 'grad-btn' : 'bg-white/15'}`}>
      <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export default function SettingsModal({ identity, transport, setTransport, onClose, onLogout }: Props) {
  const [notif, setNotif] = useState(true)
  const [dark, setDark] = useState(true)
  const [disappear, setDisappear] = useState(false)
  const [section, setSection] = useState<'main' | 'transports' | 'security'>('main')

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end md:items-center justify-center anim-fade-in" onClick={onClose}>
      <div
        className="w-full md:max-w-md max-h-[92dvh] glass-strong md:rounded-3xl rounded-t-3xl overflow-hidden flex flex-col anim-pop"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[.06] shrink-0">
          <h3 className="font-extrabold text-lg">
            {section === 'main' ? 'Настройки' : section === 'transports' ? 'Транспорты' : 'Безопасность'}
          </h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-white/[.06] flex items-center justify-center"><X size={19} /></button>
        </div>

        <div className="overflow-y-auto scroll-slim">
          {section === 'main' && (
            <>
              <div className="flex items-center gap-4 px-5 py-5">
                <div className="w-16 h-16 rounded-full grad-btn flex items-center justify-center text-2xl font-extrabold">
                  {identity.username[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-extrabold text-lg truncate">{identity.username}</p>
                  <p className="text-white/45 text-sm font-mono truncate">{identity.handle}</p>
                  <span className="inline-block mt-1 text-[10px] font-bold bg-emerald-400/15 text-emerald-300 px-2 py-0.5 rounded-full">АНОНИМНЫЙ АККАУНТ</span>
                </div>
              </div>
              <div className="h-px bg-white/[.06] mx-5" />
              <Row icon={Shield} title="Безопасность и ключи" sub="Отпечаток, резервная копия" onClick={() => setSection('security')} />
              <Row icon={Bell} title="Уведомления" sub="Звук и вибрация" right={<Toggle on={notif} onClick={() => setNotif(v => !v)} />} />
              <Row icon={Moon} title="Тёмная тема" sub="Всегда включена в демо" right={<Toggle on={dark} onClick={() => setDark(v => !v)} />} />
              <Row icon={Timer} title="Исчезающие сообщения" sub="Автоудаление через 24 часа" right={<Toggle on={disappear} onClick={() => setDisappear(v => !v)} />} />
              <Row icon={Palette} title="Транспорты" sub="Cloudflare · Fly.io · P2P · Tor · Mesh" onClick={() => setSection('transports')} />
              <div className="h-px bg-white/[.06] mx-5 my-2" />
              <button
                onClick={() => { clearIdentity(); onLogout() }}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 text-rose-400 hover:bg-rose-500/10 transition-all text-left"
              >
                <span className="w-10 h-10 rounded-2xl bg-rose-500/10 flex items-center justify-center shrink-0"><LogOut size={19} /></span>
                <span className="text-[14.5px] font-semibold">Выйти и удалить ключи</span>
              </button>
              <p className="text-center text-[11px] text-white/25 py-4">MeshChat v0.1 Demo · Сделано с ❤️</p>
            </>
          )}

          {section === 'transports' && (
            <div className="p-3">
              <button onClick={() => setSection('main')} className="text-violet-300 text-sm font-semibold px-2 py-1 mb-2">← Назад</button>
              {TRANSPORTS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTransport(t.id)}
                  className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-left transition-all mb-1 ${transport === t.id ? 'bg-violet-500/15' : 'hover:bg-white/[.04]'}`}
                >
                  <span className="text-2xl">{t.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14.5px] font-semibold">{t.name}</span>
                    <span className="block text-[12px] text-white/40">{t.desc} · {t.latency}</span>
                  </span>
                  {transport === t.id && <span className="text-[10px] font-bold bg-violet-500/25 text-violet-200 px-2 py-1 rounded-full">АКТИВЕН</span>}
                </button>
              ))}
              <div className="bg-amber-400/10 border border-amber-400/20 rounded-2xl p-4 mt-3 mx-1">
                <p className="text-[13px] text-amber-200 font-semibold">Демо-режим</p>
                <p className="text-[12px] text-amber-200/60 mt-1 leading-relaxed">
                  Cloudflare и Fly.io ключи ещё не подключены. После добавления ключей транспорты заработают по-настоящему, с автопереключением при блокировках.
                </p>
              </div>
            </div>
          )}

          {section === 'security' && (
            <div className="p-5">
              <button onClick={() => setSection('main')} className="text-violet-300 text-sm font-semibold mb-4">← Назад</button>
              <div className="bg-black/30 rounded-2xl p-4 mb-3">
                <div className="flex items-center gap-2 text-white/50 text-xs font-semibold mb-2"><Fingerprint size={14} /> Твой отпечаток</div>
                <p className="font-mono text-[12px] leading-relaxed text-violet-200 break-all">{identity.fingerprint}</p>
              </div>
              <div className="bg-black/30 rounded-2xl p-4 mb-3">
                <div className="flex items-center gap-2 text-white/50 text-xs font-semibold mb-2">Публичный ключ</div>
                <p className="font-mono text-[11px] leading-relaxed text-white/50 break-all">{identity.publicKey.slice(0, 64)}…</p>
              </div>
              <div className="space-y-2 text-[13px] text-white/55">
                <p>🔒 Шифрование: Double Ratchet (X3DH + AES-256-GCM)</p>
                <p>👁 Сервер не видит сообщения и метаданные</p>
                <p>⏱ Forward secrecy: ключи меняются каждое сообщение</p>
                <p>📱 Приватный ключ хранится только на устройстве</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
