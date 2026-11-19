import { useEffect, useState } from 'react'
import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react'
import type { Chat } from '../lib/types'
import { Avatar } from './screens/ChatsScreen'

interface Props {
  chat: Chat
  kind: 'voice' | 'video'
  huddle?: boolean
  onClose: () => void
}

export default function CallModal({ chat, kind, huddle, onClose }: Props) {
  const [seconds, setSeconds] = useState(0)
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(kind === 'voice')

  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-[70] bg-[#070b1a]/92 backdrop-blur-xl flex items-center justify-center p-4 anim-fade-in" onClick={onClose}>
      <div className="w-full max-w-sm text-center anim-pop" onClick={e => e.stopPropagation()}>
        <div className="relative inline-block mb-6">
          <span className="absolute inset-0 rounded-full bg-sky-500/40" style={{ animation: 'pulseRing 2s ease-out infinite' }} />
          <span className="absolute inset-0 rounded-full bg-indigo-400/30" style={{ animation: 'pulseRing 2s ease-out infinite .6s' }} />
          <div className="relative">
            <Avatar chat={chat} size={110} />
          </div>
        </div>
        <h3 className="text-2xl font-extrabold">{chat.name}</h3>
        <p className="text-slate-400 mt-1 font-mono text-sm">{mm}:{ss} · {huddle ? 'хаддл' : kind === 'video' ? 'видео' : 'голос'} · E2E 🔒</p>

        <div className="flex items-center justify-center gap-1 h-10 mt-6">
          {[0.5, 0.9, 0.4, 1, 0.6, 0.8, 0.35, 0.95, 0.55, 0.75, 0.45, 0.85, 0.5, 0.7, 0.4].map((d, i) => (
            <span
              key={i}
              className="wave-bar w-1.5 rounded-full bg-gradient-to-t from-sky-500 to-indigo-400"
              style={{ height: 36, animationDelay: `${i * 0.08}s`, animationDuration: `${d}s` }}
            />
          ))}
        </div>

        <div className="flex items-center justify-center gap-4 mt-8">
          <button onClick={() => setMuted(v => !v)} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${muted ? 'bg-rose-500' : 'glass-strong'}`}>
            {muted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <button onClick={onClose} className="w-16 h-16 rounded-full bg-rose-500 flex items-center justify-center shadow-lg shadow-rose-500/40 hover:scale-105 transition-all">
            <PhoneOff size={26} />
          </button>
          <button onClick={() => setCamOff(v => !v)} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${camOff ? 'bg-rose-500' : 'glass-strong'}`}>
            {camOff ? <VideoOff size={22} /> : <Video size={22} />}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-5">Демо-звонок: WebRTC подключим после ключей</p>
      </div>
    </div>
  )
}
