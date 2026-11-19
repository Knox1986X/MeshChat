import type { Chat, ChatRequest, Contact, MeshNode, MeshPlugin } from './types'
import { SUPPORT_CHIPS, SUPPORT_GREETING } from './supportBot'

export const INITIAL_CHATS: Chat[] = [
  {
    id: 'support',
    name: 'Поддержка MeshChat',
    handle: 'бот · отвечает мгновенно',
    avatarFrom: '#22d3ee', avatarTo: '#6366f1',
    online: true, lastSeen: 'отвечает мгновенно',
    unread: 1, pinned: true, verified: true, isBot: true,
    lastMessage: SUPPORT_GREETING.split('\n')[0], lastTime: 'сейчас',
    chips: SUPPORT_CHIPS,
    messages: [
      { id: 'sp0', text: SUPPORT_GREETING, time: '14:02', mine: false, read: true, bot: true },
      { id: 'sp1', text: 'Кстати, я работаю офлайн: правила и база знаний лежат прямо в приложении, без сервера 🤍', time: '14:02', mine: false, read: true, bot: true },
    ],
  },
  {
    id: 'saved',
    name: 'Избранное',
    handle: 'локальное хранилище',
    avatarFrom: '#3b82f6', avatarTo: '#6366f1',
    online: false, lastSeen: '',
    unread: 0, pinned: true,
    lastMessage: 'Локальное хранилище «Избранное»: заметки, статьи и вложения…', lastTime: '14:20:05',
    messages: [
      { id: 'sv1', text: 'Здесь хранятся твои заметки и важные сообщения 🔖', time: '14:20', mine: false, read: true },
    ],
  },
  {
    id: 'echo',
    name: 'Эхо-проверка E2EE',
    handle: 'канал самопроверки',
    avatarFrom: '#8b5cf6', avatarTo: '#6366f1',
    online: false, lastSeen: '',
    unread: 0, pinned: true, verified: true, isChannel: true, members: 1,
    lastMessage: 'Канал самопроверки E2EE и личных зашифрованных заметок. Отправь…', lastTime: '08:53:29',
    messages: [
      { id: 'e1', text: 'Канал самопроверки E2EE и личных зашифрованных заметок. Отправь сюда сообщение — оно зашифруется и вернётся эхом 🔒', time: '08:53', mine: false, read: true },
    ],
  },
  {
    id: 'mixik',
    name: 'mixik',
    handle: '@mixik',
    avatarFrom: '#6366f1', avatarTo: '#4f46e5',
    online: true, lastSeen: 'На связи · E2EE', verified: true,
    unread: 0,
    lastMessage: 'Лор', lastTime: '12:33:22',
    messages: [
      { id: 'mx1', text: 'Привет! Связь по X3DH установлена 🔒', time: '12:30', mine: false, read: true },
      { id: 'mx2', text: 'Лор', time: '12:33', mine: false, read: true },
    ],
  },
  {
    id: 'gateway',
    name: 'Входящий шлюз E2E',
    handle: 'анонимный приём обращений',
    avatarFrom: '#0ea5e9', avatarTo: '#22d3ee',
    online: false, lastSeen: 'всегда на связи',
    unread: 0, verified: true,
    lastMessage: 'Шлюз принимает зашифрованные обращения без метаданных', lastTime: '08:06:20',
    messages: [
      { id: 'gw1', text: 'Шлюз принимает зашифрованные обращения без метаданных. Твоё сообщение никто не отследит 🕶', time: '08:06', mine: false, read: true },
    ],
  },
  {
    id: 'anna',
    name: 'Анна Соколова',
    handle: '@anna#7f3a',
    avatarFrom: '#f472b6', avatarTo: '#a855f7',
    online: true, lastSeen: 'в сети', verified: true,
    unread: 3, story: true,
    lastMessage: 'Скинь, пожалуйста, новый дизайн 🙏', lastTime: '12:42',
    messages: [
      { id: 'a1', text: 'Привет! Видел новый MeshChat?', time: '12:30', mine: false, read: true },
      { id: 'a2', text: 'Привет! Да, только что открыл. Выглядит просто вау 😍', time: '12:31', mine: true, read: true },
      { id: 'a3', text: 'Ага, тёмная тема и градиенты — топ. А шифрование там реально E2E?', time: '12:35', mine: false, read: true },
      { id: 'a4', text: 'Да! Double Ratchet как в Signal. Сервер ничего не видит, всё на ключах', time: '12:38', mine: true, read: true, reactions: ['🔒'] },
      { id: 'a5', text: 'Скинь, пожалуйста, новый дизайн 🙏', time: '12:42', mine: false, read: false },
    ],
  },
  {
    id: 'dev',
    name: 'MeshChat Dev',
    handle: '@meshchat#0001',
    avatarFrom: '#8b5cf6', avatarTo: '#22d3ee',
    online: true, lastSeen: 'в сети', verified: true,
    unread: 0, isChannel: true, members: 12840,
    lastMessage: 'v0.1 Demo: интерфейс готов, ждём ключи Cloudflare/Fly.io', lastTime: '11:20',
    messages: [
      { id: 'd1', text: 'Добро пожаловать в MeshChat! 🚀', time: '10:00', mine: false, read: true },
      { id: 'd2', text: 'Это демо-версия: интерфейс полностью готов, транспорты работают в режиме заглушки.', time: '10:01', mine: false, read: true },
      { id: 'd3', text: 'Как только подключим Cloudflare Workers и Fly.io — всё оживёт по-настоящему.', time: '11:20', mine: false, read: true, reactions: ['🔥', '❤️'] },
    ],
  },
  {
    id: 'group',
    name: 'Команда Mesh',
    handle: 'группа · 8 участников',
    avatarFrom: '#22c55e', avatarTo: '#84cc16',
    online: false, lastSeen: 'был(а) 5 мин назад',
    unread: 12, isGroup: true, members: 8, story: true,
    lastMessage: 'Макс: Погнали делать Android APK 📱', lastTime: '11:05',
    messages: [
      { id: 'g1', text: 'Всем привет! Сегодня релизим демо', time: '09:00', mine: false, read: true },
      { id: 'g2', text: 'Отлично! Я уже тестирую на Android', time: '09:12', mine: true, read: true },
      { id: 'g3', text: 'Макс: Погнали делать Android APK 📱', time: '11:05', mine: false, read: false },
    ],
  },
  {
    id: 'max',
    name: 'Макс Орлов',
    handle: '@max#9c21',
    avatarFrom: '#f59e0b', avatarTo: '#ef4444',
    online: false, lastSeen: 'был(а) 1 ч назад',
    unread: 0, story: true,
    lastMessage: 'Голосовое сообщение · 0:42', lastTime: '10:15',
    messages: [
      { id: 'm1', text: 'Слушай, а звонки будут?', time: '10:00', mine: false, read: true },
      { id: 'm2', text: 'Будут! WebRTC, голос и видео, как в Discord', time: '10:05', mine: true, read: true },
      { id: 'm3', text: 'Голосовое сообщение · 0:42', time: '10:15', mine: false, read: true, type: 'voice', duration: '0:42' },
    ],
  },
]

