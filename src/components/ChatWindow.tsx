import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDown, ArrowLeft, ChevronDown, Copy, CornerUpLeft, Forward, Info, Lock, Mic, Paperclip,
  Phone, Smile, Sparkles, Trash2, Video, X,
} from 'lucide-react'
import type { Chat, Message, TransportId } from '../lib/types'
import { REPLIES, TRANSPORTS } from '../lib/transports'
import { Avatar } from './screens/ChatsScreen'
import MessageBubble from './MessageBubble'
import { botReply, makeTicket, SUPPORT_CHIPS } from '../lib/supportBot'

interface Props {
  chat: Chat
  username: string
  onBack: () => void
  transport: TransportId
  setTransport: (t: TransportId) => void
  onCall: (kind: 'voice' | 'video') => void
  onSend: (chatId: string, msg: Message) => void
  onUpdate: (chatId: string, msgId: string, patch: Partial<Message>) => void
  onDelete: (chatId: string, msgId: string) => void
}

const EMOJIS = ['😀', '😂', '❤️', '🔥', '👍', '😍', '🎉', '😢', '🙏', '💯', '🤝', '😎']

function nowTime() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatWindow({ chat, username, onBack, transport, setTransport, onCall, onSend, onUpdate, onDelete }: Props) {
  const [text, setText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [showTransports, setShowTransports] = useState(false)
  const [typing, setTyping] = useState(false)
  const [recording, setRecording] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [menuMsg, setMenuMsg] = useState<Message | null>(null)
  const [chips, setChips] = useState<string[]>(chat.isBot ? SUPPORT_CHIPS : [])
  const [showJump, setShowJump] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const timers = useRef<number[]>([])
  const activeTransport = TRANSPORTS.find(t => t.id === transport)!
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])

  const notif = useCallback((m: string) => {
    setToast(m)
    window.setTimeout(() => setToast(null), 1800)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
  }, [chat.messages.length, typing, chat.id, reduced])

  useEffect(() => {
    return () => timers.current.forEach(t => window.clearTimeout(t))
  }, [])

  useEffect(() => {
    setReplyTo(null)
    setChips(chat.isBot ? SUPPORT_CHIPS : [])
  }, [chat.id, chat.isBot])

  const push = (msg: Message) => onSend(chat.id, msg)

  const sendText = (raw?: string) => {
    const t = (raw ?? text).trim()
    if (!t) return

    push({
      id: `m${Date.now()}`,
      text: t,
      time: nowTime(),
      mine: true,
      read: false,
      replyTo: replyTo ? { id: replyTo.id, name: replyTo.mine ? 'Вы' : chat.name, text: replyTo.text, mine: replyTo.mine } : undefined,
    })

    setText('')
    setReplyTo(null)
    setShowEmoji(false)
    setChips([])

    if (chat.isBot) {
      const answer = botReply(t, {
        username: username || 'друг',
        handle: chat.handle,
        messageCount: chat.messages.length,
      })
      timers.current.push(window.setTimeout(() => setTyping(true), 260))
      timers.current.push(window.setTimeout(() => {
        setTyping(false)
        push({
          id: `b${Date.now()}`,
          text: answer.text,
          time: nowTime(),
          mine: false,
          read: true,
          bot: true,
        })
        if (answer.ticket) {
          const ticket = answer.ticket.id ? answer.ticket : makeTicket()
          timers.current.push(window.setTimeout(() => {
            push({
              id: `tk${Date.now()}`,
              text: `Тикет ${ticket.id} · приоритет обычный · ответ ${ticket.eta}`,
              time: nowTime(),
              mine: false,
              read: true,
              type: 'system',
            })
          }, 520))
        }
        setChips(answer.chips ?? SUPPORT_CHIPS)
      }, answer.delay ?? 1200))
      return
    }

    // демо-собеседник
    timers.current.push(window.setTimeout(() => setTyping(true), 700))
    timers.current.push(window.setTimeout(() => {
      setTyping(false)
      push({
        id: `r${Date.now()}`,
        text: REPLIES[Math.floor(Math.random() * REPLIES.length)],
        time: nowTime(),
        mine: false,
        read: true,
      })
    }, 2200))
  }

  const handleReply = (msg: Message) => {
    setReplyTo(msg)
    navigator.vibrate?.(8)
    inputRef.current?.focus()
  }

  const handleReact = (msg: Message, emoji: string) => {
    const cur = msg.reactions ?? []
    const has = cur.includes(emoji)
    onUpdate(chat.id, msg.id, { reactions: has ? cur.filter(e => e !== emoji) : [...cur, emoji] })
  }

  const copy = async (msg: Message) => {
    try {
      await navigator.clipboard.writeText(msg.text)
      notif('Скопировано')
    } catch {
      notif('Не удалось скопировать')
    }
    setMenuMsg(null)
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const far = el.scrollHeight - el.scrollTop - el.clientHeight > 320
    setShowJump(far)
  }

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* ───────────── Header ───────────── */}
      <div className="shrink-0 px-3 md:px-5 py-2.5 flex items-center gap-2.5 z-20 border-b border-white/[.05] bg-[#0a0f24]/85 backdrop-blur-xl pt-11 md:pt-2.5">
        <button onClick={onBack} className="md:hidden w-9 h-9 -ml-1 rounded-full flex items-center justify-center hover:bg-white/[.06] active:scale-90 transition-transform">
          <ArrowLeft size={20} />
        </button>
        <button className="relative shrink-0 active:scale-95 transition-transform">
          <Avatar chat={chat} size={40} />
          {chat.online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0a0f24] blink-dot" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[15px] truncate flex items-center gap-1.5">
            {chat.name}
            {chat.isBot && <Sparkles size={13} className="text-sky-400" />}
            {chat.verified && !chat.isBot && <span className="text-sky-400 text-sm">✓</span>}
          </p>
          <p className="text-[12px] text-slate-400 truncate">
            {typing
              ? <span className="text-sky-400">печатает…</span>
              : chat.isBot
                ? <span className="text-emerald-300">бот · отвечает мгновенно</span>
                : chat.online ? 'в сети' : chat.lastSeen}
          </p>
        </div>

        {/* Транспорт */}
        <div className="relative">
          <button
            onClick={() => setShowTransports(v => !v)}
            className="hidden sm:flex items-center gap-1.5 bg-white/[.05] hover:bg-white/[.09] border border-white/[.07] rounded-full pl-2.5 pr-2 py-1.5 transition-all active:scale-95"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${activeTransport.status === 'online' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className="text-[12px] font-semibold">{activeTransport.icon} {activeTransport.name}</span>
            <ChevronDown size={13} className={`text-slate-400 transition-transform ${showTransports ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {showTransports && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.16 }}
                className="absolute right-0 top-[calc(100%+8px)] w-[290px] glass-strong rounded-2xl p-2 shadow-2xl shadow-black/60 z-50"
              >
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 pt-2 pb-1">Транспорт · демо</p>
                {TRANSPORTS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setTransport(t.id); setShowTransports(false) }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${transport === t.id ? 'bg-sky-500/15' : 'hover:bg-white/[.05]'}`}
                  >
                    <span className="text-lg">{t.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] font-semibold">{t.name}</span>
                      <span className="block text-[11.5px] text-slate-400">{t.desc}</span>
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.status === 'online' ? 'bg-emerald-400/15 text-emerald-300' : t.status === 'demo' ? 'bg-amber-400/15 text-amber-300' : 'bg-white/10 text-slate-400'}`}>
                      {t.status === 'online' ? 'ONLINE' : t.status === 'demo' ? 'ДЕМО' : 'OFF'}
                    </span>
                  </button>
                ))}
                <p className="text-[11px] text-slate-500 px-3 py-2">Ключи Cloudflare/Fly.io не подключены — работает заглушка</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {!chat.isBot && (
          <>
            <button onClick={() => onCall('voice')} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/[.06] text-slate-300 hover:text-white transition-all active:scale-90">
              <Phone size={19} />
            </button>
            <button onClick={() => onCall('video')} className="w-9 h-9 rounded-full hidden sm:flex items-center justify-center hover:bg-white/[.06] text-slate-300 hover:text-white transition-all active:scale-90">
              <Video size={20} />
            </button>
          </>
        )}
        {chat.isBot && (
          <button
            onClick={() => notif('Все ответы — локальная база знаний, без сервера')}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/[.06] text-slate-300 active:scale-90 transition-transform"
          >
            <Info size={19} />
          </button>
        )}
      </div>

      {/* ───────────── E2EE banner ───────────── */}
      <div className="shrink-0 px-4 py-1.5 flex justify-center z-10">
        <div className="flex items-center gap-1.5 bg-black/25 border border-white/[.06] rounded-full px-3 py-1">
          <Lock size={11} className="text-emerald-300" />
          <span className="text-[11px] text-slate-400">
            {chat.isBot ? 'Локальный бот · работает офлайн' : 'Зашифровано end-to-end · Double Ratchet'}
          </span>
        </div>
      </div>

      {/* ───────────── Messages ───────────── */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto scroll-slim px-3 md:px-6 py-2 relative"
      >
        <div className="flex justify-center mb-3">
          <span className="text-[11px] font-semibold bg-white/[.06] text-slate-400 px-3 py-1 rounded-full">Сегодня</span>
        </div>

        {chat.messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            index={i}
            reduced={reduced}
            onReply={handleReply}
            onMenu={setMenuMsg}
            onReact={handleReact}
          />
        ))}

        <AnimatePresence>
          {typing && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex justify-start"
            >
              <div className="bubble-them px-4 py-3 flex gap-1.5 items-center">
                <span className="typing-dot w-2 h-2 rounded-full bg-white/60" />
                <span className="typing-dot w-2 h-2 rounded-full bg-white/60" />
                <span className="typing-dot w-2 h-2 rounded-full bg-white/60" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={bottomRef} className="h-2" />
      </div>

      {/* Jump to bottom */}
      <AnimatePresence>
        {showJump && (
          <motion.button
            initial={{ opacity: 0, scale: 0.7, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.7, y: 8 }}
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="absolute bottom-28 right-5 z-20 w-10 h-10 rounded-full glass-strong flex items-center justify-center shadow-lg active:scale-90"
          >
            <ArrowDown size={18} className="text-sky-300" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute left-1/2 -translate-x-1/2 bottom-32 z-30 bg-[#101a3a] border border-white/10 text-[12.5px] font-semibold px-4 py-2 rounded-full shadow-xl"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Быстрые подсказки бота */}
      <AnimatePresence>
        {!!chips.length && !typing && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="shrink-0 px-3 md:px-5 pb-1 flex gap-2 overflow-x-auto scroll-slim"
          >
            {chips.map(c => (
              <button
                key={c}
                onClick={() => sendText(c)}
                className="shrink-0 text-[12.5px] font-semibold px-3.5 py-2 rounded-full bg-sky-500/[.13] border border-sky-400/25 text-sky-200 hover:bg-sky-500/20 active:scale-95 transition-all"
              >
                {c}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Emoji */}
      <AnimatePresence>
        {showEmoji && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="shrink-0 px-4 overflow-hidden"
          >
            <div className="glass-strong rounded-2xl p-2.5 flex flex-wrap gap-1 max-w-md mb-1.5">
              {EMOJIS.map((e, i) => (
                <motion.button
                  key={e}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.02 }}
                  whileTap={{ scale: 0.85 }}
                  onClick={() => setText(t => t + e)}
                  className="text-2xl w-10 h-10 rounded-xl hover:bg-white/[.08] transition-colors"
                >
                  {e}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───────────── Reply bar ───────────── */}
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ opacity: 0, y: 12, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 8, height: 0 }}
            className="shrink-0 px-3 md:px-5 overflow-hidden"
          >
            <div className="flex items-center gap-2.5 bg-sky-500/[.10] border border-sky-400/25 rounded-2xl px-3 py-2 mb-1.5 max-w-4xl mx-auto">
              <CornerUpLeft size={16} className="text-sky-300 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11.5px] font-bold text-sky-300">{replyTo.mine ? 'Вы' : chat.name}</p>
                <p className="text-[12.5px] text-slate-300 truncate">{replyTo.text}</p>
              </div>
              <button onClick={() => setReplyTo(null)} className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center shrink-0">
                <X size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ───────────── Input ───────────── */}
      <div className="shrink-0 px-3 md:px-5 pb-3 md:pb-4 pt-1 z-20">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <div className="flex-1 glass-strong rounded-[26px] flex items-end px-1.5 py-1.5 gap-1">
            <button
              onClick={() => setShowEmoji(v => !v)}
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90 ${showEmoji ? 'text-sky-300 bg-sky-500/15' : 'text-slate-400 hover:bg-white/[.06]'}`}
            >
              <Smile size={21} />
            </button>
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText() } }}
              placeholder={chat.isBot ? 'Спроси что угодно…' : 'Сообщение…'}
              rows={1}
              className="flex-1 bg-transparent border-0 py-2.5 text-[15px] placeholder:text-slate-500 resize-none max-h-32"
              style={{ boxShadow: 'none' }}
            />
            <button className="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:bg-white/[.06] shrink-0 active:scale-90 transition-transform">
              <Paperclip size={20} />
            </button>
          </div>

          <AnimatePresence mode="popLayout" initial={false}>
            {text.trim() ? (
              <motion.button
                key="send"
                initial={{ scale: 0.6, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.6, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                onClick={() => sendText()}
                className="w-12 h-12 rounded-full grad-btn flex items-center justify-center shrink-0"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </motion.button>
            ) : (
              <motion.button
                key="mic"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                onMouseDown={() => setRecording(true)}
                onMouseUp={() => setRecording(false)}
                onTouchStart={() => setRecording(true)}
                onTouchEnd={() => setRecording(false)}
                className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 transition-colors ${recording ? 'bg-rose-500 scale-110' : 'glass-strong text-slate-300'}`}
              >
                <Mic size={20} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        {recording && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-rose-300 text-xs font-semibold mt-2">
            ● Идёт запись… отпусти, чтобы отправить
          </motion.p>
        )}
        {!chat.isBot && (
          <p className="hidden md:block text-center text-[10.5px] text-slate-600 mt-1.5">
            Свайп влево по сообщению — ответ · долгое нажатие — меню · двойной тап — ❤️
          </p>
        )}
      </div>

      {/* ───────────── Context menu (bottom sheet) ───────────── */}
      <AnimatePresence>
        {menuMsg && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMenuMsg(null)}
              className="absolute inset-0 bg-black/55 backdrop-blur-[2px] z-40"
            />
            <motion.div
              initial={{ y: 320, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 320, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className="absolute bottom-0 left-0 right-0 z-50 bg-[#0e1631] border-t border-white/10 rounded-t-[26px] px-4 pt-2.5 pb-6 max-w-2xl mx-auto"
            >
              <div className="w-9 h-1 rounded-full bg-white/20 mx-auto mb-3" />
              <p className="text-[12px] text-slate-400 mb-2 truncate px-1">{menuMsg.text}</p>

              <div className="flex gap-2 mb-3">
                {['❤️', '🔥', '👍', '😂', '😮', '🙏'].map(e => (
                  <motion.button
                    key={e}
                    whileTap={{ scale: 1.3 }}
                    onClick={() => { handleReact(menuMsg, e); setMenuMsg(null) }}
                    className={`flex-1 h-11 rounded-xl text-xl transition-colors ${menuMsg.reactions?.includes(e) ? 'bg-sky-500/20' : 'bg-white/[.06]'}`}
                  >
                    {e}
                  </motion.button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-1">
                {[
                  { icon: CornerUpLeft, label: 'Ответить', run: () => { handleReply(menuMsg); setMenuMsg(null) } },
                  { icon: Copy, label: 'Копировать текст', run: () => copy(menuMsg) },
                  { icon: Forward, label: 'Переслать', run: () => { notif('Пересылка появится с транспортами'); setMenuMsg(null) } },
                  ...(menuMsg.mine ? [{ icon: Trash2, label: 'Удалить у себя', run: () => { onDelete(chat.id, menuMsg.id); setMenuMsg(null) } }] : []),
                ].map(({ icon: Icon, label, run }) => (
                  <button
                    key={label}
                    onClick={run}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/[.06] active:bg-white/[.1] transition-colors text-left"
                  >
                    <Icon size={18} className="text-slate-400" />
                    <span className="text-[14px] font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
