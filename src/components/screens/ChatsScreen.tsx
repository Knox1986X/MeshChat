import { useState } from 'react'
import { motion } from 'framer-motion'
import { Bookmark, LayoutGrid, Pencil, Pin, Search, ShieldCheck, Snowflake, Sparkles } from 'lucide-react'
import type { Chat, ChatRequest } from '../../lib/types'
import { CHAT_REQUESTS } from '../../lib/data'
import { Check, X } from 'lucide-react'
import Logo from '../Logo'

interface Props {
  chats: Chat[]
  onSelect: (id: string) => void
  onNewChat: () => void
  onAcceptRequest: (r: ChatRequest) => void
}

export function Avatar({ chat, size = 52 }: { chat: Chat; size?: number }) {
  if (chat.id === 'saved') {
    return (
      <div className="relative shrink-0 flex items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600" style={{ width: size, height: size }}>
        <Bookmark size={size * 0.42} className="text-white" fill="white" />
      </div>
    )
  }
  if (chat.isBot) {
    return (
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <div className="w-full h-full rounded-full flex items-center justify-center bg-gradient-to-br from-cyan-400 to-indigo-600 shadow-[0_0_22px_-4px_rgba(34,211,238,.7)]">
          <Sparkles size={size * 0.44} className="text-white" />
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 w-[14px] h-[14px] rounded-full bg-emerald-400 border-2 border-[#0c1330] blink-dot" />
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

export default function ChatsScreen({ chats, onSelect, onNewChat, onAcceptRequest }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState(0)
  const [showBanner, setShowBanner] = useState(true)
  const [requests, setRequests] = useState<ChatRequest[]>(CHAT_REQUESTS)

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

  const row = (chat: Chat, i: number) => (
    <motion.button
      key={chat.id}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i * 0.025, 0.2), type: 'spring', stiffness: 420, damping: 34 }}
      whileTap={{ scale: 0.985 }}
      onClick={() => onSelect(chat.id)}
      className="w-full flex items-center gap-3.5 px-3 py-3 rounded-[20px] text-left transition-colors hover:bg-white/[.045]"
    >
      <Avatar chat={chat} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="font-bold text-[16px] truncate">{chat.name}</p>
          {chat.isBot && <span className="text-[9.5px] font-black tracking-wider px-1.5 py-0.5 rounded-md bg-cyan-400/15 text-cyan-300 shrink-0">БОТ</span>}
          {chat.verified && !chat.isBot && <ShieldCheck size={17} className="text-sky-400 shrink-0" fill="rgba(56,189,248,.18)" />}
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
    </motion.button>
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
            E2EE v2.4.0
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-slim px-4 pb-28 md:pb-6">
        {showBanner && (
          <div className="card p-4 mt-2 mb-4 anim-fade-up" style={{ background: 'linear-gradient(150deg, rgba(37,99,235,.28), rgba(99,102,241,.18))' }}>
            <p className="font-bold text-[15px]">На телефоне осталась старая копия v1.2</p>
            <p className="text-[13px] text-slate-300 mt-1 leading-relaxed">
              Удалите старый пакет в 1 нажатие — все будущие обновления теперь идут поверх текущей версии v2.4.0
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

        {requests.length > 0 && !query && (
          <div className="mb-4">
            <p className="text-[11.5px] font-extrabold tracking-[.14em] text-slate-500 px-2 mb-1.5">
              ЗАПРОСЫ НА ПЕРЕПИСКУ · {requests.length}
            </p>
            <div className="space-y-2">
              {requests.map(r => (
                <motion.div
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="card p-3.5"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center font-extrabold text-white text-[14px] shrink-0"
                      style={{ background: `linear-gradient(135deg, ${r.avatarFrom}, ${r.avatarTo})` }}
                    >
                      {r.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[14px] truncate">{r.name} <span className="text-slate-500 font-medium text-[12px]">{r.handle}</span></p>
                      <p className="text-[12.5px] text-slate-400 truncate">{r.text}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2.5">
                    <button
                      onClick={() => { onAcceptRequest(r); setRequests(prev => prev.filter(x => x.id !== r.id)) }}
                      className="flex-1 grad-btn rounded-xl py-2 text-[12.5px] font-bold flex items-center justify-center gap-1.5"
                    >
                      <Check size={14} /> Принять
                    </button>
                    <button
                      onClick={() => setRequests(prev => prev.filter(x => x.id !== r.id))}
                      className="px-4 rounded-xl bg-white/[.06] border border-white/[.07] text-[12.5px] font-bold text-slate-300 flex items-center gap-1.5"
                    >
                      <X size={14} /> Отклонить
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {pinned.length > 0 && (
          <>
            <p className="text-[11.5px] font-extrabold tracking-[.14em] text-slate-500 px-2 mb-1.5">ЗАКРЕПЛЁННЫЕ</p>
            <div className="space-y-0.5 mb-4">{pinned.map((c, i) => row(c, i))}</div>
          </>
        )}
        <p className="text-[11.5px] font-extrabold tracking-[.14em] text-slate-500 px-2 mb-1.5">ВСЕ ЧАТЫ</p>
        <div className="space-y-0.5">{rest.map((c, i) => row(c, pinned.length + i))}</div>
        {filtered.length === 0 && <p className="text-center text-slate-500 text-sm py-10">Ничего не найдено</p>}
      </div>

      {/* FAB */}
      <motion.button
        initial={{ scale: 0, rotate: -35 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 22, delay: 0.18 }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.92 }}
        onClick={onNewChat}
        className="absolute right-4 bottom-24 md:bottom-6 w-14 h-14 rounded-[20px] grad-btn flex items-center justify-center shadow-xl shadow-indigo-500/40 z-10"
        title="Новый чат"
      >
        <Pencil size={22} />
      </motion.button>
    </div>
  )
}
