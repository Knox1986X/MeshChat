/**
 * Local transport — same browser, different tabs/windows.
 *
 * Zero setup, zero network, zero server. Handy for trying MeshChat out, for
 * testing, and for a "second device" demo before you have a relay.
 */
import type { Envelope } from '../envelope';
import { isEnvelope } from '../envelope';
import type { Transport, TransportState } from './types';

const CHANNEL = 'meshchat/lan/v1';

export class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  readonly id = 'local';
  readonly label = 'this device';
  state: TransportState = 'off';
  detail?: string;
  lastError?: string;
  sent = 0;
  received = 0;
  onEnvelope: ((env: Envelope, via: string) => void) | null = null;
  onState: ((t: Transport) => void) | null = null;

  private channel: BroadcastChannel | null = null;
  private tags = new Set<string>();

  async start(): Promise<void> {
    if (typeof BroadcastChannel === 'undefined') {
      this.state = 'error';
      this.lastError = 'BroadcastChannel unavailable';
      this.onState?.(this);
      return;
    }
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (event: MessageEvent) => {
      const data = event.data as unknown;
      if (!isEnvelope(data)) return;
      if (!this.tags.has(data.to)) return;
      this.received += 1;
      this.onEnvelope?.(data, this.id);
    };
    this.state = 'online';
    this.detail = 'broadcast channel';
    this.onState?.(this);
  }

  stop(): void {
    this.channel?.close();
    this.channel = null;
    this.state = 'off';
    this.onState?.(this);
  }

  watch(tags: string[]): void {
    this.tags = new Set(tags);
  }

  async send(env: Envelope): Promise<void> {
    if (!this.channel) throw new Error('local transport is offline');
    this.channel.postMessage(env);
    this.sent += 1;
  }
}
