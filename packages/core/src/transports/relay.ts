/**
 * Relay transport — the "free server" of MeshChat.
 *
 * Speaks WebSocket when it can (low latency, push) and falls back to a
 * long-polling HTTP loop on restrictive networks, captive portals and proxies
 * that break upgrades. The relay is a dumb, zero-knowledge mailbox: it stores
 * opaque envelopes under routing tags for a limited time.
 */
import type { Envelope } from '../envelope';
import { isEnvelope } from '../envelope';
import type { Transport, TransportState } from './types';
import { sleep } from './types';

export interface RelayHealth {
  ok: boolean;
  name?: string;
  version?: string;
  pow?: number;
  ttlMs?: number;
  maxEnvelopeBytes?: number;
}

export interface PreKeyPublish {
  bundle: {
    v: 1;
    ik: string;
    spk: string;
    spkId: number;
    spkSig: string;
    ts: number;
  };
  opks: Array<{ id: number; pub: string }>;
}

export type FetchedBundle = PreKeyPublish['bundle'] & {
  opk?: { id: number; pub: string };
};

export class RelayTransport implements Transport {
  readonly kind = 'relay' as const;
  readonly id: string;
  readonly base: string;
  label: string;
  state: TransportState = 'off';
  detail?: string;
  lastError?: string;
  sent = 0;
  received = 0;
  health: RelayHealth | null = null;
  /** Latency of the last round trip, ms. */
  latency = 0;

  onEnvelope: ((env: Envelope, via: string) => void) | null = null;
  onState: ((t: Transport) => void) | null = null;

  private tags = new Set<string>();
  private cursors = new Map<string, number>();
  private ws: WebSocket | null = null;
  private stopped = true;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private polling: Promise<void> | null = null;
  private abort = new AbortController();

  constructor(base: string) {
    this.base = base.replace(/\/+$/, '');
    this.id = this.base;
    this.label = new URL(this.base).host;
  }

  private setState(state: TransportState, detail?: string, error?: string): void {
    this.state = state;
    if (detail !== undefined) this.detail = detail;
    if (error !== undefined) this.lastError = error;
    this.onState?.(this);
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.abort = new AbortController();
    this.setState('connecting', 'probing');
    await this.probe();
    if (this.stopped) return;
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.setState('off', 'stopped');
  }

  watch(tags: string[]): void {
    this.tags = new Set(tags);
    if (this.ws && this.ws.readyState === 1) this.subscribe();
  }

  async probe(): Promise<RelayHealth | null> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.base}/v1/health`, {
        signal: this.abort.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`health ${res.status}`);
      this.health = (await res.json()) as RelayHealth;
      this.latency = Date.now() - started;
      return this.health;
    } catch (err) {
      this.health = null;
      return null;
    }
  }

  private wsUrl(): string {
    const url = new URL(this.base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/ws`;
    return url.toString();
  }

  private openSocket(): void {
    if (this.stopped) return;
    if (typeof WebSocket === 'undefined') {
      this.startPolling();
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl());
    } catch {
      this.startPolling();
      return;
    }
    this.ws = ws;
    const openTimer = setTimeout(() => {
      if (ws.readyState !== 1) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    }, 6000);

    ws.onopen = () => {
      clearTimeout(openTimer);
      this.retry = 0;
      this.setState('online', 'websocket');
      this.subscribe();
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type: string;
          envelopes?: unknown[];
          cursor?: Record<string, number>;
          ping?: number;
        };
        if (msg.type === 'env' && Array.isArray(msg.envelopes)) {
          if (msg.cursor) for (const [tag, value] of Object.entries(msg.cursor)) this.cursors.set(tag, value);
          for (const raw of msg.envelopes) {
            if (!isEnvelope(raw)) continue;
            this.received += 1;
            this.onEnvelope?.(raw, this.id);
          }
        }
        if (msg.type === 'ping' && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'pong', t: msg.ping }));
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onerror = () => {
      /* handled by onclose */
    };
    ws.onclose = () => {
      clearTimeout(openTimer);
      if (this.stopped) return;
      this.ws = null;
      this.setState('connecting', 'reconnecting');
      const delay = Math.min(30_000, 500 * 2 ** this.retry++);
      this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
      // While the socket is down, keep pulling over HTTP so nothing is lost.
      this.startPolling();
    };
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(
      JSON.stringify({
        type: 'sub',
        tags: [...this.tags],
        cursors: Object.fromEntries([...this.tags].map((t) => [t, this.cursors.get(t) ?? 0])),
      }),
    );
  }

  private startPolling(): void {
    if (this.polling || this.stopped) return;
    this.polling = this.pollLoop().finally(() => {
      this.polling = null;
    });
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      const tags = [...this.tags];
      if (!tags.length) {
        await sleep(1000);
        continue;
      }
      try {
        const started = Date.now();
        const res = await fetch(`${this.base}/v1/wait`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tags: Object.fromEntries(tags.map((t) => [t, this.cursors.get(t) ?? 0])),
            timeoutMs: 20_000,
          }),
          signal: this.abort.signal,
        });
        if (!res.ok) throw new Error(`wait ${res.status}`);
        this.latency = Date.now() - started;
        const data = (await res.json()) as { envelopes?: unknown[]; cursor?: Record<string, number> };
        if (this.state !== 'online') this.setState('online', 'long-poll');
        if (data.cursor) for (const [tag, value] of Object.entries(data.cursor)) this.cursors.set(tag, value);
        for (const raw of data.envelopes ?? []) {
          if (!isEnvelope(raw)) continue;
          this.received += 1;
          this.onEnvelope?.(raw, this.id);
        }
      } catch (err) {
        if (this.stopped) return;
        this.setState('error', 'long-poll failed', String((err as Error).message ?? err));
        await sleep(Math.min(15_000, 1000 * 2 ** Math.min(this.retry++, 4)));
      }
    }
  }

  async send(env: Envelope): Promise<void> {
    const res = await fetch(`${this.base}/v1/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ envelopes: [env] }),
      signal: this.abort.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`relay rejected envelope: ${res.status} ${text}`.trim());
    }
    this.sent += 1;
  }

  async publishKeys(tag: string, payload: PreKeyPublish): Promise<void> {
    const res = await fetch(`${this.base}/v1/keys/${encodeURIComponent(tag)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: this.abort.signal,
    });
    if (!res.ok) throw new Error(`relay refused prekeys: ${res.status}`);
  }

  async fetchBundle(tag: string): Promise<FetchedBundle | null> {
    const res = await fetch(`${this.base}/v1/keys/${encodeURIComponent(tag)}`, {
      signal: this.abort.signal,
      headers: { accept: 'application/json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`relay key fetch failed: ${res.status}`);
    const data = (await res.json()) as { bundle: FetchedBundle };
    return data.bundle ?? null;
  }
}
