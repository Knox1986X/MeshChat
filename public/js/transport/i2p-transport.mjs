// Транспорт через анонимную сеть I2P (.b32.i2p / .i2p).
// Особенности:
//   - Строго проверяет домен .i2p и помечен exposesIp = false.
//   - Поддерживает микробатчинг исходящих кадров (batchWindowMs = 35 мс) для оптимальной работы
//     поверх I2P Streaming Library.
//   - Работает нативно в браузере с настроенным i2pd прокси либо через локальный мост 127.0.0.1:17700/i2p.

import { TRANSPORT_STATE } from './transport-interface.mjs';
import { transportRegistry } from './transport-registry.mjs';
import { WebSocketTransport } from './ws-transport.mjs';

const I2P_WS_RE = /^wss?:\/\/[a-z0-9.-]+\.i2p(:\d+)?(\/.*)?$/i;

export function isValidI2pWsUrl(url) {
  return I2P_WS_RE.test(String(url || '').trim());
}

export class I2PTransport extends WebSocketTransport {
  constructor(options = {}) {
    const inferredI2p = options.i2pUrl || I2PTransport.inferFromLocation();
    super({
      ...options,
      url: inferredI2p || 'ws://invalid.b32.i2p/ws',
      connectTimeoutMs: options.connectTimeoutMs ?? 35000,
      pingIntervalMs: options.pingIntervalMs ?? 35000,
      pongTimeoutMs: options.pongTimeoutMs ?? 18000,
      degradedRttMs: options.degradedRttMs ?? 6000,
      metaOverride: {
        id: 'i2p',
        title: 'I2P Invisible Internet (.i2p)',
        kind: 'i2p',
        exposesIp: false,
      },
    });

    this.i2pUrl = inferredI2p;
    this.localBridgeUrl = (options.localBridgeUrl || 'ws://127.0.0.1:17700').replace(/\/+$/, '');
    this.allowLocalBridge = options.allowLocalBridge !== false;
    this.connectionMode = null;
  }

  static inferFromLocation() {
    if (typeof location !== 'undefined' && location.hostname?.endsWith('.i2p')) {
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      return `${proto}${location.host}/ws`;
    }
    return '';
  }

  async connect({ signal } = {}) {
    if (!isValidI2pWsUrl(this.i2pUrl)) {
      const err = new Error('Для I2PTransport требуется корректный адрес вида ws://<addr>.b32.i2p/ws');
      this._setState(TRANSPORT_STATE.DISCONNECTED, { error: err });
      throw err;
    }

    const isOnI2p = typeof location !== 'undefined' && location.hostname?.endsWith('.i2p');
    const nativeTimeout = isOnI2p || !this.allowLocalBridge
      ? this.connectTimeoutMs
      : Math.min(3500, this.connectTimeoutMs);

    const savedTimeout = this.connectTimeoutMs;
    try {
      this.url = this.i2pUrl;
      this.connectTimeoutMs = nativeTimeout;
      await super.connect({ signal });
      this.connectionMode = 'native-i2p';
      return;
    } catch (nativeErr) {
      if (!this.allowLocalBridge || signal?.aborted) {
        this.connectTimeoutMs = savedTimeout;
        throw nativeErr;
      }
    } finally {
      this.connectTimeoutMs = savedTimeout;
    }

    this.url = `${this.localBridgeUrl}/i2p?target=${encodeURIComponent(this.i2pUrl)}`;
    await super.connect({ signal });
    this.connectionMode = 'local-socks5-bridge';
  }
}

transportRegistry.register({
  id: 'i2p',
  title: 'I2P (.b32.i2p)',
  description: 'Чесночная маршрутизация (Garlic Routing) через туннель i2pd',
  kind: 'i2p',
  exposesIp: false,
  priority: 40,
  connectTimeoutMs: 35000,
  isSupported: (cfg) => Boolean(isValidI2pWsUrl(cfg?.i2pUrl) || I2PTransport.inferFromLocation()),
  create: (cfg) => new I2PTransport(cfg),
});
