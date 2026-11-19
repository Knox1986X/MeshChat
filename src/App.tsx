import { useEffect, useState } from 'react'
import Onboarding from './components/Onboarding'
import Garland from './components/Garland'
import Snowfall from './components/Snowfall'
import BottomNav, { NavRail, type Tab } from './components/BottomNav'
import ChatsScreen from './components/screens/ChatsScreen'
import ContactsScreen from './components/screens/ContactsScreen'
import MeshScreen from './components/screens/MeshScreen'
import ProfileScreen from './components/screens/ProfileScreen'
import SettingsScreen from './components/screens/SettingsScreen'
import ChatWindow from './components/ChatWindow'
import CallModal from './components/CallModal'
import NewChatModal from './components/NewChatModal'
import Logo from './components/Logo'
import { INITIAL_CHATS } from './lib/data'
import { clearIdentity, loadIdentity } from './lib/identity'
import type { Chat, Identity, Message, TransportId } from './lib/types'

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity())
  const [chats, setChats] = useState<Chat[]>(INITIAL_CHATS)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('chats')
  const [transport, setTransport] = useState<TransportId>('cloudflare')
  const [showNewChat, setShowNewChat] = useState(false)
  const [call, setCall] = useState<{ kind: 'voice' | 'video' } | null>(null)

  const activeChat = chats.find(c => c.id === activeId) ?? null

  useEffect(() => {
    if (activeId) {
      setChats(prev => prev.map(c => c.id === activeId ? { ...c, unread: 0 } : c))
    }
  }, [activeId])

  const handleSend = (chatId: string, msg: Message) => {
    setChats(prev => prev.map(c => {
      if (c.id !== chatId) return c
      return { ...c, messages: [...c.messages, msg], lastMessage: msg.text, lastTime: msg.time, lastMine: msg.mine }
    }))
  }

  const openChat = (id: string) => {
    // contacts map to demo chats
    const map: Record<string, string> = { c1: 'mixik', c2: 'anna', c3: 'max' }
    setActiveId(map[id] ?? id)
    setTab('chats')
  }

  if (!identity) {
    return (
      <div className="navy-bg h-full w-full relative">
        <Garland />
        <Snowfall count={26} />
        <Onboarding onDone={setIdentity} />
      </div>
    )
  }

  return (
    <div className="navy-bg h-full w-full flex overflow-hidden relative">
      <Garland />
      <Snowfall />
      <NavRail tab={tab} setTab={setTab} />

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0 relative z-10">
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
          <div className="flex-1 min-h-0">
            {tab === 'chats' && (
              <ChatsScreen chats={chats} onSelect={setActiveId} onNewChat={() => setShowNewChat(true)} />
            )}
            {tab === 'contacts' && <ContactsScreen identity={identity} onOpenChat={openChat} />}
            {tab === 'mesh' && <MeshScreen />}
            {tab === 'profile' && (
              <ProfileScreen
                identity={identity}
                onLogout={() => { clearIdentity(); setIdentity(null); setActiveId(null) }}
              />
            )}
            {tab === 'settings' && <SettingsScreen />}
          </div>
        )}
      </div>

      {/* Desktop empty-state hint when chat open on wide screens is handled by ChatWindow itself */}

      <BottomNav tab={tab} setTab={setTab} />

      {call && activeChat && <CallModal chat={activeChat} kind={call.kind} onClose={() => setCall(null)} />}
      {showNewChat && <NewChatModal identity={identity} onClose={() => setShowNewChat(false)} />}

      {/* Desktop logo watermark */}
      <div className="hidden lg:block fixed bottom-5 right-5 z-0 opacity-[.07] pointer-events-none">
        <Logo size={180} />
      </div>
    </div>
  )
}
