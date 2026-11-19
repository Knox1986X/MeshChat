import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Battery, Bell, ChevronRight, Download, FolderOpen, Globe, HardDrive, Headphones, KeyRound, Laptop,
  LayoutGrid, MessageSquare, MoreVertical, PieChart, Search, Smile, Sparkles, User,
} from 'lucide-react'

interface Item {
  icon: any
  bg: string
  color: string
  title: string
  sub: string
  right?: string
}

const ITEMS: Item[] = [
  { icon: User, bg: 'rgba(125,211,252,.16)', color: '#7dd3fc', title: 'Аккаунт', sub: 'Имя пользователя, «О себе», статус и ключи' },
  { icon: MessageSquare, bg: 'rgba(252,211,77,.16)', color: '#fcd34d', title: 'Настройки чатов', sub: 'Обои, новогодние темы, градиенты и анимации' },
  { icon: Smile, bg: 'rgba(251,146,60,.16)', color: '#fb923c', title: 'Стикеры и эмодзи', sub: 'Настройки стикеров, эмодзи и быстрых реакций' },
  { icon: KeyRound, bg: 'rgba(52,211,153,.16)', color: '#34d399', title: 'Конфиденциальность', sub: 'PIN-код, защита от скриншотов, ключи доступа' },
  { icon: Bell, bg: 'rgba(251,113,133,.16)', color: '#fb7185', title: 'Уведомления', sub: 'Звуки, звонки, счётчик сообщений и тихий час' },
  { icon: PieChart, bg: 'rgba(129,140,248,.18)', color: '#a5b4fc', title: 'Данные и память', sub: 'Настройки загрузки медиафайлов и резерв E2EE' },
  { icon: FolderOpen, bg: 'rgba(125,211,252,.16)', color: '#7dd3fc', title: 'Папки с чатами', sub: 'Сортировка чатов по папкам и свои вкладки' },
  { icon: Laptop, bg: 'rgba(45,212,191,.16)', color: '#2dd4bf', title: 'Устройства', sub: 'Управление активными сеансами и сетью Mesh' },
  { icon: Battery, bg: 'rgba(251,191,36,.16)', color: '#fbbf24', title: 'Энергосбережение', sub: 'Экономия энергии при низком заряде батареи' },
  { icon: Globe, bg: 'rgba(192,132,252,.18)', color: '#c084fc', title: 'Язык', sub: '', right: 'Русский' },
  { icon: Download, bg: 'rgba(125,211,252,.16)', color: '#7dd3fc', title: 'Обновления и диагностика', sub: 'Релизы GitHub, проверка целостности APK и криптоядра', right: 'v2.3.0' },
]

interface Props {
  onOpenSupport: () => void
}

export default function SettingsScreen({ onOpenSupport }: Props) {
  const [snow, setSnow] = useState(true)
  const [garland, setGarland] = useState(true)
  const [quiet, setQuiet] = useState(false)
  const [blur, setBlur] = useState(true)

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-5 pt-14 pb-3 shrink-0 flex items-center justify-between">
        <button className="w-10 h-10 rounded-2xl card flex items-center justify-center text-slate-300">
          <LayoutGrid size={18} />
        </button>
        <h1 className="text-[24px] font-extrabold tracking-tight">Настройки</h1>
        <div className="flex items-center gap-2">
          <button className="w-10 h-10 rounded-2xl card flex items-center justify-center text-slate-300">
            <Search size={18} />
          </button>
          <button className="w-10 h-10 rounded-2xl card flex items-center justify-center text-slate-300">
            <MoreVertical size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-slim px-4 pb-28 md:pb-6 space-y-2.5">
        <motion.button
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.985 }}
          onClick={onOpenSupport}
          className="w-full card p-4 flex items-center gap-4 text-left relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, rgba(34,211,238,.20), rgba(99,102,241,.22))' }}
        >
          <span className="w-[52px] h-[52px] rounded-full flex items-center justify-center shrink-0 bg-cyan-400/20 text-cyan-200">
            <Headphones size={24} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2 font-extrabold text-[16.5px]">
              Поддержка
              <span className="text-[9.5px] font-black tracking-wider px-1.5 py-0.5 rounded-md bg-cyan-400/20 text-cyan-200">БОТ</span>
            </span>
            <span className="block text-[13px] text-slate-300 leading-snug mt-0.5">Отвечает мгновенно · офлайн · 24/7</span>
          </span>
          <ChevronRight size={18} className="text-slate-400 shrink-0" />
          <Sparkles size={70} className="absolute -right-4 -bottom-6 text-white/[.06]" />
        </motion.button>

        {ITEMS.map((item, i) => (
          <motion.button
            key={item.title}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(0.04 + i * 0.03, 0.4) }}
            whileTap={{ scale: 0.985 }}
            className="w-full card card-hover p-4 flex items-center gap-4 text-left"
          >
            <span className="w-[52px] h-[52px] rounded-full flex items-center justify-center shrink-0" style={{ background: item.bg, color: item.color }}>
              <item.icon size={24} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-extrabold text-[16.5px]">{item.title}</span>
              {item.sub && <span className="block text-[13px] text-slate-400 leading-snug mt-0.5">{item.sub}</span>}
            </span>
            {item.right && <span className="text-sky-400 font-bold text-[15px] shrink-0">{item.right}</span>}
          </motion.button>
        ))}

        {/* Quiet hours + privacy toggles */}
        <div className="card p-4">
          <p className="font-extrabold text-[15px] mb-3">🌙 Приватность и тишина</p>
          {[
            { label: 'Тихие часы 23:00–08:00', sub: 'Уведомления без текста', on: quiet, set: setQuiet },
            { label: 'Скрывать превью на локскрине', sub: 'Как в Signal', on: blur, set: setBlur },
          ].map(t => (
            <div key={t.label} className="flex items-center justify-between py-2 gap-3">
              <span className="min-w-0">
                <span className="block text-[14px] text-slate-200 font-semibold">{t.label}</span>
                <span className="block text-[11.5px] text-slate-500">{t.sub}</span>
              </span>
              <button onClick={() => t.set(!t.on)} className={`w-[52px] h-[30px] rounded-full p-1 transition-all shrink-0 ${t.on ? 'bg-sky-500' : 'bg-slate-600/60'}`}>
                <span className={`block w-[22px] h-[22px] rounded-full bg-white shadow transition-transform ${t.on ? 'translate-x-[22px]' : ''}`} />
              </button>
            </div>
          ))}
          <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">Подсказка: тройное нажатие по аватару в профиле — паника-жест, стирает ключи.</p>
        </div>

        {/* Theme toggles */}
        <div className="card p-4">
          <p className="font-extrabold text-[15px] mb-3">🎄 Новогодняя тема</p>
          {[
            { label: 'Снегопад', on: snow, set: setSnow },
            { label: 'Гирлянда', on: garland, set: setGarland },
          ].map(t => (
            <div key={t.label} className="flex items-center justify-between py-2">
              <span className="text-[14px] text-slate-300 font-semibold">{t.label}</span>
              <button onClick={() => t.set(!t.on)} className={`w-[52px] h-[30px] rounded-full p-1 transition-all ${t.on ? 'bg-sky-500' : 'bg-slate-600/60'}`}>
                <span className={`block w-[22px] h-[22px] rounded-full bg-white shadow transition-transform ${t.on ? 'translate-x-[22px]' : ''}`} />
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-[11.5px] text-slate-600 py-3 flex items-center justify-center gap-1.5">
          <HardDrive size={12} /> MeshChat v2.3.0 · Open Source · Без слежки
        </p>
      </div>
    </div>
  )
}
