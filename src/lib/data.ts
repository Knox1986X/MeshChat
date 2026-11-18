import type { Chat } from './types'

export const INITIAL_CHATS: Chat[] = [
  {
    id: 'anna',
    name: 'Анна Соколова',
    handle: '@anna#7f3a',
    avatarFrom: '#f472b6', avatarTo: '#a855f7',
    online: true, lastSeen: 'в сети', verified: true, pinned: true,
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
    online: true, lastSeen: 'в сети', verified: true, pinned: true,
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
  {
    id: 'kate',
    name: 'Катя Миронова',
    handle: '@kate#4d88',
    avatarFrom: '#06b6d4', avatarTo: '#3b82f6',
    online: true, lastSeen: 'в сети',
    unread: 1,
    lastMessage: 'Ты видел сторис? Там новый логотип', lastTime: '09:48',
    messages: [
      { id: 'k1', text: 'Ты видел сторис? Там новый логотип', time: '09:48', mine: false, read: false },
    ],
  },
  {
    id: 'dima',
    name: 'Дима Волков',
    handle: '@dima#12ab',
    avatarFrom: '#6366f1', avatarTo: '#ec4899',
    online: false, lastSeen: 'был(а) вчера',
    unread: 0, muted: true,
    lastMessage: 'Ок, договорились 🤝', lastTime: 'Вчера',
    messages: [
      { id: 'dm1', text: 'Ок, договорились 🤝', time: 'Вчера', mine: true, read: true },
    ],
  },
  {
    id: 'news',
    name: 'Новости Mesh',
    handle: 'канал · 3 421 подписчик',
    avatarFrom: '#14b8a6', avatarTo: '#22d3ee',
    online: false, lastSeen: '',
    unread: 0, isChannel: true, members: 3421,
    lastMessage: 'Скоро: офлайн-меш по Bluetooth', lastTime: 'Вчера',
    messages: [
      { id: 'n1', text: 'Скоро: офлайн-меш по Bluetooth 📡 Работает без интернета, как Briar', time: 'Вчера', mine: false, read: true },
    ],
  },
]

export const STORIES = [
  { id: 's1', name: 'Вы', mine: true, from: '#8b5cf6', to: '#22d3ee' },
  { id: 's2', name: 'Анна', from: '#f472b6', to: '#a855f7' },
  { id: 's3', name: 'Макс', from: '#f59e0b', to: '#ef4444' },
  { id: 's4', name: 'Катя', from: '#06b6d4', to: '#3b82f6' },
  { id: 's5', name: 'Команда', from: '#22c55e', to: '#84cc16' },
]
