/**
 * MeshChat relay — a zero-knowledge mailbox.
 *
 * What it stores: routing tags, opaque ciphertexts, public prekey bundles.
 * What it never stores: identities, contact lists, plaintext, IPs (unless you
 * turn logging on), message metadata beyond size and arrival time.
 *
 * Deploy it anywhere that runs Node 20+: a VPS, a Raspberry Pi, Fly.io,
 * Railway, a free tier, or even a phone in Termux.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { initCrypto } from '../../core/src/sodium';
import { isEnvelope, verifyPow } from '../../core/src/envelope';
import type { Envelope } from '../../core/src/envelope';
import { Mailbox, KeyStore, type PublicBundle, type OneTimePreKey } from './mailbox';

export interface RelayConfig {
  port: number;
  host: string;
  name: string;
  version: string;
  /** Proof-of-work difficulty in leading zero bits; 0 disables it. */
  pow: number;
  ttlMs: number;
  maxEnvelopeBytes: number;
  maxPerTag: number;
  /** Requests per minute per IP for write endpoints. */
  rateLimit: number;
  /** Directory for the on-disk journal; empty = pure memory. */
  dataDir: string;
  staticDir: string;
  logRequests: boolean;
}

export const defaultConfig = (): RelayConfig => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    port: Number(process.env.MESHCHAT_PORT ?? 8787),
    host: process.env.MESHCHAT_HOST ?? '0.0.0.0',
    name: process.env.MESHCHAT_NAME ?? 'meshchat-relay',
    version: '0.1.0',
    pow: Number(process.env.MESHCHAT_POW ?? 16),
    ttlMs: Number(process.env.MESHCHAT_TTL_DAYS ?? 7) * 24 * 3600_000,
    maxEnvelopeBytes: Number(process.env.MESHCHAT_MAX_ENVELOPE ?? 96 * 1024),
    maxPerTag: Number(process.env.MESHCHAT_MAX_PER_TAG ?? 500),
    rateLimit: Number(process.env.MESHCHAT_RATE_LIMIT ?? 240),
    dataDir: process.env.MESHCHAT_DATA ?? '',
    staticDir: process.env.MESHCHAT_STATIC ?? path.resolve(here, '../public'),
    logRequests: process.env.MESHCHAT_LOG === '1',
  };
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

interface Waiter {
  tags: Map<string, number>;
  res: http.ServerResponse;
  done: boolean;
}

interface SocketSub {
  ws: WebSocket;
  tags: Set<string>;
  cursors: Map<string, number>;
  alive: boolean;
}

export class Relay {
  readonly mailbox: Mailbox;
  readonly keys = new KeyStore();
  readonly config: RelayConfig;
  readonly httpServer: http.Server;
  private wss: WebSocketServer;
  private waiters = new Set<Waiter>();
  private sockets = new Set<SocketSub>();
  private buckets = new Map<string, { tokens: number; updated: number }>();
  private journal = '';
  private timers: NodeJS.Timeout[] = [];
  stats = { envelopesIn: 0, envelopesOut: 0, rejected: 0, connections: 0, startedAt: Date.now() };

