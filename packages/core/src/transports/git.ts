/**
 * Git transport — a GitHub repository as a free, permanent, auditable mailbox.
 *
 * The trick a friend of mine uses: a public repo is free storage with an API.
 * Each party drops encrypted envelopes into `box/<routing-tag>/`, the other
 * party polls its own folder and deletes what it consumed. No relay to host,
 * no server to pay for, and the transport lives as long as the repo does.
 *
 * You need a fine-grained token with "Contents: read & write" on that single
 * repo. It never leaves your device (stored locally, excluded from backups by
 * default). Only ciphertext ever reaches GitHub.
 */
import type { Envelope } from '../envelope';
import { isEnvelope } from '../envelope';
import type { Transport, TransportState } from './types';
import { sleep } from './types';

export interface GitTransportConfig {
  owner: string;
  repo: string;
  token: string;
  branch?: string;
  /** Folder inside the repo, default `box`. */
  path?: string;
  /** Polling interval, ms. */
  pollMs?: number;
  /** Delete envelopes after reading (default true, keeps the repo clean). */
  consume?: boolean;
}

interface ContentsEntry {
  name: string;
  path: string;
  sha: string;
  size: number;
}

const API = 'https://api.github.com';

export class GitTransport implements Transport {
  readonly kind = 'git' as const;
  readonly id: string;
  label: string;
  state: TransportState = 'off';
  detail?: string;
  lastError?: string;
  sent = 0;
  received = 0;
  onEnvelope: ((env: Envelope, via: string) => void) | null = null;
  onState: ((t: Transport) => void) | null = null;

  readonly config: Required<GitTransportConfig>;
  private tags = new Set<string>();
  private seen = new Set<string>();
  private stopped = true;
  private loop: Promise<void> | null = null;
  private rateRemaining: number | null = null;
  private lastPoll = 0;

  constructor(config: GitTransportConfig) {
    this.config = {
      branch: 'meshchat',
      path: 'box',
      pollMs: 7000,
      consume: true,
      ...config,
    } as Required<GitTransportConfig>;
    this.id = `git:${this.config.owner}/${this.config.repo}#${this.config.branch}`;
    this.label = `github:${this.config.owner}/${this.config.repo}`;
  }

  private headers(): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.config.token}`,
      'x-github-api-version': '2022-11-28',
    };
  }

  private url(path: string): string {
    return `${API}/repos/${this.config.owner}/${this.config.repo}${path}`;
  }

  private setState(state: TransportState, detail?: string, error?: string): void {
    this.state = state;
    if (detail !== undefined) this.detail = detail;
    if (error !== undefined) this.lastError = error;
    this.onState?.(this);
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.setState('connecting', 'checking repository');
    try {
      const res = await fetch(this.url(''), { headers: this.headers() });
      if (res.status === 401 || res.status === 403) throw new Error('token rejected or missing permissions');
      if (res.status === 404) throw new Error('repository not found (or token lacks access)');
      if (!res.ok) throw new Error(`github ${res.status}`);
      this.rateRemaining = Number(res.headers.get('x-ratelimit-remaining') ?? NaN) || null;
      this.setState('online', 'git mailbox');
      this.loop = this.pollLoop();
    } catch (err) {
      this.setState('error', 'git unavailable', (err as Error).message);
    }
  }

  stop(): void {
    this.stopped = true;
    this.loop = null;
    this.setState('off', 'stopped');
  }

  watch(tags: string[]): void {
    this.tags = new Set(tags);
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      const tags = [...this.tags];
      for (const tag of tags) {
        if (this.stopped) return;
        try {
          await this.pollTag(tag);
        } catch (err) {
          this.setState('error', 'git poll failed', (err as Error).message);
        }
      }
      this.lastPoll = Date.now();
      const backoff = this.state === 'error' ? Math.min(60_000, this.config.pollMs * 4) : this.config.pollMs;
      await sleep(backoff);
      if (this.stopped) return;
      if (this.state === 'error') this.setState('online', 'git mailbox');
    }
  }

  private async pollTag(tag: string): Promise<void> {
    const dir = `${this.config.path}/${tag}`;
    const listRes = await fetch(
      this.url(`/contents/${encodeURIComponent(dir).replace(/%2F/g, '/')}?ref=${encodeURIComponent(this.config.branch)}`),
      { headers: this.headers() },
    );
    if (listRes.status === 404) {
      this.setState('online', 'git mailbox');
      return;
    }
    if (listRes.status === 403) throw new Error('github rate limit hit');
    if (!listRes.ok) throw new Error(`list ${listRes.status}`);
    const entries = (await listRes.json()) as ContentsEntry[] | ContentsEntry;
    const files = Array.isArray(entries) ? entries : [entries];
    for (const file of files) {
      if (this.stopped) return;
      if (!file?.name?.endsWith('.json')) continue;
      if (this.seen.has(file.path)) continue;
      this.seen.add(file.path);
      const rawRes = await fetch(this.url(`/contents/${file.path}?ref=${encodeURIComponent(this.config.branch)}`), {
        headers: { ...this.headers(), accept: 'application/vnd.github.raw' },
      });
      if (!rawRes.ok) {
        this.seen.delete(file.path);
        continue;
      }
      const text = await rawRes.text();
      let env: Envelope;
      try {
        env = JSON.parse(text) as Envelope;
      } catch {
        continue;
      }
      if (!isEnvelope(env)) continue;
      this.received += 1;
      this.onEnvelope?.(env, this.id);
      if (this.config.consume) {
        await fetch(this.url(`/contents/${file.path}`), {
          method: 'DELETE',
          headers: this.headers(),
          body: JSON.stringify({
            message: `meshchat: consume envelope`,
            sha: file.sha,
            branch: this.config.branch,
          }),
        }).catch(() => undefined);
      }
    }
    if (this.state !== 'online') this.setState('online', 'git mailbox');
  }

  async send(env: Envelope): Promise<void> {
    const path = `${this.config.path}/${env.to}/${env.id}.json`;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(env))));
    const put = () =>
      fetch(this.url(`/contents/${path}`), {
        method: 'PUT',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({
          message: `meshchat: envelope ${env.id.slice(0, 6)}`,
          content,
          branch: this.config.branch,
        }),
      });
    let res = await put();
    if (res.status === 409) {
      // branch moved under us (another writer) — retry once
      await sleep(300);
      res = await put();
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`git send failed: ${res.status} ${body.slice(0, 120)}`);
    }
    this.sent += 1;
    if (this.state !== 'online') this.setState('online', 'git mailbox');
  }
}
