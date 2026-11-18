import { BadgeCheck, BellOff, Pin, Plus, Search } from 'lucide-react'
import type { Chat } from '../lib/types'
import { STORIES } from '../lib/data'

interface Props {
  chats: Chat[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
  query: string
  setQuery: (q: string) => void
}

export function Avatar({ chat, size = 52 }: { chat: Chat; size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="w-full h-full rounded-full flex items-center justify-center font-extrabold text-white"
        style={{ background: `linear-gradient(135deg, ${chat.avatarFrom}, ${chat.avatarTo})`, fontSize: size * 0.38 }}
      >
        {chat.name[0]}
      </div>
      {chat.online && (
        <span className="absolute bottom-0 right-0 w-[13px] h-[13px] rounded-full bg-emerald-400 border-[2.5px] border-[#0c0d14]" />
      )}
    </div>
  )
}

export default function ChatList({ chats, activeId, onSelect, onNewChat, query, setQuery }: Props) {
  const filtered = chats.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) || c.lastMessage.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[22px] font-extrabold tracking-tight">Чаты</h2>
          <button
            onClick={onNewChat}
            className="w-9 h-9 rounded-full grad-btn flex items-center justify-center transition-all"
            title="Новый чат"
          >
            <Plus size={19} />
          </button>
        </div>
        <div className="relative">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск"
            className="w-full bg-white/[.05] border border-white/[.07] rounded-2xl pl-10 pr-4 py-2.5 text-[14px] placeholder:text-white/30 transition-all"
          />
        </div>
      </div>

      {/* Stories */}
      <div className="flex gap-3.5 px-4 pb-3 overflow-x-auto scroll-slim shrink-0">
        {STORIES.map(s => (
          <button key={s.id} className="flex flex-col items-center gap-1.5 shrink-0 group">
            <div className={`rounded-full p-[2.5px] ${s.mine ? 'bg-white/15' : 'bg-gradient-to-tr from-violet-500 to-cyan-400'}`}>
              <div
                className="w-[52px] h-[52px] rounded-full flex items-center justify-center font-bold text-[15px] border-[3px] border-[#0c0d14]"
                style={{ background: `linear-gradient(135deg, ${s.from}, ${s.to})` }}
              >
                {s.mine ? '+' : s.name[0]}
              </div>
            </div>
            <span className="text-[11px] text-white/55 font-medium">{s.name}</span>
          </button>
        ))}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 px-4 pb-3 shrink-0">
        {['Все', 'Личные', 'Группы', 'Каналы'].map((c, i) => (
          <button
            key={c}
            className={`px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold transition-all ${
              i === 0 ? 'grad-btn' : 'bg-white/[.05] text-white/55 hover:bg-white/[.09]'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scroll-slim px-2 pb-24 md:pb-4">
        {filtered.map(chat => (
          <button
            key={chat.id}
            onClick={() => onSelect(chat.id)}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all mb-0.5 ${
              activeId === chat.id ? 'bg-white/[.07]' : 'hover:bg-white/[.04]'
            }`}
          >
            <Avatar chat={chat} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-bold text-[15px] truncate">{chat.name}</p>
                {chat.verified && <BadgeCheck size={16} className="text-cyan-400 shrink-0" />}
                {chat.pinned && <Pin size={13} className="text-white/35 shrink-0" />}
                {chat.muted && <BellOff size={13} className="text-white/35 shrink-0" />}
                <span className={`ml-auto text-[11.5px] shrink-0 font-medium ${chat.unread ? 'text-violet-300' : 'text-white/35'}`}>
                  {chat.lastTime}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <p className={`text-[13.5px] truncate flex-1 ${chat.unread ? 'text-white/85 font-medium' : 'text-white/45'}`}>
                  {chat.typing ? <span className="text-violet-300">печатает…</span> : chat.lastMessage}
                </p>
                {chat.unread > 0 && (
                  <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full grad-btn text-[11px] font-bold flex items-center justify-center">
                    {chat.unread}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-white/35 text-sm py-10">Ничего не найдено</p>
        )}
      </div>
    </div>
  )
}
