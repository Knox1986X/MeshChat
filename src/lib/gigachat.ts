/**
 * GigaChat (Sber) — интеграция поддержки через LLM.
 * -----------------------------------------------------------------
 * Два пути:
 *  1) relay (рекомендуется): запрос уходит на свой Cloudflare Worker,
 *     секреты GigaChat живут только на сервере. Клиент не знает ключей.
 *  2) direct: Client ID + Secret вводятся в приложении и хранятся локально.
 *     Браузерный CORS и самоподписанный сертификат Сбера режут прямой вызов,
 *     поэтому direct реально работает только через нативную обёртку (Android).
 *
 * Если ничего не настроено — молча падаем на локальные правила (supportBot),
 * пользователь никогда не остаётся без ответа.
 */

export interface GigaChatConfig {
  relayUrl: string
  clientId: string
  clientSecret: string
  model: string
}

export const GIGACHAT_DEFAULTS: GigaChatConfig = {
  relayUrl: '',
  clientId: '',
  clientSecret: '',
  model: 'GigaChat',
}

export const SYSTEM_PROMPT = `Ты — служба поддержки анонимного мессенджера MeshChat (v2.3).
Отвечай по-русски, коротко и по делу, дружелюбно, без канцелярита, максимум 5 абзацев.
Факты о проекте:
- Аккаунт без телефона и e-mail: личность = пара ключей Ed25519/X25519, псевдоним вида @name#1234.
- Шифрование E2EE: X3DH + Double Ratchet, группы на Sender Keys. Сервер видит только шифротекст.
- Транспорты: Cloudflare Edge WS (основной), Fly.io EU (резерв), P2P WebRTC/Wi-Fi LAN, Tor onion (Fail-Closed), Bluetooth/Wi-Fi Direct меш.
- Сейчас сборка демонстрационная: интерфейс готов, транспорты ждут ключи Cloudflare/Fly.io, поэтому сообщения не уходят в сеть.
- Стоимость: 0 ₽ для пользователя и автора (free-тарифы Cloudflare/Fly.io + P2P).
- Платформы: Android (APK в GitHub Releases, тег v0.1-demo), затем Linux, затем Windows; веб/PWA уже работает.
- Проект не будет в Google Play: правила ломают анонимность, APK раздаётся напрямую.
- Фичи: свайп влево по сообщению = ответ, двойной тап = ❤️, долгое нажатие = меню, исчезающие сообщения, паника-жест, несколько личностей.
Если вопрос требует данных аккаунта или платежа — предложи создать тикет оператору.
Не выдумывай функций, которых нет в этом списке: лучше скажи «пока нет, в роадмапе».`

const TOKEN_KEY = 'meshchat_gigachat_token'

interface CachedToken {
  token: string
  exp: number
}

function readToken(): CachedToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as CachedToken
    return t.exp > Date.now() + 30_000 ? t : null
  } catch {
    return null
  }
}

function saveToken(token: string, ttlMs: number) {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + ttlMs }))
  } catch {
    /* приватный режим — работаем без кэша */
  }
}

export function clearGigaChatToken() {
  try { localStorage.removeItem(TOKEN_KEY) } catch {}
}

async function fetchToken(cfg: GigaChatConfig): Promise<string> {
  const cached = readToken()
  if (cached) return cached.token

  const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`)
  const res = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      RqUID: crypto.randomUUID(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'scope=GIGACHAT_API_PERS',
  })
  if (!res.ok) throw new Error(`GigaChat OAuth ${res.status}`)
  const data = (await res.json()) as { access_token: string; expires_at: number }
  const ttl = Math.max(60_000, (data.expires_at || Date.now() + 1_800_000) - Date.now())
  saveToken(data.access_token, ttl)
  return data.access_token
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export function isGigaChatReady(cfg: GigaChatConfig) {
  return Boolean(cfg.relayUrl || (cfg.clientId && cfg.clientSecret))
}

/**
 * Спросить GigaChat. Бросает ошибку — вызывающий код обязан
 * откатиться на локальные правила и сказать об этом пользователю.
 */
export async function askGigaChat(question: string, history: ChatTurn[], cfg: GigaChatConfig): Promise<string> {
  if (!isGigaChatReady(cfg)) throw new Error('not-configured')

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-8),
    { role: 'user', content: question },
  ]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)

  try {
    if (cfg.relayUrl) {
      // Секреты не покидают relay
      const res = await fetch(cfg.relayUrl.replace(/\/$/, '') + '/gigachat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model || 'GigaChat', messages, temperature: 0.35 }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`relay ${res.status}`)
      const data = (await res.json()) as { answer?: string; choices?: { message?: { content?: string } }[] }
      const answer = data.answer ?? data.choices?.[0]?.message?.content
      if (!answer) throw new Error('empty-relay')
      return answer.trim()
    }

    const token = await fetchToken(cfg)
    const res = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ model: cfg.model || 'GigaChat', messages, temperature: 0.35 }),
      signal: controller.signal,
    })
    if (res.status === 401) {
      clearGigaChatToken()
      throw new Error('unauthorized')
    }
    if (!res.ok) throw new Error(`gigachat ${res.status}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const answer = data.choices?.[0]?.message?.content
    if (!answer) throw new Error('empty')
    return answer.trim()
  } finally {
    clearTimeout(timer)
  }
}
