/**
 * MeshChat Relay — Cloudflare Worker
 * ------------------------------------------------------------------
 * Слепой ретранслятор для зашифрованных сообщений + прокси GigaChat.
 *
 *   GET  /health                     — проверка живости (для «светофора»)
 *   GET  /ws?room=<id>               — WebSocket, слепая пересылка кадров
 *   POST /gigachat                   — GigaChat (Сбер), ключи в env
 *
 * Релей НЕ хранит сообщения, не пишет логи содержимого и не знает,
 * кто с кем говорит: room — это SHA-256 от общего секрета пары.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const cors = corsHeaders(request, env)

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })

    if (url.pathname === '/health') {
      return json(
        {
          ok: true,
          service: 'meshchat-relay',
          version: env.RELAY_VERSION || '2.4.0',
          ts: Date.now(),
          colo: request.cf?.colo ?? null,
          demo: env.DEMO === '1',
        },
        200,
        cors,
      )
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return json({ error: 'expected_websocket_upgrade' }, 426, cors)
      }
      const room = (url.searchParams.get('room') || '').slice(0, 96)
      if (room.length < 8) return json({ error: 'room_too_short' }, 400, cors)
      const id = env.ROOMS.idFromName(room)
      return env.ROOMS.get(id).fetch(request)
    }

    if (url.pathname === '/gigachat') {
      return gigachat(request, env, cors)
    }

    return json({ error: 'not_found' }, 404, cors)
  },
}

/* ─────────────────────────── Durable Object ─────────────────────────── */

export class Room {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.sessions = new Set()
    this.created = Date.now()
  }

  async fetch(request) {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    if (this.sessions.size >= 64) {
      return new Response('room_full', { status: 503 })
    }

    server.accept()
    this.sessions.add(server)

    const drop = () => this.sessions.delete(server)
    server.addEventListener('message', event => {
      // Слепая пересылка: релей не парсит и не хранит содержимое
      for (const peer of this.sessions) {
        if (peer === server) continue
        try {
          peer.send(event.data)
        } catch {
          this.sessions.delete(peer)
        }
      }
    })
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)

    return new Response(null, { status: 101, webSocket: client })
  }
}

/* ─────────────────────────── GigaChat ─────────────────────────── */

let tokenCache = { token: null, exp: 0 }

async function sberToken(env) {
  if (tokenCache.token && tokenCache.exp > Date.now() + 30_000) return tokenCache.token
  const id = env.GIGACHAT_CLIENT_ID
  const secret = env.GIGACHAT_CLIENT_SECRET
  if (!id || !secret) throw new Error('gigachat_not_configured')

  const res = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${id}:${secret}`),
      RqUID: crypto.randomUUID(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'scope=GIGACHAT_API_PERS',
  })
  if (!res.ok) throw new Error('oauth_' + res.status)
  const data = await res.json()
  tokenCache = {
    token: data.access_token,
    exp: Number(data.expires_at) || Date.now() + 1_800_000,
  }
  return tokenCache.token
}

async function gigachat(request, env, cors) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors)

  // Необязательный общий секрет: клиент шлёт его в x-relay-key
  if (env.RELAY_KEY && request.headers.get('x-relay-key') !== env.RELAY_KEY) {
    return json({ error: 'unauthorized' }, 401, cors)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_json' }, 400, cors)
  }

  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : []
  if (!messages.length) return json({ error: 'no_messages' }, 400, cors)

  try {
    const token = await sberToken(env)
    const res = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: body.model || 'GigaChat',
        messages,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.35,
      }),
    })

    if (res.status === 401) {
      tokenCache = { token: null, exp: 0 }
      return json({ error: 'gigachat_unauthorized' }, 401, cors)
    }
    if (!res.ok) {
      return json({ error: 'gigachat_' + res.status, detail: (await res.text()).slice(0, 400) }, 502, cors)
    }

    const data = await res.json()
    const answer = data.choices?.[0]?.message?.content ?? ''
    return json({ answer }, 200, cors)
  } catch (e) {
    return json({ error: String(e.message || e) }, 500, cors)
  }
}

/* ─────────────────────────── helpers ─────────────────────────── */

function corsHeaders(request, env) {
  const origin = env.ALLOWED_ORIGIN || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,x-relay-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  })
}
