import { useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion'
import { Check, CheckCheck, CornerUpLeft, Play, Sparkles } from 'lucide-react'
import type { Message } from '../lib/types'

interface Props {
  msg: Message
  reduced?: boolean
  index: number
  now?: number
  onReply: (msg: Message) => void
  onMenu: (msg: Message) => void
  onReact: (msg: Message, emoji: string) => void
}

const SWIPE_THRESHOLD = 54

const bubbleIn = {
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  show: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring' as const, stiffness: 460, damping: 32, mass: 0.7 },
  },
}

export default function MessageBubble({ msg, reduced, index, now, onReply, onMenu, onReact }: Props) {
  const [dragging, setDragging] = useState(false)
  const [burst, setBurst] = useState(0)
  const x = useMotionValue(0)
  const iconOpacity = useTransform(x, [-70, -18, 0], [1, 0.35, 0])
  const iconScale = useTransform(x, [-70, -18, 0], [1.15, 0.7, 0.5])

  const longPress = useRef<number | null>(null)
  const lastTap = useRef(0)
  const moved = useRef(false)
  const armed = useRef(false)

  if (msg.type === 'system') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex justify-center my-3"
      >
        <span className="text-[11px] font-semibold bg-white/[.06] text-slate-400 px-3 py-1 rounded-full">{msg.text}</span>
      </motion.div>
    )
  }

  const startPress = () => {
    moved.current = false
    longPress.current = window.setTimeout(() => {
      if (!moved.current) {
        navigator.vibrate?.(18)
        onMenu(msg)
      }
    }, 480)
  }

  const endPress = () => {
    if (longPress.current) window.clearTimeout(longPress.current)
    longPress.current = null
  }

  const handleTap = () => {
    if (moved.current) return
    const now = Date.now()
    if (now - lastTap.current < 300) {
      // двойной тап = ❤️
      setBurst(b => b + 1)
      navigator.vibrate?.(10)
      onReact(msg, '❤️')
      lastTap.current = 0
    } else {
      lastTap.current = now
    }
  }

  return (
    <div className={`relative flex ${msg.mine ? 'justify-end' : 'justify-start'} mb-1`}>
      {/* Подсказка ответа за бабблом (свайп влево) */}
      <motion.div
        aria-hidden
        style={{ opacity: iconOpacity, scale: iconScale }}
        className={`absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-sky-500/20 border border-sky-400/40 flex items-center justify-center ${dragging ? '' : 'pointer-events-none'}`}
      >
        <CornerUpLeft size={15} className="text-sky-300" />
      </motion.div>

      <motion.div
        layout={!reduced}
        variants={bubbleIn}
        initial="hidden"
        animate="show"
        transition={{ delay: reduced ? 0 : Math.min(index * 0.012, 0.12) }}
        drag={reduced ? false : 'x'}
        dragDirectionLock
        dragConstraints={{ left: -96, right: 0 }}
        dragElastic={{ left: 0.32, right: 0.04 }}
        dragSnapToOrigin
        style={{ x }}
        onDragStart={() => {
          setDragging(true)
          moved.current = true
          endPress()
        }}
        onDrag={(_, info) => {
          const next = info.offset.x < -SWIPE_THRESHOLD
          if (next !== armed.current) {
            armed.current = next
            if (next) navigator.vibrate?.(12)
          }
        }}
        onDragEnd={(_, info) => {
          setDragging(false)
          if (armed.current && info.offset.x < -SWIPE_THRESHOLD) {
            navigator.vibrate?.(8)
            onReply(msg)
          }
          armed.current = false
        }}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={endPress}
        onTap={handleTap}
        className={`relative max-w-[80%] md:max-w-[62%] px-3.5 py-2.5 select-none touch-pan-y ${
          msg.mine ? 'bubble-me' : 'bubble-them'
        } ${msg.pending ? 'opacity-70' : ''}`}
      >
        {/* Цитата ответа */}
        {msg.replyTo && (
          <div className={`mb-1.5 rounded-lg px-2.5 py-1.5 border-l-2 ${msg.mine ? 'bg-black/20 border-white/70' : 'bg-sky-500/10 border-sky-400'}`}>
            <p className={`text-[11px] font-bold ${msg.mine ? 'text-white' : 'text-sky-300'}`}>
              {msg.replyTo.mine ? 'Вы' : msg.replyTo.name}
            </p>
            <p className={`text-[12px] truncate ${msg.mine ? 'text-white/80' : 'text-slate-300'}`}>{msg.replyTo.text}</p>
          </div>
        )}

        {msg.type === 'voice' ? (
          <div className="flex items-center gap-3 min-w-[190px]">
            <button className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0 active:scale-90 transition-transform">
              <Play size={17} fill="white" />
            </button>
            <div className="flex items-center gap-[3px] h-8">
              {[10, 18, 26, 14, 22, 30, 16, 24, 12, 20, 28, 15, 22, 11, 18].map((h, i) => (
                <span key={i} className="w-[3px] rounded-full bg-white/70 wave-bar" style={{ height: h, animationDelay: `${i * 60}ms` }} />
              ))}
            </div>
            <span className="text-[12px] font-medium text-white/85">{msg.duration}</span>
          </div>
        ) : (
          <p className="text-[14.5px] leading-relaxed break-words whitespace-pre-wrap">{msg.text}</p>
        )}

        <div className="flex items-center justify-end gap-1 mt-1">
          {!!msg.reactions?.length && (
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`mr-1 text-[11px] px-1.5 py-0.5 rounded-full ${msg.mine ? 'bg-black/25' : 'bg-white/10'}`}
            >
              {msg.reactions.join(' ')}
            </motion.span>
          )}
          {!!msg.expiresAt && (
            <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${msg.mine ? 'text-amber-100' : 'text-amber-300'}`}>
              ⏳ {Math.max(0, Math.ceil(((msg.expiresAt - (now ?? Date.now())) / 1000)))}
            </span>
          )}
          <span className={`text-[10.5px] ${msg.mine ? 'text-white/55' : 'text-slate-500'}`}>{msg.time}</span>
          {msg.mine && (msg.pending
            ? <span className="w-3 h-3 rounded-full border border-white/50 border-t-transparent animate-spin" />
            : msg.read
              ? <CheckCheck size={14} className="text-cyan-200" />
              : <Check size={14} className="text-white/60" />)}
          {msg.bot && <Sparkles size={11} className="text-sky-300 ml-0.5" />}
        </div>

        {/* Взрыв сердечек при двойном тапе */}
        <AnimatePresence>
          {burst > 0 && (
            <motion.span
              key={burst}
              initial={{ opacity: 0, y: 0, scale: 0.4 }}
              animate={{ opacity: [0, 1, 1, 0], y: -34, scale: [0.4, 1.15, 1, 0.9] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.05, ease: 'easeOut' }}
              onAnimationComplete={() => setBurst(0)}
              className="pointer-events-none absolute -top-2 right-2 text-lg drop-shadow-[0_2px_10px_rgba(244,114,182,.8)]"
            >
              ❤️
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
