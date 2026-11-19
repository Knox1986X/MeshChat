export type TransportId = 'cloudflare' | 'flyio' | 'webrtc' | 'tor' | 'mesh'

export interface Transport {
  id: TransportId
  name: string
  desc: string
  latency: string
  status: 'online' | 'demo' | 'offline'
  icon: string
}

export interface Message {
  id: string
  text: string
  time: string
  mine: boolean
  read: boolean
  reactions?: string[]
  type?: 'text' | 'voice' | 'image' | 'file'
  duration?: string
  fileName?: string
  fileSize?: string
}

export interface Chat {
  id: string
  name: string
  handle: string
  avatarFrom: string
  avatarTo: string
  online: boolean
  lastSeen: string
  verified?: boolean
  pinned?: boolean
  muted?: boolean
  unread: number
  typing?: boolean
  isGroup?: boolean
  isChannel?: boolean
  members?: number
  lastMessage: string
  lastTime: string
  lastMine?: boolean
  messages: Message[]
  story?: boolean
}

export interface Identity {
  username: string
  handle: string
  fingerprint: string
  publicKey: string
  createdAt: string
}

export interface Contact {
  id: string
  name: string
  handle: string
  avatarFrom: string
  avatarTo: string
  status: string
  verified: boolean
  online: boolean
}

export interface MeshPlugin {
  id: string
  name: string
  desc: string
  iconBg: string
  iconColor: string
  enabled: boolean
  badge?: string
}

export interface MeshNode {
  id: string
  label: string
  x: number // 0..100 on radar
  y: number
  color: string
}