  constructor(config: RelayConfig) {
    this.config = config;
    this.mailbox = new Mailbox(config.maxPerTag);
    this.httpServer = http.createServer((req, res) => {
      this.route(req, res).catch((err) => {
        this.send(res, 500, { error: String(err?.message ?? err) });
      });
    });
    this.wss = new WebSocketServer({ noServer: true });
    this.httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://relay');
      if (url.pathname !== '/v1/ws') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.attachSocket(ws));
    });
    this.load();
  }

  // -------------------------------------------------------------- storage ---

  private load(): void {
    const dir = this.config.dataDir;
    if (!dir) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      this.journal = path.join(dir, 'envelopes.ndjson');
      if (fs.existsSync(this.journal)) {
        const text = fs.readFileSync(this.journal, 'utf8');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line) as { tag: string; seq: number; env: unknown; at: number };
            this.mailbox.load(entry);
          } catch {
            /* skip corrupt line */
          }
        }
      }
      const keysFile = path.join(dir, 'keys.json');
      if (fs.existsSync(keysFile)) {
        const dump = JSON.parse(fs.readFileSync(keysFile, 'utf8')) as Array<[string, never]>;
        this.keys.restore(dump);
      }
    } catch (err) {
      console.warn('meshchat relay: could not load data dir', (err as Error).message);
    }
  }

  private append(entry: { tag: string; seq: number; env: unknown; at: number }): void {
    if (!this.journal) return;
    try {
      fs.appendFile(this.journal, `${JSON.stringify(entry)}\n`, () => undefined);
    } catch {
      /* best effort */
    }
  }

  private compact(): void {
    if (!this.journal) return;
    try {
      const tmp = `${this.journal}.tmp`;
      const lines = this.mailbox.entries().map((e) => JSON.stringify(e));
      fs.writeFileSync(tmp, `${lines.join('\n')}${lines.length ? '\n' : ''}`);
      fs.renameSync(tmp, this.journal);
      fs.writeFileSync(path.join(this.config.dataDir, 'keys.json'), JSON.stringify(this.keys.dump()));
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- http ----

  private cors(res: http.ServerResponse): void {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-max-age', '86400');
  }

  private send(res: http.ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(json),
      'cache-control': 'no-store',
    });
    res.end(json);
  }

  private clientIp(req: http.IncomingMessage): string {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
    return req.socket.remoteAddress ?? 'unknown';
  }

  private allow(ip: string, cost = 1): boolean {
    const limit = this.config.rateLimit;
    if (limit <= 0) return true;
    const now = Date.now();
    const bucket = this.buckets.get(ip) ?? { tokens: limit, updated: now };
    const refill = ((now - bucket.updated) / 60_000) * limit;
    bucket.tokens = Math.min(limit, bucket.tokens + refill);
    bucket.updated = now;
    if (bucket.tokens < cost) {
      this.buckets.set(ip, bucket);
      return false;
    }
    bucket.tokens -= cost;
    this.buckets.set(ip, bucket);
    return true;
  }

  private async readJson(req: http.IncomingMessage, limit: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          reject(new Error('payload too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(text ? JSON.parse(text) : {});
        } catch (err) {
          reject(err as Error);
        }
      });
      req.on('error', reject);
    });
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://relay');
    const { pathname } = url;
    this.cors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === '/v1/health') {
      this.send(res, 200, {
        ok: true,
        name: this.config.name,
        version: this.config.version,
        pow: this.config.pow,
        ttlMs: this.config.ttlMs,
        maxEnvelopeBytes: this.config.maxEnvelopeBytes,
        envelopes: this.mailbox.envelopeCount,
        uptimeMs: Date.now() - this.stats.startedAt,
      });
      return;
    }

    if (pathname === '/v1/pull' && req.method === 'GET') {
      const tag = url.searchParams.get('tag') ?? '';
      const cursor = Number(url.searchParams.get('cursor') ?? 0);
      const { envelopes, cursor: next } = this.mailbox.since(tag, cursor, 200);
      this.stats.envelopesOut += envelopes.length;
      this.send(res, 200, { envelopes: envelopes.map((e) => e.env), cursor: { [tag]: next } });
      return;
    }

    if (pathname === '/v1/wait' && req.method === 'POST') {
      const body = (await this.readJson(req, 8192)) as { tags?: Record<string, number>; timeoutMs?: number };
      const tags = new Map<string, number>(Object.entries(body.tags ?? {}).slice(0, 32));
      const timeoutMs = Math.min(30_000, Math.max(1000, Number(body.timeoutMs ?? 20_000)));
      this.waitFor(tags, res, timeoutMs);
      return;
    }

    if (pathname === '/v1/send' && req.method === 'POST') {
      if (!this.allow(this.clientIp(req), 2)) {
        this.send(res, 429, { error: 'rate limited' });
        return;
      }
      const body = (await this.readJson(req, this.config.maxEnvelopeBytes * 4)) as { envelopes?: unknown[] };
      const list = Array.isArray(body.envelopes) ? body.envelopes.slice(0, 32) : [];
      let accepted = 0;
      let rejected = 0;
      for (const raw of list) {
        try {
          if (!isEnvelope(raw)) {
            rejected += 1;
            continue;
          }
          const env = raw as Envelope;
          if (Buffer.byteLength(JSON.stringify(env)) > this.config.maxEnvelopeBytes) {
            rejected += 1;
            continue;
          }
          if (!verifyPow(env, this.config.pow)) {
            rejected += 1;
            continue;
          }
          const added = this.mailbox.add(env.to, env);
          if (!added) {
            rejected += 1;
            continue;
          }
          accepted += 1;
          this.stats.envelopesIn += 1;
          this.append({ tag: env.to, seq: added.seq, env, at: Date.now() });
          this.notify(env.to);
        } catch (err) {
          console.warn('meshchat relay: rejected envelope', (err as Error).message);
          rejected += 1;
        }
      }
      this.stats.rejected += rejected;
      this.send(res, accepted ? 200 : 400, { ok: accepted > 0, accepted, rejected });
      return;
    }

    const keyMatch = /^\/v1\/keys\/([^/]+)$/.exec(pathname);
    if (keyMatch) {
      const tag = decodeURIComponent(keyMatch[1]);
      if (req.method === 'GET') {
        const record = this.keys.take(tag);
        if (!record) {
          this.send(res, 404, { error: 'no prekeys for this tag' });
          return;
        }
        this.send(res, 200, {
          bundle: { ...record.bundle, opk: record.opks[0] },
        });
        return;
      }
      if (req.method === 'POST') {
        if (!this.allow(this.clientIp(req))) {
          this.send(res, 429, { error: 'rate limited' });
          return;
        }
        const body = (await this.readJson(req, 64 * 1024)) as {
          bundle?: PublicBundle;
          opks?: OneTimePreKey[];
        };
        if (!body.bundle?.ik || !body.bundle.spk || !body.bundle.spkSig) {
          this.send(res, 400, { error: 'invalid bundle' });
          return;
        }
        const opks = Array.isArray(body.opks)
          ? body.opks.filter((o) => typeof o?.id === 'number' && typeof o?.pub === 'string').slice(0, 300)
          : [];
        this.keys.put(tag, body.bundle, opks);
        this.send(res, 200, { ok: true, opks: opks.length });
        return;
      }
    }

    if (pathname.startsWith('/v1/')) {
      this.send(res, 404, { error: 'unknown endpoint' });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      this.serveStatic(pathname, res);
      return;
    }

    this.send(res, 405, { error: 'method not allowed' });
  }

  // ------------------------------------------------------------ long poll ---

  private waitFor(tags: Map<string, number>, res: http.ServerResponse, timeoutMs: number): void {
    const immediate = this.collect(tags);
    if (immediate.envelopes.length) {
      this.send(res, 200, immediate);
      return;
    }
    const waiter: Waiter = { tags, res, done: false };
    this.waiters.add(waiter);
    const finish = () => {
      if (waiter.done) return;
      waiter.done = true;
      this.waiters.delete(waiter);
      const payload = this.collect(tags);
      if (!res.writableEnded) this.send(res, 200, payload);
    };
    const timer = setTimeout(finish, timeoutMs);
    res.on('close', () => {
      clearTimeout(timer);
      this.waiters.delete(waiter);
      waiter.done = true;
    });
    (waiter as Waiter & { finish?: () => void }).finish = finish;
  }

  private collect(tags: Map<string, number> | Set<string>): { envelopes: unknown[]; cursor: Record<string, number> } {
    const envelopes: unknown[] = [];
    const cursor: Record<string, number> = {};
    const entries = tags instanceof Map ? [...tags.entries()] : [...tags].map((t) => [t, 0] as [string, number]);
    for (const [tag, from] of entries) {
      const { envelopes: found, cursor: next } = this.mailbox.since(tag, from, 100);
      for (const e of found) envelopes.push(e.env);
      cursor[tag] = found.length ? next : from;
      if (tags instanceof Map && found.length) tags.set(tag, next);
    }
    return { envelopes, cursor };
  }

  private notify(tag: string): void {
    if (this.waiters.size) {
      for (const waiter of [...this.waiters]) {
        if (!waiter.tags.has(tag)) continue;
        const holder = waiter as Waiter & { finish?: () => void };
        holder.finish?.();
      }
    }
    for (const sub of this.sockets) {
      if (!sub.tags.has(tag)) continue;
      const { envelopes, cursor } = this.collect(new Map([[tag, sub.cursors.get(tag) ?? 0]]));
      if (!envelopes.length) continue;
      sub.cursors.set(tag, cursor[tag]);
      this.stats.envelopesOut += envelopes.length;
      this.sendSocket(sub, { type: 'env', envelopes, cursor });
    }
  }

  // --------------------------------------------------------------- sockets --

  private attachSocket(ws: WebSocket): void {
    const sub: SocketSub = { ws, tags: new Set(), cursors: new Map(), alive: true };
    this.sockets.add(sub);
    this.stats.connections += 1;
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as {
          type?: string;
          tags?: string[];
          cursors?: Record<string, number>;
          t?: number;
        };
        if (msg.type === 'sub' && Array.isArray(msg.tags)) {
          sub.tags = new Set(msg.tags.slice(0, 32));
          for (const [tag, cursor] of Object.entries(msg.cursors ?? {})) {
            sub.cursors.set(tag, Number(cursor) || 0);
          }
          const { envelopes, cursor } = this.collect(sub.tags);
          for (const [tag, value] of Object.entries(cursor)) sub.cursors.set(tag, value);
          if (envelopes.length) {
            this.stats.envelopesOut += envelopes.length;
            this.sendSocket(sub, { type: 'env', envelopes, cursor });
          }
          this.sendSocket(sub, { type: 'subscribed', tags: [...sub.tags] });
        } else if (msg.type === 'pong') {
          sub.alive = true;
        }
      } catch {
        /* ignore */
      }
    });
    ws.on('pong', () => {
      sub.alive = true;
    });
    ws.on('close', () => this.sockets.delete(sub));
    ws.on('error', () => this.sockets.delete(sub));
    this.sendSocket(sub, { type: 'hello', name: this.config.name, pow: this.config.pow });
  }

  private sendSocket(sub: SocketSub, payload: unknown): void {
    if (sub.ws.readyState !== 1) return;
    try {
      sub.ws.send(JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }

  // --------------------------------------------------------------- static ---

  private serveStatic(pathname: string, res: http.ServerResponse): void {
    const root = this.config.staticDir;
    let relative = decodeURIComponent(pathname).replace(/^\/+/, '');
    if (!relative) relative = 'index.html';
    let file = path.resolve(root, relative);
    if (!file.startsWith(path.resolve(root))) {
      this.send(res, 403, { error: 'forbidden' });
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (relative.includes('.')) {
        this.send(res, 404, { error: 'not found' });
        return;
      }
      file = path.join(root, 'index.html');
      if (!fs.existsSync(file)) {
        this.send(res, 503, {
          error: 'ui not built',
          hint: 'run `npm run build` (or `npm run build:app`) to produce packages/relay/public',
        });
        return;
      }
    }
    const ext = path.extname(file).toLowerCase();
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      /* ignore */
    }
    const headers: Record<string, string> = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      ...(size ? { 'content-length': String(size) } : {}),
      'cache-control': relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        "default-src 'self'; connect-src * ws: wss:; img-src 'self' data: blob:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; font-src 'self' data:; frame-ancestors *",
    };
    const stream = fs.createReadStream(file);
    res.writeHead(200, headers);
    stream.pipe(res);
    stream.on('error', () => res.end());
  }

  // ------------------------------------------------------------ lifecycle ---

  async listen(): Promise<void> {
    // PoW verification hashes with BLAKE2b from libsodium: without this the
    // relay would silently reject every envelope as malformed.
    await initCrypto();
    await new Promise<void>((resolve, reject) => {
      this.httpServer.listen(this.config.port, this.config.host, () => resolve());
      this.httpServer.on('error', reject);
    });
  }

  startTimers(): void {
    this.timers.push(
      setInterval(() => {
        const { removed } = this.mailbox.sweep(this.config.ttlMs);
        this.keys.sweep(this.config.ttlMs * 4);
        if (removed) this.compact();
      }, 60_000),
    );
    this.timers.push(
      setInterval(() => {
        for (const sub of this.sockets) {
          if (!sub.alive) {
            try {
              sub.ws.terminate();
            } catch {
              /* ignore */
            }
            this.sockets.delete(sub);
            continue;
          }
          sub.alive = false;
          try {
            sub.ws.ping();
          } catch {
            /* ignore */
          }
        }
      }, 30_000),
    );
    this.timers.push(setInterval(() => this.compact(), 10 * 60_000));
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const waiter of this.waiters) {
      if (!waiter.res.writableEnded) this.send(waiter.res, 200, { envelopes: [], cursor: {} });
    }
    this.waiters.clear();
    for (const sub of this.sockets) {
      try {
        sub.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.compact();
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
  }
}
