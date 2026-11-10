import type { Envelope } from '../envelope';

export type TransportKind = 'relay' | 'git' | 'local';
export type TransportState = 'off' | 'connecting' | 'online' | 'error';

export interface TransportInfo {
  /** Unique transport id, e.g. the relay URL or `git:owner/repo`. */
  id: string;
  kind: TransportKind;
  label: string;
  state: TransportState;
  detail?: string;
  lastError?: string;
  sent: number;
  received: number;
}

/**
 * A transport is just a courier: it moves opaque envelopes to and from a
 * mailbox. Adding a new one (Nostr, Matrix, IPFS, a mail server, a USB stick…)
 * means implementing this interface and nothing else.
 */
export interface Transport {
  readonly id: string;
  readonly kind: TransportKind;
  label: string;
  state: TransportState;
  detail?: string;
  lastError?: string;
  sent: number;
  received: number;

  start(): Promise<void>;
  stop(): void;
  /** Tell the transport which routing tags we care about. */
  watch(tags: string[]): void;
  /** Deposit an envelope. Throws when the courier is not available. */
  send(env: Envelope): Promise<void>;

  onEnvelope: ((env: Envelope, via: string) => void) | null;
  onState: ((transport: Transport) => void) | null;
}

export function transportInfo(t: Transport): TransportInfo {
  return {
    id: t.id,
    kind: t.kind,
    label: t.label,
    state: t.state,
    detail: t.detail,
    lastError: t.lastError,
    sent: t.sent,
    received: t.received,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