export const CONTACTS: Contact[] = [
  { id: 'c1', name: 'mixik', handle: '@mixik', avatarFrom: '#6366f1', avatarTo: '#4f46e5', status: 'На связи · E2EE', verified: true, online: true },
  { id: 'c2', name: 'Анна Соколова', handle: '@anna#7f3a', avatarFrom: '#f472b6', avatarTo: '#a855f7', status: 'в сети · E2EE', verified: true, online: true },
  { id: 'c3', name: 'Макс Орлов', handle: '@max#9c21', avatarFrom: '#f59e0b', avatarTo: '#ef4444', status: 'был(а) 1 ч назад', verified: false, online: false },
]

export const MESH_NODES: MeshNode[] = [
  { id: 'n1', label: '@mixik · X3DH', x: 30, y: 34, color: '#818cf8' },
  { id: 'n2', label: 'Blind Relay · 173 мс', x: 66, y: 30, color: '#34d399' },
  { id: 'n3', label: 'CF Edge · 18 мс', x: 72, y: 62, color: '#38bdf8' },
]

export const MESH_PLUGINS: MeshPlugin[] = [
  { id: 'p2p', name: 'P2P WebRTC / Wi-Fi LAN', desc: 'Локальный ретранслятор :3000 без интернета', iconBg: 'rgba(56,189,248,.14)', iconColor: '#38bdf8', enabled: true },
  { id: 'tor', name: 'Tor onion-маршрутизация', desc: 'Строгий режим Fail-Closed через SOCKS5 / Orbot без утечки IP', iconBg: 'rgba(139,92,246,.16)', iconColor: '#a78bfa', enabled: true },
  { id: 'cf', name: 'Cloudflare Edge WS', desc: 'WebSocket через CDN, обход DPI и блокировок', iconBg: 'rgba(251,191,36,.14)', iconColor: '#fbbf24', enabled: true, badge: 'ДЕМО' },
  { id: 'fly', name: 'Fly.io Edge', desc: 'Резервный маршрут, EU регионы (Франкфурт)', iconBg: 'rgba(52,211,153,.14)', iconColor: '#34d399', enabled: false, badge: 'ДЕМО' },
  { id: 'bt', name: 'Bluetooth Mesh', desc: 'Офлайн-меш как Briar, без интернета и SIM', iconBg: 'rgba(251,113,133,.14)', iconColor: '#fb7185', enabled: false },
]

export const STORIES = [
  { id: 's1', name: 'Вы', mine: true, from: '#8b5cf6', to: '#22d3ee' },
  { id: 's2', name: 'Анна', from: '#f472b6', to: '#a855f7' },
  { id: 's3', name: 'Макс', from: '#f59e0b', to: '#ef4444' },
  { id: 's4', name: 'mixik', from: '#6366f1', to: '#4f46e5' },
  { id: 's5', name: 'Команда', from: '#22c55e', to: '#84cc16' },
]


export const CHAT_REQUESTS: ChatRequest[] = [
  {
    id: 'r1',
    name: 'Неизвестный узел',
    handle: '@anon#f41c',
    text: 'Привет. Нашёл твой инвайт в канале Mesh. Можно спросить про транспорт?',
    time: '09:41',
    avatarFrom: '#64748b', avatarTo: '#334155',
  },
  {
    id: 'r2',
    name: 'Лена К.',
    handle: '@lena#8b02',
    text: 'Это ты писал про офлайн-меш? Хочу протестировать на телефоне',
    time: 'вчера',
    avatarFrom: '#a855f7', avatarTo: '#6366f1',
  },
]
