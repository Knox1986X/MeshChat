// Реализация прямого бинарного WebSocket-транспорта (WS / WSS).
// Особенности безопасности и скорости:
//   1. Никаких токенов в URL (?token=...) — исключена утечка сессии в логи reverse-proxy.
//   2. Чистый бинарный режим (binaryType = 'arraybuffer') без Base64.
//   3. Прикладной PING/PONG с замером RTT и детекцией «зависшего» мобильного NAT.
//   4. Защита от переполнения буфера отправки (backpressure) и опциональный Cover Traffic.

import {
  BaseTransport,
  TRANSPORT_STATE,
} from './transport-interface.mjs';
import { transportRegistry } from './transport-registry.mjs';
import {
  FRAME_TYPE,
  encodeFrame,
  decodeFrame,
  createCoverFrame,
} from '../../../shared/codec/binary-frame.mjs';

export class WebSocketTransport extends BaseTransport {
  /**
   * @param {object} options
   * @param {string} [options.url]                     Полный ws:// или wss:// адрес (по умолчанию от текущего хоста)
   * @param {number} [options.connectTimeoutMs=6000]   Таймаут рукопожатия
   * @param {number} [options.pingIntervalMs=20000]    Интервал замера RTT и проверки живости канала
   * @param {number} [options.pongTimeoutMs=8000]      Время ожидания PONG до перевода канала в DEGRADED/CLOSED
   * @param {number} [options.degradedRttMs=1800]      Порог RTT, выше которого транспорт помечается DEGRADED
   * @param {number} [options.maxBufferedBytes=524288] Лимит очереди сокета (512 КБ) против зависаний на 3G
   * @param {number} [options.coverTrafficIntervalMs=0] Интервал отправки шумовых 512 Б пакетов (0 = выкл)
   * @param {Function} [options.WebSocketImpl]         Конструктор WebSocket (для автотестов в Node 20)
   * @param {object} [options.metaOverride]            Переопределение метаданных для наследников (Tor/I2P)
   */
  constructor(options = {}) {
    super(
      options.metaOverride || {
        id: 'ws',
        title: 'Прямое соединение (WebSocket)',
        kind: 'direct',
        exposesIp: true,
      }
    );

    this.url = options.url || WebSocketTransport.defaultUrl();
    this.connectTimeoutMs = options.connectTimeoutMs ?? 6000;
    this.pingIntervalMs = options.pingIntervalMs ?? 20000;
    this.pongTimeoutMs = options.pongTimeoutMs ?? 8000;
    this.degradedRttMs = options.degradedRttMs ?? 1800;
    this.maxBufferedBytes = options.maxBufferedBytes ?? 512 * 1024;
    this.coverTrafficIntervalMs = options.coverTrafficIntervalMs ?? 0;
    this._WS = options.WebSocketImpl || globalThis.WebSocket;

    this._ws = null;
    this._pingTimer = null;
    this._pongTimer = null;
    this._coverTimer = null;
    this._pingSeq = 0;
    this._pendingPingSentAt = 0;
  }

  static defaultUrl() {
    if (typeof location !== 'undefined' && location.host) {
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      return `${proto}${location.host}/ws`;
    }
    return 'ws://127.0.0.1:3000/ws';
  }

  async connect({ signal } = {}) {
    if (this.state === TRANSPORT_STATE.CONNECTED) return;
    if (!this._WS) {
      throw new Error('Конструктор WebSocket недоступен в текущем окружении');
    }
    if (!this.url || !/^wss?:\/\//i.test(this.url)) {
      throw new Error(`Некорректный адрес WebSocket: "${this.url}"`);
    }

    await this._cleanupSocket();
    this._setState(TRANSPORT_STATE.CONNECTING);

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new this._WS(this.url);
      ws.binaryType = 'arraybuffer';
      this._ws = ws;

      const finishErr = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        this._cleanupSocket().finally(() => {
          this._setState(TRANSPORT_STATE.DISCONNECTED, { error: err });
          reject(err);
        });
      };

      const connectTimer = setTimeout(() => {
        finishErr(new Error(`Таймаут подключения ${this.id} (${this.connectTimeoutMs} мс)`));
      }, this.connectTimeoutMs);

      if (signal) {
        if (signal.aborted) {
          return finishErr(new Error('Подключение отменено через AbortSignal'));
        }
        signal.addEventListener('abort', () => finishErr(new Error('Подключение отменено')), { once: true });
      }

      ws.onopen = () => {
        if (settled || this._ws !== ws) return;
        settled = true;
        clearTimeout(connectTimer);
        this._startHeartbeat();
        this._startCoverTraffic();
        this._setState(TRANSPORT_STATE.CONNECTED);
        resolve();
      };

      ws.onmessage = (event) => {
        if (this._ws !== ws) return;
        this._onRawSocketMessage(event.data);
      };

      ws.onerror = () => {
        if (!settled) {
          finishErr(new Error(`Сетевая ошибка при подключении к ${this.url}`));
        }
      };

