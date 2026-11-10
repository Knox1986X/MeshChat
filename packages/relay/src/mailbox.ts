/**
 * In-memory mailbox with optional on-disk durability.
 *
 * The relay understands three things only: a routing tag, an opaque envelope
 * and a timestamp. It never sees a sender, a recipient name, or any plaintext.
 */

export interface StoredEnvelope {
  seq: number;
  env: unknown;
  at: number;
}

export interface PublicBundle {
  v: 1;
  ik: string;
  spk: string;
  spkId: number;
  spkSig: string;
  ts?: number;
}

export interface OneTimePreKey {
  id: number;
  pub: string;
}

export class Mailbox {
  private tags = new Map<string, StoredEnvelope[]>();
  private seq = 0;

  constructor(
    private readonly maxPerTag = 500,
    private readonly maxTagLength = 64,
  ) {}

  get envelopeCount(): number {
    let n = 0;
    for (const list of this.tags.values()) n += list.length;
    return n;
  }

  get tagCount(): number {
    return this.tags.size;
  }

  add(tag: string, env: unknown, now = Date.now()): { seq: number; evicted: number } | null {
    if (!tag || tag.length > this.maxTagLength) return null;
    this.seq += 1;
    const list = this.tags.get(tag) ?? [];
    const stored: StoredEnvelope = { seq: this.seq, env, at: now };
    list.push(stored);
    let evicted = 0;
    while (list.length > this.maxPerTag) {
      list.shift();
      evicted += 1;
    }
    this.tags.set(tag, list);
    return { seq: this.seq, evicted };
  }

  since(tag: string, cursor: number, limit = 200): { envelopes: StoredEnvelope[]; cursor: number } {
    const list = this.tags.get(tag) ?? [];
    const fresh = list.filter((e) => e.seq > cursor).slice(0, limit);
    const nextCursor = fresh.length ? fresh[fresh.length - 1].seq : cursor;
    return { envelopes: fresh, cursor: nextCursor };
  }

  has(tag: string, cursor: number): boolean {
    const list = this.tags.get(tag);
    if (!list) return false;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].seq > cursor) return true;
    }
    return false;
  }

  /** IDs of envelopes currently stored under a tag (used for de-duplication). */
  idsFor(tag: string): Set<string> {
    const set = new Set<string>();
    for (const e of this.tags.get(tag) ?? []) {
      const env = e.env as { id?: string };
      if (env?.id) set.add(env.id);
    }
    return set;
  }

  sweep(ttlMs: number, now = Date.now()): { removed: number; tags: number } {
    let removed = 0;
    let touched = 0;
    for (const [tag, list] of this.tags) {
      const kept = list.filter((e) => now - e.at <= ttlMs);
      removed += list.length - kept.length;
      if (!kept.length) {
        this.tags.delete(tag);
        touched += 1;
      } else if (kept.length !== list.length) {
        this.tags.set(tag, kept);
        touched += 1;
      }
    }
    return { removed, tags: touched };
  }

  entries(): Array<{ tag: string } & StoredEnvelope> {
    const out: Array<{ tag: string } & StoredEnvelope> = [];
    for (const [tag, list] of this.tags) for (const e of list) out.push({ tag, ...e });
    return out;
  }

  load(entry: { tag: string; seq: number; env: unknown; at: number }): void {
    const list = this.tags.get(entry.tag) ?? [];
    list.push({ seq: entry.seq, env: entry.env, at: entry.at });
    this.tags.set(entry.tag, list);
    if (entry.seq > this.seq) this.seq = entry.seq;
  }

  get highWaterMark(): number {
    return this.seq;
  }
}

export interface KeyRecord {
  bundle: PublicBundle;
  opks: OneTimePreKey[];
  updatedAt: number;
}

/** Public prekey material. Anyone may read it; only the owner can sign a new one. */
export class KeyStore {
  private map = new Map<string, KeyRecord>();
  /** One-time prekeys already handed out, so a re-publish cannot revive them. */
  private consumed = new Map<string, Set<number>>();

  put(tag: string, bundle: PublicBundle, opks: OneTimePreKey[]): void {
    const existing = this.map.get(tag);
    // A routing tag belongs to exactly one identity key: no key substitution.
    if (existing && existing.bundle.ik !== bundle.ik) return;
    const consumed = this.consumed.get(tag) ?? new Set<number>();
    const merged = new Map<number, OneTimePreKey>();
    for (const opk of existing?.opks ?? []) merged.set(opk.id, opk);
    for (const opk of opks) if (!consumed.has(opk.id)) merged.set(opk.id, opk);
    const list = [...merged.values()].slice(-200);
    this.map.set(tag, { bundle, opks: list, updatedAt: Date.now() });
  }

  /** Atomically hand out the signed prekey plus one one-time prekey. */
  take(tag: string): KeyRecord | null {
    const record = this.map.get(tag);
    if (!record) return null;
    const opk = record.opks.shift();
    if (opk) {
      const set = this.consumed.get(tag) ?? new Set<number>();
      set.add(opk.id);
      this.consumed.set(tag, set);
    }
    return { bundle: record.bundle, opks: opk ? [opk] : [], updatedAt: record.updatedAt };
  }

  sweep(ttlMs: number, now = Date.now()): number {
    let removed = 0;
    for (const [tag, record] of this.map) {
      if (now - record.updatedAt > ttlMs) {
        this.map.delete(tag);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.map.size;
  }

  dump(): Array<[string, KeyRecord]> {
    return [...this.map.entries()];
  }

  restore(entries: Array<[string, KeyRecord]>): void {
    for (const [tag, record] of entries) this.map.set(tag, record);
  }
}
