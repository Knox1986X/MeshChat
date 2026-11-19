import { useState } from 'react'
import { Bookmark, LayoutGrid, Pencil, Pin, Search, ShieldCheck, Snowflake } from 'lucide-react'
import type { Chat } from '../../lib/types'
import Logo from '../Logo'

interface Props {
  chats: Chat[]
  onSelect: (id: string) => void
  onNewChat: () => void
}

export function Avatar({ chat, size = 52 }: { chat: Chat; size?: number }) {
  if (chat.id === 'saved') {
    return (
      <div className="relative shrink-0 flex items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600" style={{ width: size, height: size }}>
        <Bookmark size={size * 0.42} className="text-white" fill="white" />
      </div>
    )
  }
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="w-full h-full rounded-full flex items-center justify-center font-extrabold text-white"
        style={{ background: `linear-gradient(135deg, ${chat.avatarFrom}, ${chat.avatarTo})`, fontSize: size * 0.36 }}
      >
        {chat.name.slice(0, 2).toUpperCase()}
      </div>
      {chat.online && (
        <span className="absolute bottom-0 right-0 w-[13px] h-[13px] rounded-full bg-emerald-400 border-[2.5px] border-[#0c1330]" />
      )}
    </div>
  )
}

const FILTERS = ['Все', 'Непрочитанные', 'Личные', 'Проверенные']

export default function ChatsScreen({ chats, onSelect, onNewChat }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState(0)
  const [showBanner, setShowBanner] = useState(true)

  const filtered = chats.filter(c => {
    const q = query.toLowerCase()
    const match = c.name.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q)
    if (!match) return false
    if (filter === 1) return c.unread > 0
    if (filter === 2) return !c.isGroup && !c.isChannel
    if (filter === 3) return !!c.verified
    return true
  })
  const pinned = filtered.filter(c => c.pinned)
  const rest = filtered.filter(c => !c.pinned)

  const row = (chat: Chat) => (
    <button
      key={chat.id}
      onClick={() => onSelect(chat.id)}
      className="w-full flex items-center gap-3.5 px-3 py-3 rounded-[20px] text-left transition-all hover:bg-white/[.045] active:scale-[.99]"
    >
      <Avatar chat={chat} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="font-bold text-[16px] truncate">{chat.name}</p>
          {chat.verified && <ShieldCheck size={17} className="text-sky-400 shrink-0" fill="rgba(56,189,248,.18)" />}
          {chat.pinned && <Pin size={13} className="text-slate-400 shrink-0" />}
          <span className={`ml-auto text-[12px] shrink-0 font-semibold ${chat.unread ? 'text-sky-400' : 'text-slate-500'}`}>
            {chat.lastTime}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className={`text-[13.5px] truncate flex-1 ${chat.unread ? 'text-slate-200 font-medium' : 'text-slate-400'}`}>
            {chat.typing ? <span className="text-sky-400">печатает…</span> : chat.lastMessage}
          </p>
          {chat.unread > 0 && (
            <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full grad-btn text-[11px] font-bold flex items-center justify-center">
              {chat.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  )

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-5 pt-14 pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-[30px] font-extrabold tracking-tight">Чаты</h1>
          <div className="flex items-center gap-2">
            <button className="w-10 h-10 rounded-2xl card flex items-center justify-center text-slate-300">
              <Bookmark size={18} />
            </button>
            <button className="w-10 h-10 rounded-2xl card flex items-center justify-center text-sky-300">
              <Snowflake size={18} />
            </button>
            <button className="w-10 h-10 rounded-2xl card flex items-center justify-center text-slate-300">
              <LayoutGrid size={18} />
            </button>
            <Logo size={38} />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/25 text-amber-300 text-[12px] font-bold px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 blink-dot" />
            восстановление канала…
          </span>
          <span className="bg-white/[.06] border border-white/[.07] text-slate-300 text-[12px] font-bold px-3 py-1.5 rounded-full">
            E2EE v2.1.0
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-slim px-4 pb-28 md:pb-6">
        {showBanner && (
          <div className="card p-4 mt-2 mb-4 anim-fade-up" style={{ background: 'linear-gradient(150deg, rgba(37,99,235,.28), rgba(99,102,241,.18))' }}>
            <p className="font-bold text-[15px]">На телефоне осталась старая копия v1.2</p>
            <p className="text-[13px] text-slate-300 mt-1 leading-relaxed">
              Удалите старый пакет в 1 нажатие — все будущие обновления теперь идут поверх текущей версии v2.1.0
            </p>
            <button
              onClick={() => setShowBanner(false)}
              className="w-full mt-3 grad-btn rounded-2xl py-3 font-bold text-[14.5px]"
            >
              Удалить старую копию v1.2
            </button>
          </div>
        )}

        {/* Search */}
        <div className="relative mt-1 mb-3">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск по чатам и контактам"
            className="w-full bg-[#131c3d] border border-white/[.06] rounded-2xl pl-11 pr-4 py-3 text-[14.5px] placeholder:text-slate-500 transition-all"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-4 overflow-x-auto scroll-slim pb-1">
          {FILTERS.map((f, i) => (
            <button
              key={f}
              onClick={() => setFilter(i)}
              className={`px-4 py-2 rounded-full text-[13px] font-bold whitespace-nowrap transition-all ${
                filter === i ? 'grad-btn' : 'bg-[#131c3d] border border-white/[.06] text-slate-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {pinned.length > 0 && (
          <>
            <p className="text-[11.5px] font-extrabold tracking-[.14em] text-slate-500 px-2 mb-1.5">ЗАКРЕПЛЁННЫЕ</p>
            <div className="space-y-0.5 mb-4">{pinned.map(row)}</div>
          </>
        )}
        <p className="text-[11.5px] font-extrabold tracking-[.14em] text-slate-500 px-2 mb-1.5">ВСЕ ЧАТЫ</p>
        <div className="space-y-0.5">{rest.map(row)}</div>
        {filtered.length === 0 && <p className="text-center text-slate-500 text-sm py-10">Ничего не найдено</p>}
      </div>

      {/* FAB */}
      <button
        onClick={onNewChat}
        className="absolute right-4 bottom-24 md:bottom-6 w-14 h-14 rounded-[20px] grad-btn flex items-center justify-center shadow-xl shadow-indigo-500/40 z-10"
        title="Новый чат"
      >
        <Pencil size={22} />
      </button>
    </div>
  )
}
