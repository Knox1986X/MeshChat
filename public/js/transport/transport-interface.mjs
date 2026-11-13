// Единый контракт транспорта (ITransport), базовый класс BaseTransport и мультиплексор RPC поверх транспорта.
// Любой транспорт (WebSocket, WebRTC, Tor, I2P или пользовательский плагин) обязан реализовывать:
//   connect(), send(bytes), onMessage(cb), close()

import { FRAME_TYPE, encodeFrame, decodeFrame } from '../../../shared/codec/binary-frame.mjs';

export const TRANSPORT_STATE = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DEGRADED: 'degraded',
  CLOSED: 'closed',
});

// Режимы политики маршрутизации, выбираемые пользователем в настройках
export const TRANSPORT_POLICY = Object.freeze({
  AUTO: 'auto',               // Прямой WS -> WebRTC P2P -> Tor -> I2P
  TOR_ONLY: 'tor-only',       // Строго через .onion (fail-closed: прямой выход в сеть запрещён)
  I2P_ONLY: 'i2p-only',       // Строго через .i2p (fail-closed)
  DIRECT_ONLY: 'direct-only', // Только прямое WSS-соединение
  P2P_FIRST: 'p2p-first',     // Приоритет прямого WebRTC mesh между пирами
});

/**
 * Базовый класс транспорта с подписками на сообщения/состояние и подсчётом метрик.
 */
export class BaseTransport {
  /**
   * @param {object} descriptor
   * @param {string} descriptor.id        Уникальный идентификатор транспорта ('ws', 'tor', 'i2p', 'webrtc')
   * @param {string} descriptor.title     Человекочитаемое название для UI
   * @param {'direct'|'p2p'|'tor'|'i2p'|'custom'} descriptor.kind Категория канала
   * @param {boolean} descriptor.exposesIp Раскрывает ли транспорт реальный IP клиента серверу/пиру
   */
  constructor({ id, title, kind = 'custom', exposesIp = true }) {
    if (!id || typeof id !== 'string') {
      throw new Error('Транспорт обязан иметь строковый идентификатор id');
    }
    this.id = id;
    this.title = title || id;
    this.kind = kind;
    this.exposesIp = Boolean(exposesIp);

    this.state = TRANSPORT_STATE.DISCONNECTED;
    this.rttMs = null;
    this.stats = {
      bytesSent: 0,
      bytesReceived: 0,
      messagesSent: 0,
      messagesReceived: 0,
      connectedAt: 0,
      failures: 0,
      lastError: null,
    };

    this._msgListeners = new Set();
    this._stateListeners = new Set();
  }

  /** Устанавливает соединение (переопределяется в конкретном транспорте) */
  async connect(_options = {}) {
    throw new Error(`Метод connect() не реализован в транспорте "${this.id}"`);
  }

  /** Отправляет сырой бинарный кадр Uint8Array (переопределяется в конкретном транспорте) */
  async send(_bytes) {
    throw new Error(`Метод send(bytes) не реализован в транспорте "${this.id}"`);
  }

  /** Закрывает соединение и освобождает таймеры/сокеты */
  async close(_reason = 'closed_by_client') {
    this._setState(TRANSPORT_STATE.CLOSED, { reason: _reason });
  }

  /** Подписка на входящие бинарные пакеты; возвращает функцию отписки */
  onMessage(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('onMessage ожидает функцию-обработчик');
    }
    this._msgListeners.add(callback);
    return () => this._msgListeners.delete(callback);
  }

  /** Подписка на смену состояния транспорта; возвращает функцию отписки */
  onStateChange(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('onStateChange ожидает функцию-обработчик');
    }
    this._stateListeners.add(callback);
    return () => this._stateListeners.delete(callback);
  }

  get isConnected() {
    return this.state === TRANSPORT_STATE.CONNECTED || this.state === TRANSPORT_STATE.DEGRADED;
  }

  _emitMessage(rawBytes) {
    const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    this.stats.bytesReceived += bytes.byteLength;
    this.stats.messagesReceived += 1;
    for (const cb of this._msgListeners) {
      try {
        cb(bytes, this);
      } catch (err) {
        console.error(`[transport:${this.id}] ошибка в обработчике onMessage:`, err);
      }
    }
  }

  _setState(nextState, detail = {}) {
    const prev = this.state;
    if (prev === nextState && !detail.force) return;
    this.state = nextState;
    if (nextState === TRANSPORT_STATE.CONNECTED) {
      this.stats.connectedAt = Date.now();
    }
    if (detail.error) {
      this.stats.failures += 1;
      this.stats.lastError = detail.error?.message || String(detail.error);
    }
    for (const cb of this._stateListeners) {
      try {
        cb(nextState, { prev, transportId: this.id, rttMs: this.rttMs, ...detail });
      } catch (err) {
        console.error(`[transport:${this.id}] ошибка в обработчике onStateChange:`, err);
      }
    }
  }
}