      ws.onclose = (ev) => {
        if (this._ws !== ws) return;
        this._stopTimers();
        this._ws = null;
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          const err = new Error(`Соединение закрыто во время рукопожатия (код ${ev?.code || 0})`);
          this._setState(TRANSPORT_STATE.DISCONNECTED, { error: err });
          reject(err);
          return;
        }
        if (this.state !== TRANSPORT_STATE.CLOSED) {
          this._setState(TRANSPORT_STATE.DISCONNECTED, { code: ev?.code || 1006, reason: ev?.reason || '' });
        }
      };
    });
  }

  async send(bytes) {
    if (!this._ws || this._ws.readyState !== 1) {
      throw new Error(`Транспорт "${this.id}" не подключён`);
    }
    const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const buffered = Number(this._ws.bufferedAmount || 0);
    if (buffered + payload.byteLength > this.maxBufferedBytes) {
      throw new Error(`Переполнен буфер отправки ${this.id} (${buffered} Б в очереди)`);
    }

    this._ws.send(payload);
    this.stats.bytesSent += payload.byteLength;
    this.stats.messagesSent += 1;
    return true;
  }

  async close(reason = 'closed_by_client') {
    this._setState(TRANSPORT_STATE.CLOSED, { reason });
    await this._cleanupSocket(1000, reason);
  }

  _onRawSocketMessage(data) {
    let bytes;
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else {
      return;
    }

    // Перехватываем внутренние кадры PING / PONG / COVER на уровне транспорта
    if (bytes.byteLength >= 8 && bytes[0] === 0x56) {
      const frameType = bytes[1];
      if (frameType === FRAME_TYPE.PING) {
        try {
          const ping = decodeFrame(bytes);
          const pong = encodeFrame({ type: FRAME_TYPE.PONG, id: ping.id, meta: ping.meta });
          if (this._ws?.readyState === 1) this._ws.send(pong);
        } catch { /* игнор некорректного пинга */ }
        return;
      }
      if (frameType === FRAME_TYPE.PONG) {
        clearTimeout(this._pongTimer);
        this._pongTimer = null;
        if (this._pendingPingSentAt > 0) {
          this.rttMs = Math.max(1, Math.round(Date.now() - this._pendingPingSentAt));
          this._pendingPingSentAt = 0;
          if (this.rttMs > this.degradedRttMs && this.state === TRANSPORT_STATE.CONNECTED) {
            this._setState(TRANSPORT_STATE.DEGRADED, { rttMs: this.rttMs });
          } else if (this.rttMs <= this.degradedRttMs && this.state === TRANSPORT_STATE.DEGRADED) {
            this._setState(TRANSPORT_STATE.CONNECTED, { rttMs: this.rttMs });
          }
        }
        return;
      }
      if (frameType === FRAME_TYPE.COVER) {
        this.stats.bytesReceived += bytes.byteLength;
        return;
      }
    }

    this._emitMessage(bytes);
  }

  _startHeartbeat() {
    this._stopTimers();
    if (this.pingIntervalMs <= 0) return;

    const sendPing = () => {
      if (!this._ws || this._ws.readyState !== 1) return;
      const id = ++this._pingSeq;
      this._pendingPingSentAt = Date.now();
      const frame = encodeFrame({ type: FRAME_TYPE.PING, id, meta: { t: this._pendingPingSentAt } });
      try {
        this._ws.send(frame);
      } catch {
        return;
      }
      clearTimeout(this._pongTimer);
      this._pongTimer = setTimeout(() => {
        if (!this._ws) return;
        // Соединение «зависло» без TCP FIN — закрываем сокет, чтобы FallbackTransport переключил канал
        this._setState(TRANSPORT_STATE.DEGRADED, { error: new Error('Превышено время ожидания PONG') });
        try { this._ws.close(4000, 'pong_timeout'); } catch { /* ignore */ }
      }, this.pongTimeoutMs);
    };

    // Первый замер RTT сразу после открытия, затем по интервалу
    setTimeout(sendPing, 50);
    this._pingTimer = setInterval(sendPing, this.pingIntervalMs);
  }

  _startCoverTraffic() {
    if (this.coverTrafficIntervalMs <= 0) return;
    this._coverTimer = setInterval(() => {
      if (!this._ws || this._ws.readyState !== 1) return;
      if ((this._ws.bufferedAmount || 0) > 0) return; // Если уже идут реальные данные, шум не тратим
      try {
        const frame = createCoverFrame(512);
        this._ws.send(frame);
      } catch { /* ignore */ }
    }, this.coverTrafficIntervalMs);
  }

  _stopTimers() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    if (this._pongTimer) { clearTimeout(this._pongTimer); this._pongTimer = null; }
    if (this._coverTimer) { clearInterval(this._coverTimer); this._coverTimer = null; }
  }

  async _cleanupSocket(code = 1000, reason = '') {
    this._stopTimers();
    const ws = this._ws;
    this._ws = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      if (ws.readyState === 0 || ws.readyState === 1) {
        ws.close(code, String(reason).slice(0, 60));
      }
    } catch { /* ignore */ }
  }
}

// Автоматическая регистрация плагина в глобальном реестре
transportRegistry.register({
  id: 'ws',
  title: 'Прямой WebSocket (WSS)',
  description: 'Быстрый бинарный канал к серверу с минимальной задержкой',
  kind: 'direct',
  exposesIp: true,
  priority: 10,
  connectTimeoutMs: 6000,
  create: (cfg) => new WebSocketTransport(cfg),
});
