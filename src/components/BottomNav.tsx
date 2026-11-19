import { MessageCircle, Settings, User, Users } from 'lucide-react'
import Logo from './Logo'

export type Tab = 'chats' | 'contacts' | 'mesh' | 'profile' | 'settings'

const ITEMS: { id: Tab; label: string; icon?: any; logo?: boolean }[] = [
  { id: 'chats', label: 'Чаты', icon: MessageCircle },
  { id: 'contacts', label: 'Контакты', icon: Users },
  { id: 'mesh', label: 'Mesh', logo: true },
  { id: 'profile', label: 'Профиль', icon: User },
  { id: 'settings', label: 'Настройки', icon: Settings },
]

interface Props {
  tab: Tab
  setTab: (t: Tab) => void
}

export default function BottomNav({ tab, setTab }: Props) {
  return (
    <div className="md:hidden fixed bottom-0 inset-x-0 z-40 pb-safe">
      <div className="mx-2 mb-2 rounded-[26px] border border-white/[.07] bg-[#0d1430]/92 backdrop-blur-xl px-1 py-1.5 flex items-stretch justify-around shadow-2xl shadow-black/60">
        {ITEMS.map(({ id, label, icon: Icon, logo }) => {
          const active = tab === id
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-[20px] transition-all ${
                active ? 'bg-sky-500/15' : ''
              }`}
            >
              {logo ? (
                <span className={active ? '' : 'opacity-55'}>
                  <Logo size={26} />
                </span>
              ) : (
                <Icon size={23} className={active ? 'text-sky-400' : 'text-slate-400'} strokeWidth={active ? 2.4 : 2} />
              )}
              <span className={`text-[10.5px] font-bold ${active ? 'text-sky-400' : 'text-slate-400'}`}>{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function NavRail({ tab, setTab }: Props) {
  return (
    <div className="hidden md:flex w-[84px] shrink-0 flex-col items-center py-5 gap-1.5 border-r border-white/[.06] bg-[#0a0f24]/80">
      <Logo size={46} />
      <div className="h-4" />
      {ITEMS.map(({ id, label, icon: Icon, logo }) => {
        const active = tab === id
        return (
          <button
            key={id}
            onClick={() => setTab(id)}
            title={label}
            className={`w-[60px] py-2.5 rounded-2xl flex flex-col items-center gap-1 transition-all ${
              active ? 'bg-sky-500/15' : 'hover:bg-white/[.05]'
            }`}
          >
            {logo ? (
              <span className={active ? '' : 'opacity-55'}><Logo size={26} /></span>
            ) : (
              <Icon size={23} className={active ? 'text-sky-400' : 'text-slate-400'} strokeWidth={active ? 2.4 : 2} />
            )}
            <span className={`text-[10px] font-bold ${active ? 'text-sky-400' : 'text-slate-400'}`}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
