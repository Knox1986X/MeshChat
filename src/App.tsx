import { useEffect, useState } from 'react'
import { CloudOff, Sparkles } from 'lucide-react'
import Onboarding from './components/Onboarding'
import Sidebar, { type NavTab } from './components/Sidebar'
import ChatList from './components/ChatList'
import ChatWindow from './components/ChatWindow'
import CallModal from './components/CallModal'
import SettingsModal from './components/SettingsModal'
import NewChatModal from './components/NewChatModal'
import { INITIAL_CHATS } from './lib/data'
import { loadIdentity } from './lib/identity'
import type { Chat, Identity, Message, TransportId } from './lib/types'

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity())
  const [chats, setChats] = useState<Chat[]>(INITIAL_CHATS)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [tab, setTab] = useState<NavTab>('chats')
  const [query, setQuery] = useState('')
  const [transport, setTransport] = useState<TransportId>('cloudflare')
  const [showSettings, setShowSettings] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [call, setCall] = useState<{ kind: 'voice' | 'video' } | null>(null)
  const [showDemoBanner, setShowDemoBanner] = useState(true)

  const activeChat = chats.find(c => c.id === activeId) ?? null

  useEffect(() => {
    if (activeId) {
      setChats(prev => prev.map(c => c.id === activeId ? { ...c, unread: 0 } : c))
    }
  }, [activeId])

  const handleSend = (chatId: string, msg: Message) => {
    setChats(prev => prev.map(c => {
      if (c.id !== chatId) return c
      const updated = { ...c, messages: [...c.messages, msg], lastMessage: msg.mine ? msg.text : msg.text, lastTime: msg.time, lastMine: msg.mine }
      return updated
    }))
  }

  if (!identity) {
    return <Onboarding onDone={setIdentity} />
  }

  return (
    <div className="mesh-bg h-full w-full flex overflow-hidden">
      <Sidebar tab={tab} setTab={setTab} identity={identity} onSettings={() => setShowSettings(true)} />

      {/* Chat list */}
      <div className={`w-full md:w-[360px] lg:w-[380px] shrink-0 border-r border-white/[.06] bg-black/25 flex-col min-h-0 ${activeId ? 'hidden md:flex' : 'flex'}`}>
        {showDemoBanner && (
          <div className="mx-3 mt-3 flex items-start gap-2.5 bg-amber-400/10 border border-amber-400/20 rounded-2xl px-3.5 py-2.5 anim-fade-in">
            <CloudOff size={16} className="text-amber-300 shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-200/80 leading-snug flex-1">
              <b>Демо-режим:</b> ключи Cloudflare/Fly.io не подключены, всё работает локально.
            </p>
            <button onClick={() => setShowDemoBanner(false)} className="text-amber-200/50 hover:text-amber-200 text-lg leading-none">×</button>
          </div>
        )}
        <ChatList
          chats={chats}
          activeId={activeId}
          onSelect={setActiveId}
          onNewChat={() => setShowNewChat(true)}
          query={query}
          setQuery={setQuery}
        />
      </div>

      {/* Chat window / empty state */}
      <div className={`flex-1 min-w-0 flex-col min-h-0 ${activeId ? 'flex' : 'hidden md:flex'}`}>
        {activeChat ? (
          <ChatWindow
            chat={activeChat}
            onBack={() => setActiveId(null)}
            transport={transport}
            setTransport={setTransport}
            onCall={kind => setCall({ kind })}
            onSend={handleSend}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 rounded-full bg-violet-500/30 blur-3xl" />
              <div className="relative w-24 h-24 rounded-[28px] grad-btn flex items-center justify-center anim-floaty">
                <img src="/favicon.svg" alt="" className="w-14 h-14" />
              </div>
            </div>
            <h2 className="text-2xl font-extrabold">Выбери чат</h2>
            <p className="text-white/45 mt-2 max-w-xs text-[14.5px] leading-relaxed">
              Анонимно, зашифровано, без VPN. Нажми на чат слева, чтобы начать общение.
            </p>
            <div className="flex gap-2 mt-6">
              {['🔒 E2E', '⚡ Быстро', '🆓 Бесплатно', '📡 Mesh'].map(b => (
                <span key={b} className="glass rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-white/70">{b}</span>
              ))}
            </div>
            <button onClick={() => setShowNewChat(true)} className="mt-8 grad-btn rounded-2xl px-6 py-3 font-bold text-[14.5px] flex items-center gap-2">
              <Sparkles size={17} /> Создать новый чат
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {call && activeChat && <CallModal chat={activeChat} kind={call.kind} onClose={() => setCall(null)} />}
      {showSettings && (
        <SettingsModal
          identity={identity}
          transport={transport}
          setTransport={setTransport}
          onClose={() => setShowSettings(false)}
          onLogout={() => { setIdentity(null); setShowSettings(false); setActiveId(null) }}
        />
      )}
      {showNewChat && <NewChatModal identity={identity} onClose={() => setShowNewChat(false)} />}
    </div>
  )
}
