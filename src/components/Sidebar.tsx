import { Bell, MessageCircle, Phone, Settings, Users } from 'lucide-react'
import type { Identity } from '../lib/types'

export type NavTab = 'chats' | 'calls' | 'contacts' | 'settings'

interface Props {
  tab: NavTab
  setTab: (t: NavTab) => void
  identity: Identity
  onSettings: () => void
}

export default function Sidebar({ tab, setTab, identity, onSettings }: Props) {
  const items: { id: NavTab; icon: any; label: string }[] = [
    { id: 'chats', icon: MessageCircle, label: 'Чаты' },
    { id: 'calls', icon: Phone, label: 'Звонки' },
    { id: 'contacts', icon: Users, label: 'Контакты' },
  ]

  return (
    <>
      {/* Desktop rail */}
      <div className="hidden md:flex w-[76px] shrink-0 flex-col items-center py-4 gap-1 border-r border-white/[.06] bg-black/20">
        <div className="w-11 h-11 rounded-2xl grad-btn flex items-center justify-center mb-4 cursor-pointer">
          <img src="/favicon.svg" alt="" className="w-7 h-7" />
        </div>
        {items.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            title={label}
            className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${
              tab === id ? 'grad-btn text-white' : 'text-white/45 hover:bg-white/[.06] hover:text-white'
            }`}
          >
            <Icon size={21} />
          </button>
        ))}
        <div className="flex-1" />
        <button className="w-11 h-11 rounded-2xl flex items-center justify-center text-white/45 hover:bg-white/[.06] hover:text-white transition-all relative">
          <Bell size={21} />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-rose-500" />
        </button>
        <button
          onClick={onSettings}
          className="w-11 h-11 rounded-2xl flex items-center justify-center text-white/45 hover:bg-white/[.06] hover:text-white transition-all"
        >
          <Settings size={21} />
        </button>
        <div className="w-10 h-10 rounded-full grad-btn flex items-center justify-center font-extrabold text-sm mt-2 cursor-pointer" title={identity.handle}>
          {identity.username[0].toUpperCase()}
        </div>
      </div>

      {/* Mobile bottom nav */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 pb-safe">
        <div className="mx-3 mb-3 glass-strong rounded-[24px] px-2 py-2 flex items-center justify-around shadow-2xl shadow-black/50">
          {items.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-2xl transition-all ${
                tab === id ? 'text-violet-300' : 'text-white/40'
              }`}
            >
              <Icon size={22} />
              <span className="text-[10px] font-semibold">{label}</span>
            </button>
          ))}
          <button onClick={onSettings} className="flex flex-col items-center gap-0.5 px-4 py-1.5 text-white/40">
            <Settings size={22} />
            <span className="text-[10px] font-semibold">Ещё</span>
          </button>
        </div>
      </div>
    </>
  )
}
