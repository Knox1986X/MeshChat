/**
 * MeshChat engine — one object that owns identity, sessions, contacts,
 * messages and the set of transports. The UI only ever talks to this class.
 */
import {
  initCrypto,
  b64,
  concat,
  random,
  unb64,
} from './sodium';
import {
  createIdentity,
  encodeInvite,
  importIdentity,
  encodeInviteLink,
  exportIdentity,
  identityFromSeed,
  normalizeIdentity,
  parseInvite,
  routingTag,
  safetyNumber,
  shortId,
  type Identity,
  type Invite,
} from './identity';
import {
  createPreKeyState,
  findOpkSecret,
  findSignedPreKeySecret,
  markOpkUsed,
  maybeRotateSignedPreKey,
  ONE_TIME_PREKEY_COUNT,
  opkList,
  publicBundle,
  type PreKeyState,
} from './prekeys';
import { x3dhInitiate, x3dhRespond } from './x3dh';
import {
  ratchetDecrypt,
  ratchetEncrypt,
  ratchetInitInitiator,
  ratchetInitResponder,
  type RatchetMessage,
  type RatchetState,
} from './ratchet';
import {
  decodePayload,
  encodePayload,
  FILE_CHUNK_BYTES,
  MAX_FILE_BYTES,
  padFileChunk,
  unpadFileChunk,
  type Payload,
} from './protocol';
import {
  isEnvelope,
  newEnvelopeId,
  solvePow,
  type Envelope,
} from './envelope';
import type { KVStore } from './storage';
import { STATE_KEY } from './storage';
import { LocalTransport } from './transports/local';
import { GitTransport, type GitTransportConfig } from './transports/git';
import { RelayTransport, type FetchedBundle } from './transports/relay';
import { transportInfo, type Transport, type TransportInfo } from './transports/types';

export type MessageState = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ChatMessage {
  id: string;
  chat: string;
  dir: 'in' | 'out';
  ts: number;
  text?: string;
  file?: { name: string; mime: string; size: number; data: string };
  state: MessageState;
  transport?: string;
  expiresAt?: number;
  error?: string;
  system?: boolean;
}

export interface Preamble {
  ik: string;
  ek: string;
  opk?: number;
  spk?: number;
}

export interface Contact {
  tag: string;
  edPub: string;
  name: string;
  about?: string;
  relays: string[];
  addedAt: number;
  verified: boolean;
  blocked: boolean;
  ttl?: number;
  session?: RatchetState;
  preamble?: Preamble;
  sessionCreatedAt?: number;
  lastActivity: number;
  unread: number;
  renamed?: boolean;
}

export interface Settings {
  powDifficulty: number;
  typingIndicators: boolean;
  readReceipts: boolean;
  defaultTtl: number;
  sound: boolean;
  lang: 'ru' | 'en';
}

export interface ClientState {
  v: 1;
  identity: Identity;
  prekeys: PreKeyState;
  contacts: Contact[];
  messages: ChatMessage[];
  outbox: Array<{ env: Envelope; peer: string; attempts: number; createdAt: number; messageId?: string }>;
  relays: string[];
  git?: GitTransportConfig;
  settings: Settings;
  seen: string[];
  cursors: Record<string, Record<string, number>>;
}

export interface ContactView {
  tag: string;
  edPub: string;
  name: string;
  about?: string;
  relays: string[];
  verified: boolean;
  blocked: boolean;
  ttl?: number;
  unread: number;
  lastActivity: number;
  safetyNumber: string;
  shortId: string;
  hasSession: boolean;
  typing: boolean;
}

export interface Snapshot {
  identity: {
    name: string;
    edPub: string;
    tag: string;
    shortId: string;
    safetyNumber: string;
    createdAt: number;
    about?: string;
  };
  contacts: ContactView[];
  messages: ChatMessage[];
  transports: TransportInfo[];
  relays: string[];
  git: { owner: string; repo: string; branch: string } | null;
  settings: Settings;
  status: { online: boolean; outbox: number; queued: number; relayCount: number };
}

export type EngineEvent =
  | { type: 'change' }
  | { type: 'toast'; kind: 'info' | 'error' | 'success'; text: string }
  | { type: 'message'; message: ChatMessage };

export interface EngineOptions {
  /** Relay URLs to use for our own inbox. */
  relays?: string[];
  /** Called for every outgoing envelope so a UI can show PoW progress. */
  onPowProgress?: (frac: number) => void;
}

const SEEN_LIMIT = 6000;
const MESSAGE_LIMIT = 4000;
const OUTBOX_MAX_AGE = 24 * 3600_000;
const RETRY_INTERVAL = 8000;