/** Проверяет, что экземпляр транспорта реализует обязательный контракт */
export function assertValidTransportInstance(instance) {
  for (const method of ['connect', 'send', 'onMessage', 'close']) {
    if (!instance || typeof instance[method] !== 'function') {
      throw new Error(`Некорректный плагин транспорта: отсутствует обязательный метод ${method}()`);
    }
  }
  return instance;
}

/**
 * Транспортно-независимый бинарный RPC и событийный мультиплексор.
 * Работает одинаково поверх WebSocketTransport, TorTransport, I2PTransport, WebRTC и FallbackTransport.
 */
export class TransportRpcChannel {
  constructor(transport, { defaultTimeoutMs = 20000 } = {}) {
    this.transport = assertValidTransportInstance(transport);
    this.defaultTimeoutMs = defaultTimeoutMs;
    this._seq = 0;
    this._pending = new Map();
    this._eventHandlers = new Map();

    this._unsubMsg = this.transport.onMessage((bytes) => this._handleIncomingBytes(bytes));
    this._unsubState = typeof this.transport.onStateChange === 'function'
      ? this.transport.onStateChange((state) => {
          if (state === TRANSPORT_STATE.CLOSED || state === TRANSPORT_STATE.DISCONNECTED) {
            this._rejectAllPending(new Error(`Транспорт перешёл в состояние ${state}`));
          }
        })
      : () => {};
  }

  /** Переключает RPC-мультиплексор на новый активный транспорт без потери подписок на события */
  attachTransport(nextTransport) {
    this._unsubMsg();
    this._unsubState();
    this.transport = assertValidTransportInstance(nextTransport);
    this._unsubMsg = this.transport.onMessage((bytes) => this._handleIncomingBytes(bytes));
    this._unsubState = typeof this.transport.onStateChange === 'function'
      ? this.transport.onStateChange((state) => {
          if (state === TRANSPORT_STATE.CLOSED || state === TRANSPORT_STATE.DISCONNECTED) {
            this._rejectAllPending(new Error(`Транспорт перешёл в состояние ${state}`));
          }
        })
      : () => {};
  }

  /** Вызов удалённого метода с опциональным бинарным телом (например, конвертом Sealed Sender) */
  request(method, params = {}, { body = null, timeoutMs = this.defaultTimeoutMs } = {}) {
    const id = (this._seq = (this._seq + 1) >>> 0) || 1;
    const frame = encodeFrame({
      type: FRAME_TYPE.RPC_REQ,
      id,
      meta: { m: method, p: params },
      body,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending.delete(id)) {
          reject(new Error(`Таймаут RPC "${method}" (${timeoutMs} мс)`));
        }
      }, timeoutMs);

      this._pending.set(id, { resolve, reject, timer });
      Promise.resolve(this.transport.send(frame)).catch((err) => {
        if (this._pending.delete(id)) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  /** Подписка на серверные push-события (например, 'mailbox.new') */
  onEvent(eventName, handler) {
    if (!this._eventHandlers.has(eventName)) {
      this._eventHandlers.set(eventName, new Set());
    }
    this._eventHandlers.get(eventName).add(handler);
    return () => this._eventHandlers.get(eventName)?.delete(handler);
  }

  destroy() {
    this._unsubMsg();
    this._unsubState();
    this._rejectAllPending(new Error('RPC-канал закрыт'));
    this._eventHandlers.clear();
  }

  _handleIncomingBytes(bytes) {
    let frame;
    try {
      frame = decodeFrame(bytes);
    } catch (err) {
      console.warn('[rpc] отброшен повреждённый кадр:', err.message);
      return;
    }

    // Игнорируем шумовые cover-пакеты и внутренние ping/pong транспорта
    if (frame.type === FRAME_TYPE.COVER || frame.type === FRAME_TYPE.PING || frame.type === FRAME_TYPE.PONG) {
      return;
    }

    if (frame.type === FRAME_TYPE.RPC_RES) {
      const waiter = this._pending.get(frame.id);
      if (!waiter) return;
      this._pending.delete(frame.id);
      clearTimeout(waiter.timer);
      if (frame.meta?.ok === false || frame.meta?.e) {
        waiter.reject(new Error(frame.meta.e || 'Ошибка выполнения запроса'));
      } else {
        waiter.resolve({ data: frame.meta?.r ?? null, body: frame.body });
      }
      return;
    }

    if (frame.type === FRAME_TYPE.EVENT) {
      const evName = frame.meta?.ev;
      const listeners = this._eventHandlers.get(evName);
      if (!listeners) return;
      for (const fn of listeners) {
        try {
          fn(frame.meta?.d ?? null, frame.body);
        } catch (err) {
          console.error(`[rpc] ошибка обработчика события "${evName}":`, err);
        }
      }
    }
  }

  _rejectAllPending(error) {
    for (const [, w] of this._pending) {
      clearTimeout(w.timer);
      w.reject(error);
    }
    this._pending.clear();
  }
}
