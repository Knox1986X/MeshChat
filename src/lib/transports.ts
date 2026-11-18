import type { Transport } from './types'

export const TRANSPORTS: Transport[] = [
  { id: 'cloudflare', name: 'Cloudflare Edge', desc: 'WebSocket через CDN, обход DPI', latency: '18 мс', status: 'demo', icon: '☁️' },
  { id: 'flyio', name: 'Fly.io Edge', desc: 'Резервный маршрут, EU регионы', latency: '24 мс', status: 'demo', icon: '🪰' },
  { id: 'webrtc', name: 'WebRTC P2P', desc: 'Напрямую между устройствами', latency: '6 мс', status: 'demo', icon: '⚡' },
  { id: 'tor', name: 'Tor / I2P', desc: 'Луковичная маршрутизация', latency: '180 мс', status: 'offline', icon: '🧅' },
  { id: 'mesh', name: 'Mesh Offline', desc: 'Bluetooth / Wi-Fi Direct / LAN', latency: 'локально', status: 'demo', icon: '📡' },
]

export const REPLIES = [
  'Понял тебя 👍',
  'Кстати, MeshChat уже выглядит огонь 🔥',
  'Давай созвонимся вечером?',
  'Скинь файл, когда будет готов',
  'Полностью согласен!',
  'А ты пробовал новый транспорт Cloudflare?',
  'Это точно безопасно? Шифрование E2E?',
  'Да, всё зашифровано. Сервер ничего не видит 🔒',
  'Круто! Жду APK для Android',
  'Отправил тебе приглашение по QR',
]