const DEFAULT_SETTINGS: Settings = {
  powDifficulty: 0,
  typingIndicators: true,
  readReceipts: true,
  defaultTtl: 0,
  sound: true,
  lang: 'ru',
};

export class MeshChatClient {
  readonly state: ClientState;
  readonly storage: KVStore;
  private transports = new Map<string, Transport>();
  private listeners = new Set<(e: EngineEvent) => void>();
  private dhIndex = new Map<string, string>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private typingState = new Map<string, number>();
  private lastTypingSent = new Map<string, number>();
  private fileBuffers = new Map<string, { chunks: Uint8Array[]; total: number; name: string; mime: string; size: number }>();
  private powProgress: ((frac: number) => void) | undefined;
  private started = false;

  constructor(storage: KVStore, state: ClientState, opts: EngineOptions = {}) {
    this.storage = storage;
    this.state = state;
    this.powProgress = opts.onPowProgress;
  }

  // ------------------------------------------------------------ lifecycle --

  static async create(storage: KVStore, name: string, opts: EngineOptions = {}): Promise<MeshChatClient> {
    await initCrypto();
    const identity = createIdentity(name);
    const relayList = (opts.relays?.length ? opts.relays : ['http://localhost:8787']).map(normalizeUrl);
    const state: ClientState = {
      v: 1,
      identity,
      prekeys: createPreKeyState(identity),
      contacts: [],
      messages: [],
      outbox: [],
      relays: [...new Set(relayList)],
      settings: { ...DEFAULT_SETTINGS },
      seen: [],
      cursors: {},
    };
    const client = new MeshChatClient(storage, state, opts);
    await client.persistNow();
    return client;
  }

  static async load(storage: KVStore, opts: EngineOptions = {}): Promise<MeshChatClient | null> {
    await initCrypto();
    const raw = await storage.get(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClientState;
    if (parsed.v !== 1) throw new Error('unsupported local state version');
    parsed.identity = normalizeIdentity(parsed.identity);
    parsed.prekeys = createPreKeyState(parsed.identity, parsed.prekeys);
    parsed.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
    parsed.contacts ??= [];
    parsed.messages ??= [];
    parsed.outbox ??= [];
    parsed.seen ??= [];
    parsed.cursors ??= {};
    if (opts.relays?.length && parsed.relays.length === 0) {
      parsed.relays = [...new Set(opts.relays.map(normalizeUrl))];
    }
    return new MeshChatClient(storage, parsed, opts);
  }

  static async exists(storage: KVStore): Promise<boolean> {
    return (await storage.get(STATE_KEY)) !== null;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.rebuildIndex();
    await this.setupTransports();
    this.refreshWatching();
    this.publishPreKeys().catch(() => undefined);
    this.timers.push(setInterval(() => this.sweep(), 5000));
    this.timers.push(setInterval(() => this.retryOutbox(), RETRY_INTERVAL));
    this.timers.push(setInterval(() => this.publishPreKeys().catch(() => undefined), 10 * 60_000));
    this.sweep();
    this.emit({ type: 'change' });
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const transport of this.transports.values()) transport.stop();
    this.transports.clear();
    if (this.persistTimer) clearTimeout(this.persistTimer);
    await this.persistNow();
  }

