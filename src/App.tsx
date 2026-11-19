import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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

const TAB_ORDER: Tab[] = ['chats', 'contacts', 'mesh', 'profile', 'settings']

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity())
  const [chats, setChats] = useState<Chat[]>(INITIAL_CHATS)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [tab, setTabState] = useState<Tab>('chats')
  const [direction, setDirection] = useState(1)
  const [transport, setTransport] = useState<TransportId>('cloudflare')
  const [showNewChat, setShowNewChat] = useState(false)
  const [call, setCall] = useState<{ kind: 'voice' | 'video' } | null>(null)

  const activeChat = chats.find(c => c.id === activeId) ?? null

  useEffect(() => {
    if (activeId) setChats(prev => prev.map(c => c.id === activeId ? { ...c, unread: 0 } : c))
  }, [activeId])

  // Сброс к списку при смене вкладки
  const setTab = (next: Tab) => {
    setDirection(TAB_ORDER.indexOf(next) >= TAB_ORDER.indexOf(tab) ? 1 : -1)
    setActiveId(null)
    setTabState(next)
  }

  const handleSend = (chatId: string, msg: Message) => {
    setChats(prev => prev.map(c => {
      if (c.id !== chatId) return c
      return { ...c, messages: [...c.messages, msg], lastMessage: msg.text, lastTime: msg.time, lastMine: msg.mine }
    }))
  }

  const handleUpdate = (chatId: string, msgId: string, patch: Partial<Message>) => {
    setChats(prev => prev.map(c => c.id === chatId
      ? { ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, ...patch } : m) }
      : c))
  }

  const handleDelete = (chatId: string, msgId: string) => {
    setChats(prev => prev.map(c => c.id === chatId
      ? { ...c, messages: c.messages.filter(m => m.id !== msgId) }
      : c))
  }

  const openChat = (id: string) => {
    // контакты сопоставлены с демо-чатами
    const map: Record<string, string> = { c1: 'mixik', c2: 'anna', c3: 'max' }
    setActiveId(map[id] ?? id)
    setTabState('chats')
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

      <div className="flex-1 min-w-0 flex flex-col min-h-0 relative z-10">
        <AnimatePresence initial={false} mode="wait" custom={direction}>
          {activeChat ? (
            <motion.div
              key={`chat-${activeChat.id}`}
              initial={{ opacity: 0, x: 26, scale: 0.995 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 18, scale: 0.995 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              className="flex-1 min-h-0 flex flex-col"
            >
              <ChatWindow
                chat={activeChat}
                username={identity.username}
                onBack={() => setActiveId(null)}
                transport={transport}
                setTransport={setTransport}
                onCall={kind => setCall({ kind })}
                onSend={handleSend}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            </motion.div>
          ) : (
            <motion.div
              key={`tab-${tab}`}
              custom={direction}
              initial={{ opacity: 0, x: direction * 26 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -26 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 min-h-0"
            >
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
              {tab === 'settings' && (
                <SettingsScreen onOpenSupport={() => { setActiveId('support'); setTabState('chats') }} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <BottomNav tab={tab} setTab={setTab} />

      <AnimatePresence>
        {call && activeChat && (
          <CallModal chat={activeChat} kind={call.kind} onClose={() => setCall(null)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showNewChat && <NewChatModal identity={identity} onClose={() => setShowNewChat(false)} />}
      </AnimatePresence>

      <div className="hidden lg:block fixed bottom-5 right-5 z-0 opacity-[.07] pointer-events-none">
        <Logo size={180} />
      </div>
    </div>
  )
}
