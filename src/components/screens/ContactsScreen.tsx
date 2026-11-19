import { useState } from 'react'
import { MessageSquare, Plus, ShieldCheck } from 'lucide-react'
import type { Contact, Identity } from '../../lib/types'
import { CONTACTS } from '../../lib/data'

interface Props {
  identity: Identity
  onOpenChat: (id: string) => void
}

export default function ContactsScreen({ identity, onOpenChat }: Props) {
  const [contacts, setContacts] = useState<Contact[]>(CONTACTS)
  const [input, setInput] = useState('')
  const [added, setAdded] = useState(false)

  const add = () => {
    const name = input.trim().replace(/^@/, '')
    if (!name) return
    setContacts(prev => [
      { id: `c${Date.now()}`, name, handle: `@${name}`, avatarFrom: '#38bdf8', avatarTo: '#6366f1', status: 'Ожидание подтверждения · E2EE', verified: false, online: false },
      ...prev,
    ])
    setInput('')
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-5 pt-14 pb-3 shrink-0">
        <h1 className="text-[30px] font-extrabold tracking-tight">Контакты</h1>
        <div className="flex items-center gap-2 mt-3">
          <span className="inline-flex items-center gap-2 bg-emerald-400/10 border border-emerald-400/25 text-emerald-300 text-[12.5px] font-bold px-3.5 py-2 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-400 blink-dot" />
            {contacts.filter(c => c.verified).length} проверенных узлов
          </span>
          <span className="bg-white/[.06] border border-white/[.07] text-slate-300 text-[12.5px] font-bold px-3.5 py-2 rounded-full font-mono">
            {identity.handle}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-slim px-4 pb-28 md:pb-6">
        <div className="flex gap-2 mb-6">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="@username собеседника"
            className="flex-1 min-w-0 bg-[#131c3d] border border-white/[.06] rounded-2xl px-4 py-3.5 text-[14.5px] placeholder:text-slate-500 transition-all"
          />
          <button onClick={add} className="grad-btn rounded-2xl px-5 font-bold text-[14.5px] flex items-center gap-1.5 shrink-0">
            <Plus size={18} /> {added ? 'Добавлено' : 'Добавить'}
          </button>
        </div>

        <p className="text-[11.5px] font-extrabold tracking-[.14em] text-slate-500 px-2 mb-2">ДОВЕРЕННЫЕ СОБЕСЕДНИКИ</p>
        <div className="space-y-2">
          {contacts.map(c => (
            <div key={c.id} className="card card-hover p-3.5 flex items-center gap-3.5">
              <div className="relative shrink-0">
                <div
                  className="w-[52px] h-[52px] rounded-full flex items-center justify-center font-extrabold text-[17px]"
                  style={{ background: `linear-gradient(135deg, ${c.avatarFrom}, ${c.avatarTo})` }}
                >
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
                {c.online && <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-400 border-[2.5px] border-[#131c3d]" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[16px] flex items-center gap-1.5">
                  {c.name}
                  {c.verified && <ShieldCheck size={17} className="text-sky-400" fill="rgba(56,189,248,.18)" />}
                </p>
                <p className="text-[13px] text-slate-400 truncate">{c.handle} · {c.status}</p>
              </div>
              <button
                onClick={() => onOpenChat(c.id === 'c1' ? 'mixik' : 'anna')}
                className="w-11 h-11 rounded-2xl bg-white/[.05] border border-white/[.07] flex items-center justify-center text-slate-300 hover:text-sky-300 transition-all shrink-0"
                title="Открыть чат"
              >
                <MessageSquare size={20} />
              </button>
            </div>
          ))}
        </div>

        <div className="card p-4 mt-6">
          <p className="font-bold text-[14.5px] flex items-center gap-2">🔒 Как работает добавление</p>
          <p className="text-[13px] text-slate-400 mt-1.5 leading-relaxed">
            Введи @username собеседника — MeshChat обменяет ключами X3DH и установит зашифрованный канал.
            Без сервера и телефона: только криптография.
          </p>
        </div>
      </div>
    </div>
  )
}