  subscribe(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EngineEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* a broken listener must not break the engine */
      }
    }
  }

  // ----------------------------------------------------------- persistence --

  private persistSoon(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, 250);
  }

  async persistNow(): Promise<void> {
    if (this.state.messages.length > MESSAGE_LIMIT) {
      this.state.messages = this.state.messages.slice(-MESSAGE_LIMIT);
    }
    if (this.state.seen.length > SEEN_LIMIT) {
      this.state.seen = this.state.seen.slice(-SEEN_LIMIT);
    }
    await this.storage.set(STATE_KEY, JSON.stringify(this.state));
  }

  // ----------------------------------------------------------- transports ---

  private async setupTransports(): Promise<void> {
    const wanted = new Set(this.state.relays);
    for (const url of wanted) {
      if (!this.transports.has(`relay:${url}`)) this.addRelayTransport(url);
    }
    if (!this.transports.has('local')) {
      const local = new LocalTransport();
      this.registerTransport(local, 'local');
      void local.start();
    }
    if (this.state.git?.token) this.ensureGitTransport();
  }

  private registerTransport(transport: Transport, key: string): void {
    transport.onEnvelope = (env, via) => this.handleEnvelope(env, via);
    transport.onState = () => {
      this.persistSoon();
      this.emit({ type: 'change' });
      if (transport.state === 'online') void this.retryOutbox();
    };
    this.transports.set(key, transport);
  }

  private addRelayTransport(url: string): RelayTransport {
    const relay = new RelayTransport(url);
    this.registerTransport(relay, `relay:${url}`);
    void relay.start();
    return relay;
  }

  private ensureGitTransport(): GitTransport | null {
    if (!this.state.git?.token) return null;
    const key = `git:${this.state.git.owner}/${this.state.git.repo}`;
    const existing = this.transports.get(key);
    if (existing) return existing as GitTransport;
    const git = new GitTransport(this.state.git);
    this.registerTransport(git, key);
    void git.start();
    return git;
  }

  private refreshWatching(): void {
    const tags = [this.ownTag];
    for (const t of this.transports.values()) t.watch(tags);
  }

  get ownTag(): string {
    return routingTag(this.state.identity.edPub);
  }

  transportInfos(): TransportInfo[] {
    return [...this.transports.values()].map((t) => transportInfo(t));
  }

  private onlineTransports(): Transport[] {
    return [...this.transports.values()].filter((t) => t.state === 'online');
  }

  private relayTransports(): RelayTransport[] {
    return [...this.transports.values()].filter((t): t is RelayTransport => t.kind === 'relay');
  }

  // ------------------------------------------------------------ prekeys -----

  /** Probe relays that we have not heard from yet so PoW uses their policy. */
  private lastHealthCheck = 0;
  private async ensureRelayHealth(): Promise<void> {
    if (Date.now() - this.lastHealthCheck < 20_000) return;
    this.lastHealthCheck = Date.now();
    const unknown = this.relayTransports().filter((r) => !r.health);
    if (unknown.length) await Promise.allSettled(unknown.map((r) => r.probe()));
  }

  private powDifficulty(): number {
    if (this.state.settings.powDifficulty > 0) return this.state.settings.powDifficulty;
    let max = 0;
    for (const relay of this.relayTransports()) max = Math.max(max, relay.health?.pow ?? 0);
    return max || 12;
  }

  async publishPreKeys(force = false): Promise<void> {
    const { identity, prekeys } = this.state;
    if (maybeRotateSignedPreKey(identity, prekeys) || force) {
      // rotation happened, publish the new signed prekey below
    }
    const bundle = publicBundle(identity, prekeys);
    const payload = {
      bundle: { v: 1 as const, ik: bundle.ik, spk: bundle.spk, spkId: bundle.spkId, spkSig: bundle.spkSig, ts: bundle.ts },
      opks: opkList(prekeys),
    };
    await Promise.allSettled(this.relayTransports().map((r) => r.publishKeys(this.ownTag, payload)));
    this.persistSoon();
  }

  // ------------------------------------------------------------ contacts ----

  contact(tag: string): Contact | undefined {
    return this.state.contacts.find((c) => c.tag === tag);
  }

  contactByKey(edPub: string): Contact | undefined {
    return this.state.contacts.find((c) => c.edPub === edPub);
  }

  inviteUrl(): string {
    const invite: Invite = {
      v: 1,
      key: this.state.identity.edPub,
      name: this.state.identity.name,
      relays: this.state.relays,
      about: this.state.identity.about,
    };
    return encodeInvite(invite);
  }

  inviteLink(origin: string): string {
    const invite: Invite = {
      v: 1,
      key: this.state.identity.edPub,
      name: this.state.identity.name,
      relays: this.state.relays,
      about: this.state.identity.about,
    };
    return encodeInviteLink(invite, origin);
  }

  async addContact(input: string | Invite): Promise<Contact> {
    const invite = typeof input === 'string' ? parseInvite(input) : input;
    if (!invite) throw new Error('invalid invite link');
    if (invite.key === this.state.identity.edPub) throw new Error('this is your own invite');
    const existing = this.contactByKey(invite.key);
    if (existing) return existing;
    const contact: Contact = {
      tag: routingTag(invite.key),
      edPub: invite.key,
      name: invite.name || 'anonymous',
      about: invite.about,
      relays: invite.relays.map(normalizeUrl),
      addedAt: Date.now(),
      verified: false,
      blocked: false,
      lastActivity: Date.now(),
      unread: 0,
      ttl: this.state.settings.defaultTtl || undefined,
    };
    this.state.contacts.push(contact);
    this.persistSoon();
    this.emit({ type: 'change' });
    // Try to establish a session right away so we show up on their side.
    this.bootstrap(contact)
      .then(() => this.sendControl(contact, { t: 'profile', name: this.state.identity.name, about: this.state.identity.about, ts: Date.now() }))
      .catch(() => undefined);
    return contact;
  }

  async renameContact(tag: string, name: string): Promise<void> {
    const contact = this.contact(tag);
    if (!contact) return;
    contact.name = name.slice(0, 48);
    contact.renamed = true;
    this.persistSoon();
    this.emit({ type: 'change' });
  }

  async setVerified(tag: string, verified: boolean): Promise<void> {
    const contact = this.contact(tag);
    if (!contact) return;
    contact.verified = verified;
    this.persistSoon();
    this.emit({ type: 'change' });
  }

  async setBlocked(tag: string, blocked: boolean): Promise<void> {
    const contact = this.contact(tag);
    if (!contact) return;
    contact.blocked = blocked;
    this.persistSoon();
    this.emit({ type: 'change' });
  }

  async deleteContact(tag: string): Promise<void> {
    this.state.contacts = this.state.contacts.filter((c) => c.tag !== tag);
    this.state.messages = this.state.messages.filter((m) => m.chat !== tag);
    this.rebuildIndex();
    this.persistSoon();
    this.emit({ type: 'change' });
  }

  async setTtl(tag: string, ttlMs: number): Promise<void> {
    const contact = this.contact(tag);
    if (!contact) return;
    contact.ttl = ttlMs || undefined;
    this.persistSoon();
    this.emit({ type: 'change' });
  }

  // ------------------------------------------------------------- sessions ---

  private rebuildIndex(): void {
    this.dhIndex.clear();
    for (const contact of this.state.contacts) {
      if (!contact.session) continue;
      if (contact.session.dhr) this.dhIndex.set(contact.session.dhr, contact.tag);
      for (const skipped of contact.session.skipped) this.dhIndex.set(skipped.dh, contact.tag);
    }
  }

  private indexSession(contact: Contact): void {
    if (!contact.session) return;
    if (contact.session.dhr) this.dhIndex.set(contact.session.dhr, contact.tag);
    for (const skipped of contact.session.skipped) this.dhIndex.set(skipped.dh, contact.tag);
  }

  private async fetchBundle(contact: Contact): Promise<{ bundle: FetchedBundle; relay: string } | null> {
    const urls = [...new Set([...contact.relays, ...this.state.relays])];
    for (const url of urls) {
      const existing = [...this.transports.values()].find(
        (t) => t.kind === 'relay' && (t as RelayTransport).base === url,
      ) as RelayTransport | undefined;
      const relay = existing ?? new RelayTransport(url);
      try {
        const bundle = await relay.fetchBundle(contact.tag);
        if (!bundle) continue;
        if (bundle.ik !== contact.edPub) continue; // relay tried to swap keys
        return { bundle, relay: url };
      } catch {
        continue;
      }
    }
    return null;
  }

  private async bootstrap(contact: Contact): Promise<void> {
    if (contact.session) return;
    const found = await this.fetchBundle(contact);
    if (!found) throw new Error('contact is unreachable: no prekey bundle on any relay');
    const x3dh = x3dhInitiate(this.state.identity, found.bundle);
    contact.session = ratchetInitInitiator(x3dh.sk, x3dh.ekPub, x3dh.ekSec, x3dh.spk);
    contact.sessionCreatedAt = Date.now();
    contact.preamble = {
      ik: this.state.identity.edPub,
      ek: x3dh.ekPub,
      opk: x3dh.opkId,
      spk: x3dh.spkId,
    };
    this.indexSession(contact);
    this.persistSoon();
  }

  /** Force a brand new session (used when a message cannot be decrypted). */
  async resetSession(tag: string): Promise<void> {
    const contact = this.contact(tag);
    if (!contact) return;
    contact.session = undefined;
    contact.preamble = undefined;
    await this.bootstrap(contact);
    this.emit({ type: 'change' });
  }

  // -------------------------------------------------------------- sending ---

  private async seal(contact: Contact, payload: Payload): Promise<Envelope> {
    if (!contact.session) throw new Error('no session');
    await this.ensureRelayHealth();
    const rm = ratchetEncrypt(contact.session, encodePayload(payload));
    const env: Envelope = {
      v: 1,
      to: contact.tag,
      id: newEnvelopeId(),
      ts: Date.now(),
      k: contact.preamble ? 'p' : 'n',
      rm,
    };
    if (contact.preamble) {
      env.ik = contact.preamble.ik;
      env.ek = contact.preamble.ek;
      env.opk = contact.preamble.opk;
      env.spk = contact.preamble.spk;
      contact.preamble = undefined;
    }
    const difficulty = this.powDifficulty();
    if (difficulty > 0) {
      env.pow = await solvePow(env, difficulty, { onProgress: this.powProgress });
    }
    this.persistSoon();
    return env;
  }

  private async flush(env: Envelope): Promise<string[]> {
    const transports = this.onlineTransports();
    if (!transports.length) throw new Error('no transport available');
    const results = await Promise.allSettled(transports.map((t) => t.send(env)));
    const ok: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') ok.push(transports[i].id);
    });
    if (!ok.length) {
      const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      throw new Error(first ? String(first.reason?.message ?? first.reason) : 'all transports failed');
    }
    return ok;
  }

  private async deliver(peer: string, env: Envelope, messageId?: string): Promise<void> {
    try {
      const via = await this.flush(env);
      if (messageId) {
        const message = this.state.messages.find((m) => m.id === messageId);
        if (message) {
          message.state = 'sent';
          message.transport = via[0];
        }
      }
      this.persistSoon();
      this.emit({ type: 'change' });
    } catch (err) {
      this.state.outbox.push({ env, peer, attempts: 1, createdAt: Date.now(), messageId });
      if (messageId) {
        const message = this.state.messages.find((m) => m.id === messageId);
        if (message) {
          message.state = 'queued';
          message.error = (err as Error).message;
        }
      }
      this.persistSoon();
      this.emit({ type: 'change' });
    }
  }

  private async sendControl(contact: Contact, payload: Payload): Promise<void> {
    if (!contact.session) await this.bootstrap(contact);
    const env = await this.seal(contact, payload);
    await this.deliver(contact.tag, env);
  }

  async sendText(tag: string, text: string, replyTo?: string): Promise<ChatMessage> {
    const contact = this.contact(tag);
    if (!contact) throw new Error('unknown contact');
    const trimmed = text.replace(/\s+$/g, '');
    if (!trimmed) throw new Error('empty message');
    const id = b64(random(9));
    const ts = Date.now();
    const ttl = contact.ttl ?? (this.state.settings.defaultTtl || undefined);
    const message: ChatMessage = { id, chat: tag, dir: 'out', ts, text: trimmed, state: 'queued', expiresAt: ttl ? ts + ttl : undefined };
    this.state.messages.push(message);
    contact.lastActivity = ts;
    this.persistSoon();
    this.emit({ type: 'message', message });
    try {
      if (!contact.session) await this.bootstrap(contact);
      const env = await this.seal(contact, { t: 'msg', id, ts, text: trimmed, ttl, replyTo });
      await this.deliver(tag, env, id);
    } catch (err) {
      message.state = 'failed';
      message.error = (err as Error).message;
      this.persistSoon();
      this.emit({ type: 'change' });
      this.emit({ type: 'toast', kind: 'error', text: (err as Error).message });
    }
    return message;
  }

  async sendFile(tag: string, file: { name: string; mime: string; bytes: Uint8Array }): Promise<ChatMessage> {
    if (file.bytes.length > MAX_FILE_BYTES) throw new Error(`file too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)`);
    const contact = this.contact(tag);
    if (!contact) throw new Error('unknown contact');
    const id = b64(random(9));
    const ts = Date.now();
    const message: ChatMessage = {
      id,
      chat: tag,
      dir: 'out',
      ts,
      state: 'queued',
      file: { name: file.name, mime: file.mime, size: file.bytes.length, data: b64(file.bytes) },
      expiresAt: contact.ttl ? ts + contact.ttl : undefined,
    };
    this.state.messages.push(message);
    this.emit({ type: 'message', message });
    if (!contact.session) await this.bootstrap(contact);
    const total = Math.max(1, Math.ceil(file.bytes.length / FILE_CHUNK_BYTES));
    for (let i = 0; i < total; i++) {
      const slice = file.bytes.slice(i * FILE_CHUNK_BYTES, (i + 1) * FILE_CHUNK_BYTES);
      const env = await this.seal(contact, {
        t: 'file',
        id,
        ts,
        name: file.name,
        mime: file.mime,
        size: file.bytes.length,
        index: i,
        total,
        data: b64(padFileChunk(slice)),
        ttl: contact.ttl,
      });
      await this.deliver(tag, env, i === total - 1 ? id : undefined);
    }
    return message;
  }

  async sendTyping(tag: string, on: boolean): Promise<void> {
    if (!this.state.settings.typingIndicators) return;
    const contact = this.contact(tag);
    if (!contact?.session) return;
    const last = this.lastTypingSent.get(tag) ?? 0;
    if (on && Date.now() - last < 2500) return;
    this.lastTypingSent.set(tag, Date.now());
    try {
      const env = await this.seal(contact, { t: 'typing', on, ts: Date.now() });
      await this.deliver(tag, env);
    } catch {
      /* typing is best effort */
    }
  }

  // ------------------------------------------------------------ receiving ---

  private handleEnvelope(env: Envelope, via: string): void {
    if (!isEnvelope(env)) return;
    if (env.to !== this.ownTag) return;
    if (this.state.seen.includes(env.id)) return;
    this.state.seen.push(env.id);
    void this.processEnvelope(env, via).catch(() => undefined);
  }

  private async processEnvelope(env: Envelope, via: string): Promise<void> {
    try {
      if (env.k === 'p') {
        await this.processPreKeyEnvelope(env, via);
      } else {
        this.processNormalEnvelope(env, via);
      }
    } catch (err) {
      this.persistSoon();
    }
  }

  private async processPreKeyEnvelope(env: Envelope, via: string): Promise<void> {
    if (!env.ik || !env.ek) return;
    let contact = this.contactByKey(env.ik);
    if (!contact) {
      contact = {
        tag: routingTag(env.ik),
        edPub: env.ik,
        name: 'anonymous',
        relays: via.startsWith('http') ? [via] : [],
        addedAt: Date.now(),
        verified: false,
        blocked: false,
        lastActivity: Date.now(),
        unread: 0,
      };
      this.state.contacts.push(contact);
    }
    if (contact.blocked) return;
    const spk = findSignedPreKeySecret(this.state.prekeys, env.spk ?? this.state.prekeys.spk.id);
    if (!spk) return;
    const opkSec = env.opk !== undefined ? findOpkSecret(this.state.prekeys, env.opk) : undefined;
    const sk = x3dhRespond({
      identity: this.state.identity,
      spkSec: spk,
      opkSec,
      ikA: env.ik,
      ekA: env.ek,
    });
    if (env.opk !== undefined) markOpkUsed(this.state.prekeys, env.opk);
    const session = ratchetInitResponder(sk, this.state.prekeys.spk.pub, spk, env.ek);
    const plaintext = ratchetDecrypt(session, env.rm);
    contact.session = session;
    contact.sessionCreatedAt = Date.now();
    contact.preamble = undefined;
    this.indexSession(contact);
    this.applyPayload(contact, decodePayload(plaintext), env, via);
    this.persistSoon();
    this.emit({ type: 'change' });
  }

  private processNormalEnvelope(env: Envelope, via: string): void {
    const candidates: Contact[] = [];
    const hint = this.dhIndex.get(env.rm.dh);
    if (hint) {
      const c = this.contact(hint);
      if (c?.session) candidates.push(c);
    }
    for (const c of this.state.contacts) {
      if (c.session && !candidates.includes(c)) candidates.push(c);
    }
    for (const contact of candidates) {
      if (contact.blocked) continue;
      const snapshot = JSON.parse(JSON.stringify(contact.session)) as RatchetState;
      try {
        const plaintext = ratchetDecrypt(snapshot, env.rm);
        contact.session = snapshot;
        this.indexSession(contact);
        this.applyPayload(contact, decodePayload(plaintext), env, via);
        this.persistSoon();
        this.emit({ type: 'change' });
        return;
      } catch {
        continue;
      }
    }
    // Unknown sender: could be somebody who got our invite but whose session we
    // never established. Nothing to do without their prekey preamble.
  }

  private applyPayload(contact: Contact, payload: Payload, env: Envelope, via: string): void {
    contact.lastActivity = Date.now();
    switch (payload.t) {
      case 'msg': {
        if (this.state.messages.some((m) => m.id === payload.id)) return;
        const ttl = payload.ttl ?? contact.ttl ?? this.state.settings.defaultTtl;
        const message: ChatMessage = {
          id: payload.id,
          chat: contact.tag,
          dir: 'in',
          ts: payload.ts,
          text: payload.text,
          state: this.state.settings.readReceipts ? 'delivered' : 'sent',
          transport: via,
          expiresAt: ttl ? Date.now() + ttl : undefined,
        };
        this.state.messages.push(message);
        contact.unread += 1;
        this.emit({ type: 'message', message });
        void this.sendAck(contact, [payload.id], 'delivered');
        break;
      }
      case 'ack': {
        for (const id of payload.ids) {
          const message = this.state.messages.find((m) => m.id === id && m.dir === 'out');
          if (!message) continue;
          const rank: Record<MessageState, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: -1 };
          if (rank[payload.state] > rank[message.state]) message.state = payload.state;
        }
        break;
      }
      case 'typing': {
        this.typingState.set(contact.tag, payload.on ? Date.now() + 7000 : 0);
        break;
      }
      case 'profile': {
        if (!contact.renamed && payload.name) contact.name = payload.name.slice(0, 48);
        contact.about = payload.about;
        break;
      }
      case 'delete': {
        this.state.messages = this.state.messages.filter((m) => !payload.ids.includes(m.id));
        break;
      }
      case 'file': {
        this.receiveFileChunk(contact, payload, env, via);
        break;
      }
      case 'receipt-settings':
        break;
      default:
        break;
    }
  }

  private receiveFileChunk(contact: Contact, payload: Extract<Payload, { t: 'file' }>, env: Envelope, via: string): void {
    const key = `${contact.tag}:${payload.id}`;
    let buffer = this.fileBuffers.get(key);
    if (!buffer) {
      buffer = { chunks: new Array(payload.total).fill(null), total: payload.total, name: payload.name, mime: payload.mime, size: payload.size } as unknown as {
        chunks: Uint8Array[];
        total: number;
        name: string;
        mime: string;
        size: number;
      };
      this.fileBuffers.set(key, buffer);
    }
    try {
      buffer.chunks[payload.index] = unpadFileChunk(unb64(payload.data));
    } catch {
      return;
    }
    if (buffer.chunks.some((c) => !c)) return;
    this.fileBuffers.delete(key);
    const total = concat(...buffer.chunks);
    if (this.state.messages.some((m) => m.id === payload.id)) return;
    const message: ChatMessage = {
      id: payload.id,
      chat: contact.tag,
      dir: 'in',
      ts: payload.ts,
      file: { name: buffer.name, mime: buffer.mime, size: total.length, data: b64(total) },
      state: 'delivered',
      transport: via,
      expiresAt: payload.ttl ? Date.now() + payload.ttl : undefined,
    };
    this.state.messages.push(message);
    contact.unread += 1;
    this.emit({ type: 'message', message });
    void this.sendAck(contact, [payload.id], 'delivered');
  }

  private async sendAck(contact: Contact, ids: string[], state: 'delivered' | 'read'): Promise<void> {
    if (!contact.session) return;
    try {
      const env = await this.seal(contact, { t: 'ack', ids, state, ts: Date.now() });
      await this.deliver(contact.tag, env);
    } catch {
      /* acks are best effort */
    }
  }

  // ---------------------------------------------------------------- read ----

  async markRead(tag: string): Promise<void> {
    const contact = this.contact(tag);
    if (!contact || contact.unread === 0) return;
    const ids = this.state.messages.filter((m) => m.chat === tag && m.dir === 'in' && m.state !== 'read').map((m) => m.id);
    for (const m of this.state.messages) if (m.chat === tag && m.dir === 'in') m.state = 'read';
    contact.unread = 0;
    this.persistSoon();
    this.emit({ type: 'change' });
    if (this.state.settings.readReceipts && ids.length) void this.sendAck(contact, ids.slice(-50), 'read');
  }

  async deleteMessage(chat: string, id: string, forEveryone = false): Promise<void> {
    this.state.messages = this.state.messages.filter((m) => m.id !== id);
    const contact = this.contact(chat);
    if (forEveryone && contact?.session) void this.sendControl(contact, { t: 'delete', ids: [id], ts: Date.now() });
    this.persistSoon();
    this.emit({ type: 'change' });
  }

  async clearChat(tag: string): Promise<void> {
    this.state.messages = this.state.messages.filter((m) => m.chat !== tag);
    const contact = this.contact(tag);
    if (contact) contact.unread = 0;
    this.persistSoon();
    this.emit({ type: 'change' });
  }

  typingIn(tag: string): boolean {
    const until = this.typingState.get(tag) ?? 0;
    return until > Date.now();
  }

  // ----------------------------------------------------------- maintenance --

  private sweep(): void {
    const now = Date.now();
    let changed = false;
    const before = this.state.messages.length;
    this.state.messages = this.state.messages.filter((m) => !m.expiresAt || m.expiresAt > now);
    if (this.state.messages.length !== before) changed = true;
    const outboxBefore = this.state.outbox.length;
    this.state.outbox = this.state.outbox.filter((o) => now - o.createdAt < OUTBOX_MAX_AGE);
    if (this.state.outbox.length !== outboxBefore) changed = true;
    for (const [tag, until] of this.typingState) {
      if (until !== 0 && until < now) {
        this.typingState.delete(tag);
        changed = true;
      }
    }
    if (changed) {
      this.persistSoon();
      this.emit({ type: 'change' });
    }
    if (this.state.prekeys.opks.length < ONE_TIME_PREKEY_COUNT / 3) {
      createPreKeyState(this.state.identity, this.state.prekeys);
      void this.publishPreKeys();
    }
  }

  async retryOutbox(): Promise<void> {
    if (!this.state.outbox.length) return;
    const items = [...this.state.outbox];
    for (const item of items) {
      try {
        await this.flush(item.env);
        this.state.outbox = this.state.outbox.filter((o) => o !== item);
        const message = this.state.messages.find((m) => m.id === item.messageId);
        if (message) {
          message.state = 'sent';
          message.error = undefined;
        }
      } catch {
        item.attempts += 1;
        if (item.attempts > 200) this.state.outbox = this.state.outbox.filter((o) => o !== item);
      }
    }
    this.persistSoon();
    this.emit({ type: 'change' });
  }

  // ------------------------------------------------------------- settings ---

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.state.settings = { ...this.state.settings, ...patch };
    this.persistSoon();
    this.emit({ type: 'change' });
  }

  async setIdentityName(name: string): Promise<void> {
    this.state.identity.name = name.slice(0, 48);
    this.persistSoon();
    this.emit({ type: 'change' });
    for (const contact of this.state.contacts) {
      if (contact.session) {
        void this.sendControl(contact, { t: 'profile', name: this.state.identity.name, about: this.state.identity.about, ts: Date.now() });
      }
    }
  }

  async addRelay(url: string): Promise<void> {
    const normalized = normalizeUrl(url);
    if (this.state.relays.includes(normalized)) return;
    this.state.relays.push(normalized);
    if (!this.transports.has(`relay:${normalized}`)) this.addRelayTransport(normalized);
    this.refreshWatching();
    this.persistSoon();
    this.emit({ type: 'change' });
    await this.publishPreKeys(true).catch(() => undefined);
  }

  async removeRelay(url: string): Promise<void> {
    const normalized = normalizeUrl(url);
    this.state.relays = this.state.relays.filter((r) => r !== normalized);
    const transport = this.transports.get(`relay:${normalized}`);
    if (transport) {
      transport.stop();
      this.transports.delete(`relay:${normalized}`);
    }
    this.persistSoon();
    this.emit({ type: 'change' });
  }

  async setGitTransport(config: GitTransportConfig | null): Promise<void> {
    if (this.state.git) {
      const key = `git:${this.state.git.owner}/${this.state.git.repo}`;
      const existing = this.transports.get(key);
      existing?.stop();
      this.transports.delete(key);
    }
    this.state.git = config ?? undefined;
    this.persistSoon();
    if (config?.token) {
      const git = new GitTransport(config);
      this.registerTransport(git, `git:${config.owner}/${config.repo}`);
      git.watch([this.ownTag]);
      await git.start();
    }
    this.emit({ type: 'change' });
  }

  async probeRelays(): Promise<RelayTransport[]> {
    await Promise.all(this.relayTransports().map((r) => r.probe()));
    this.emit({ type: 'change' });
    return this.relayTransports();
  }

  // ---------------------------------------------------------------- misc ----

  exportBackup(passphrase: string): string {
    return exportIdentity(this.state.identity, passphrase);
  }

  async wipe(): Promise<void> {
    await this.stop();
    await this.storage.clear();
  }

  snapshot(): Snapshot {
    const typing = (tag: string) => this.typingIn(tag);
    return {
      identity: {
        name: this.state.identity.name,
        edPub: this.state.identity.edPub,
        tag: this.ownTag,
        shortId: shortId(this.state.identity.edPub),
        safetyNumber: safetyNumber(this.state.identity.edPub),
        createdAt: this.state.identity.createdAt,
        about: this.state.identity.about,
      },
      contacts: this.state.contacts.map((c) => ({
        tag: c.tag,
        edPub: c.edPub,
        name: c.name,
        about: c.about,
        relays: c.relays,
        verified: c.verified,
        blocked: c.blocked,
        ttl: c.ttl,
        unread: c.unread,
        lastActivity: c.lastActivity,
        safetyNumber: safetyNumber(c.edPub),
        shortId: shortId(c.edPub),
        hasSession: !!c.session,
        typing: typing(c.tag),
      })),
      messages: this.state.messages,
      transports: this.transportInfos(),
      relays: this.state.relays,
      git: this.state.git
        ? { owner: this.state.git.owner, repo: this.state.git.repo, branch: this.state.git.branch ?? 'meshchat' }
        : null,
      settings: this.state.settings,
      status: {
        online: this.onlineTransports().length > 0,
        outbox: this.state.outbox.length,
        queued: this.state.messages.filter((m) => m.state === 'queued').length,
        relayCount: this.relayTransports().length,
      },
    };
  }
}

export function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/** Rebuild a client from an identity backup string. */
export async function restoreClient(
  storage: KVStore,
  backup: string,
  passphrase: string,
  opts: EngineOptions = {},
): Promise<MeshChatClient> {
  await initCrypto();
  const identity = importIdentity(backup, passphrase);
  const state: ClientState = {
    v: 1,
    identity,
    prekeys: createPreKeyState(identity),
    contacts: [],
    messages: [],
    outbox: [],
    relays: (opts.relays?.length ? opts.relays : ['http://localhost:8787']).map(normalizeUrl),
    settings: { ...DEFAULT_SETTINGS },
    seen: [],
    cursors: {},
  };
  await storage.set(STATE_KEY, JSON.stringify(state));
  return new MeshChatClient(storage, state, opts);
}

export { identityFromSeed, parseInvite, routingTag, safetyNumber, shortId };
