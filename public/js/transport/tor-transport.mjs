// Транспорт через скрытый сервис Tor v3 (.onion).
// Гарантирует exposesIp = false и поддерживает два прозрачных режима подключения:
//   1. Нативный режим (Tor Browser / Orbot / браузер с SOCKS5) — прямое соединение с ws://<v3>.onion/ws.
//   2. Режим локального моста (обычный Chrome/Firefox/Safari) — через локальный SOCKS5-мост
//      ws://127.0.0.1:17700/tor?target=ws://<v3>.onion/ws (резолвинг .onion строго внутри демона Tor).

import { TRANSPORT_STATE } from './transport-interface.mjs';
import { transportRegistry } from './transport-registry.mjs';
import { WebSocketTransport } from './ws-transport.mjs';

const TOR_V3_ONION_RE = /^wss?:\/\/[a-z2-7]{56}\.onion(:\d+)?(\/.*)?$/i;

export function isValidOnionWsUrl(url) {
  return TOR_V3_ONION_RE.test(String(url || '').trim());
}

export class TorTransport extends WebSocketTransport {
  /**
   * @param {object} options
   * @param {string} [options.onionUrl]           Целевой адрес вида ws://<56симв>.onion/ws
   * @param {string} [options.localBridgeUrl]     Локальный SOCKS5-мост (по умолчанию ws://127.0.0.1:17700)
   * @param {boolean} [options.allowLocalBridge=true] Разрешить fallback на локальный SOCKS5-мост
   */
  constructor(options = {}) {
    const inferredOnion = options.onionUrl || TorTransport.inferFromLocation();
    super({
      ...options,
      url: inferredOnion || 'ws://invalid.onion/ws',
      connectTimeoutMs: options.connectTimeoutMs ?? 25000,
      pingIntervalMs: options.pingIntervalMs ?? 30000,
      pongTimeoutMs: options.pongTimeoutMs ?? 15000,
      degradedRttMs: options.degradedRttMs ?? 4500,
      metaOverride: {
        id: 'tor',
        title: 'Tor Hidden Service (.onion)',
        kind: 'tor',
        exposesIp: false, // IP клиента скрыт цепочкой Tor (3+ узла до точки рандеву)
      },
    });

    this.onionUrl = inferredOnion;
    this.localBridgeUrl = (options.localBridgeUrl || 'ws://127.0.0.1:17700').replace(/\/+$/, '');
    this.allowLocalBridge = options.allowLocalBridge !== false;
    this.connectionMode = null; // 'native-onion' | 'local-socks5-bridge'
  }

  static inferFromLocation() {
    if (typeof location !== 'undefined' && location.hostname?.endsWith('.onion')) {
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      return `${proto}${location.host}/ws`;
    }
    return '';
  }

  async connect({ signal } = {}) {
    if (!isValidOnionWsUrl(this.onionUrl)) {
      const err = new Error(
        'Для TorTransport требуется корректный 56-символьный адрес Tor v3 вида ws://<addr>.onion/ws'
      );
      this._setState(TRANSPORT_STATE.DISCONNECTED, { error: err });
      throw err;
    }

    // Попытка 1: прямое нативное подключение (работает в Tor Browser / Orbot без моста)
    // Если страница открыта в обычном клирнет-браузере и не на .onion, даём короткое окно 3.5 с перед мостом
    const isAlreadyOnOnion = typeof location !== 'undefined' && location.hostname?.endsWith('.onion');
    const nativeTimeout = isAlreadyOnOnion || !this.allowLocalBridge
      ? this.connectTimeoutMs
      : Math.min(3500, this.connectTimeoutMs);

    const savedTimeout = this.connectTimeoutMs;
    try {
      this.url = this.onionUrl;
      this.connectTimeoutMs = nativeTimeout;
      await super.connect({ signal });
      this.connectionMode = 'native-onion';
      return;
    } catch (nativeErr) {
      if (!this.allowLocalBridge || signal?.aborted) {
        this.connectTimeoutMs = savedTimeout;
        throw nativeErr;
      }
    } finally {
      this.connectTimeoutMs = savedTimeout;
    }

    // Попытка 2: подключение через локальный SOCKS5-мост 127.0.0.1:17700 -> Tor 127.0.0.1:9050/9150
    this.url = `${this.localBridgeUrl}/tor?target=${encodeURIComponent(this.onionUrl)}`;
    await super.connect({ signal });
    this.connectionMode = 'local-socks5-bridge';
  }
}

transportRegistry.register({
  id: 'tor',
  title: 'Tor (.onion v3)',
  description: 'Анонимная маршрутизация через скрытый сервис Tor без раскрытия IP серверу',
  kind: 'tor',
  exposesIp: false,
  priority: 30,
  connectTimeoutMs: 25000,
  isSupported: (cfg) => Boolean(isValidOnionWsUrl(cfg?.onionUrl) || TorTransport.inferFromLocation()),
  create: (cfg) => new TorTransport(cfg),
});
