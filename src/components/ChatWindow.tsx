import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Check, CheckCheck, ChevronDown, Lock, Mic, Paperclip, Phone, Play, Smile, Video,
} from 'lucide-react'
import type { Chat, Message, TransportId } from '../lib/types'
import { REPLIES, TRANSPORTS } from '../lib/transports'
import { Avatar } from './screens/ChatsScreen'

interface Props {
  chat: Chat
  onBack: () => void
  transport: TransportId
  setTransport: (t: TransportId) => void
  onCall: (kind: 'voice' | 'video') => void
  onSend: (chatId: string, msg: Message) => void
}

const EMOJIS = ['😀', '😂', '❤️', '🔥', '👍', '😍', '🎉', '😢', '🙏', '💯']

function nowTime() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatWindow({ chat, onBack, transport, setTransport, onCall, onSend }: Props) {
  const [text, setText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [showTransports, setShowTransports] = useState(false)
  const [typing, setTyping] = useState(false)
  const [recording, setRecording] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeTransport = TRANSPORTS.find(t => t.id === transport)!

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.messages, typing, chat.id])

  const send = () => {
    const t = text.trim()
    if (!t) return
    onSend(chat.id, { id: `m${Date.now()}`, text: t, time: nowTime(), mine: true, read: false })
    setText('')
    setShowEmoji(false)
    setTimeout(() => setTyping(true), 700)
    setTimeout(() => {
      setTyping(false)
      const reply = REPLIES[Math.floor(Math.random() * REPLIES.length)]
      onSend(chat.id, { id: `r${Date.now()}`, text: reply, time: nowTime(), mine: false, read: true })
    }, 2200)
  }

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* Header */}
      <div className="shrink-0 px-3 md:px-5 py-3 flex items-center gap-3 z-20 border-b border-white/[.05] bg-[#0a0f24]/85 backdrop-blur-xl pt-12 md:pt-3">
        <button onClick={onBack} className="md:hidden w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/[.06]">
          <ArrowLeft size={20} />
        </button>
        <Avatar chat={chat} size={42} />
        <div className="flex-1 min-w-0 cursor-pointer">
          <p className="font-bold text-[15.5px] truncate flex items-center gap-1.5">
            {chat.name}
            {chat.verified && <span className="text-sky-400 text-sm">✓</span>}
          </p>
          <p className="text-[12.5px] text-slate-400 truncate">
            {typing ? <span className="text-sky-400">печатает…</span> : chat.online ? 'в сети' : chat.lastSeen}
          </p>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowTransports(v => !v)}
            className="hidden sm:flex items-center gap-2 bg-white/[.05] hover:bg-white/[.09] border border-white/[.07] rounded-full pl-3 pr-2.5 py-1.5 transition-all"
          >
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-[12.5px] font-semibold">{activeTransport.icon} {activeTransport.name}</span>
            <ChevronDown size={14} className={`text-slate-400 transition-transform ${showTransports ? 'rotate-180' : ''}`} />
          </button>
          {showTransports && (
            <div className="absolute right-0 top-[calc(100%+8px)] w-[290px] glass-strong rounded-2xl p-2 shadow-2xl shadow-black/60 anim-pop z-50">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 pt-2 pb-1">Транспорт · демо</p>
              {TRANSPORTS.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setTransport(t.id); setShowTransports(false) }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${transport === t.id ? 'bg-sky-500/15' : 'hover:bg-white/[.05]'}`}
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
            </div>
          )}
        </div>

        <button onClick={() => onCall('voice')} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/[.06] text-slate-300 hover:text-white transition-all">
          <Phone size={20} />
        </button>
        <button onClick={() => onCall('video')} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/[.06] text-slate-300 hover:text-white transition-all">
          <Video size={21} />
        </button>
      </div>

      {/* Encryption banner */}
      <div className="shrink-0 px-4 py-2 flex justify-center z-10">
        <div className="flex items-center gap-2 bg-black/25 border border-white/[.06] rounded-full px-3.5 py-1.5">
          <Lock size={12} className="text-emerald-300" />
          <span className="text-[11.5px] text-slate-400">Сообщения зашифрованы end-to-end · Double Ratchet</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scroll-slim px-3 md:px-6 py-3 space-y-1">
        <div className="flex justify-center mb-4">
          <span className="text-[11px] font-semibold bg-white/[.06] text-slate-400 px-3 py-1 rounded-full">Сегодня</span>
        </div>
        {chat.messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.mine ? 'justify-end' : 'justify-start'} anim-msg`}>
            <div className={`max-w-[78%] md:max-w-[62%] px-4 py-2.5 ${msg.mine ? 'bubble-me' : 'bubble-them'}`}>
              {msg.type === 'voice' ? (
                <div className="flex items-center gap-3 min-w-[180px]">
                  <button className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                    <Play size={17} fill="white" />
                  </button>
                  <div className="flex items-center gap-[3px] h-8">
                    {[10, 18, 26, 14, 22, 30, 16, 24, 12, 20, 28, 15, 22, 11, 18].map((h, i) => (
                      <span key={i} className="w-[3px] rounded-full bg-white/70" style={{ height: h }} />
                    ))}
                  </div>
                  <span className="text-[12px] font-medium text-white/85">{msg.duration}</span>
                </div>
              ) : (
                <p className="text-[14.5px] leading-relaxed break-words">{msg.text}</p>
              )}
              <div className="flex items-center justify-end gap-1 mt-1">
                {msg.reactions && <span className="text-[12px] mr-1">{msg.reactions.join(' ')}</span>}
                <span className="text-[10.5px] text-white/55">{msg.time}</span>
                {msg.mine && (msg.read ? <CheckCheck size={14} className="text-cyan-200" /> : <Check size={14} className="text-white/60" />)}
              </div>
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start anim-fade-in">
            <div className="bubble-them px-4 py-3 flex gap-1.5">
              <span className="typing-dot w-2 h-2 rounded-full bg-white/60" />
              <span className="typing-dot w-2 h-2 rounded-full bg-white/60" />
              <span className="typing-dot w-2 h-2 rounded-full bg-white/60" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {showEmoji && (
        <div className="shrink-0 px-4 pb-2 anim-pop">
          <div className="glass-strong rounded-2xl p-3 flex flex-wrap gap-1 max-w-md">
            {EMOJIS.map(e => (
              <button key={e} onClick={() => setText(t => t + e)} className="text-2xl w-10 h-10 rounded-xl hover:bg-white/[.08] transition-all">{e}</button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 px-3 md:px-5 pb-3 md:pb-5 pt-1 z-20">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <div className="flex-1 glass-strong rounded-[26px] flex items-end px-2 py-1.5 gap-1">
            <button onClick={() => setShowEmoji(v => !v)} className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all ${showEmoji ? 'text-sky-300 bg-sky-500/15' : 'text-slate-400 hover:bg-white/[.06]'}`}>
              <Smile size={21} />
            </button>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Сообщение…"
              rows={1}
              className="flex-1 bg-transparent border-0 py-2.5 text-[15px] placeholder:text-slate-500 resize-none max-h-32"
              style={{ boxShadow: 'none' }}
            />
            <button className="w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:bg-white/[.06] shrink-0">
              <Paperclip size={20} />
            </button>
          </div>
          {text.trim() ? (
            <button onClick={send} className="w-12 h-12 rounded-full grad-btn flex items-center justify-center shrink-0 transition-all anim-pop">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          ) : (
            <button
              onMouseDown={() => setRecording(true)}
              onMouseUp={() => setRecording(false)}
              onTouchStart={() => setRecording(true)}
              onTouchEnd={() => setRecording(false)}
              className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 transition-all ${recording ? 'bg-rose-500 scale-110' : 'glass-strong text-slate-300'}`}
            >
              <Mic size={20} />
            </button>
          )}
        </div>
        {recording && <p className="text-center text-rose-300 text-xs font-semibold mt-2 anim-fade-in">● Идёт запись… отпусти, чтобы отправить</p>}
      </div>
    </div>
  )
}
