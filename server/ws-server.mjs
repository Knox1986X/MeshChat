// Производительная реализация RFC 6455 WebSocket без сторонних зависимостей:
//   1. MinimalWsServer — серверная обработка HTTP Upgrade, фрагментированных кадров, бинарных сообщений,
//      PING/PONG, кодов закрытия и жёсткого ограничения maxPayloadBytes против DoS.
//   2. MinimalWsClient — совместимый с браузерным API клиент для автотестов в Node 20 и прокси-моста Tor/I2P.

import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODE = Object.freeze({
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
});

/** Формирует RFC 6455 кадр (сервер -> клиент без маски, клиент -> сервер с 4-байтной маской) */
export function buildWsFrame(opcode, payloadBuf, { mask = false, fin = true } = {}) {
  const payload = Buffer.isBuffer(payloadBuf) ? payloadBuf : Buffer.from(payloadBuf || []);
  const len = payload.length;

  let headerLen = 2;
  if (len >= 126 && len <= 0xffff) headerLen += 2;
  else if (len > 0xffff) headerLen += 8;
  if (mask) headerLen += 4;

  const frame = Buffer.allocUnsafe(headerLen + len);
  frame[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);

  let offset = 2;
  if (len < 126) {
    frame[1] = (mask ? 0x80 : 0x00) | len;
  } else if (len <= 0xffff) {
    frame[1] = (mask ? 0x80 : 0x00) | 126;
    frame.writeUInt16BE(len, offset);
    offset += 2;
  } else {
    frame[1] = (mask ? 0x80 : 0x00) | 127;
    frame.writeBigUInt64BE(BigInt(len), offset);
    offset += 8;
  }

  if (mask) {
    const maskKey = crypto.randomBytes(4);
    maskKey.copy(frame, offset);
    offset += 4;
    for (let i = 0; i < len; i++) {
      frame[offset + i] = payload[i] ^ maskKey[i & 3];
    }
  } else if (len > 0) {
    payload.copy(frame, offset);
  }
  return frame;
}

/** Потоковый парсер входящих RFC 6455 кадров с защитой от переполнения памяти */
class WsFrameParser {
  constructor({ requireMask, maxPayloadBytes = 2 * 1024 * 1024, onFrame, onProtocolError }) {
    this.requireMask = Boolean(requireMask);
    this.maxPayloadBytes = maxPayloadBytes;
    this.onFrame = onFrame;
    this.onProtocolError = onProtocolError;

    this._buf = Buffer.alloc(0);
    this._fragOpcode = null;
    this._fragChunks = [];
    this._fragBytes = 0;
  }

  push(chunk) {
    this._buf = this._buf.length === 0 ? chunk : Buffer.concat([this._buf, chunk]);

    while (this._buf.length >= 2) {
      const b0 = this._buf[0];
      const b1 = this._buf[1];
      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;

      if (rsv !== 0) {
        return this._fail('Неподдерживаемые биты расширения RSV');
      }
      if (this.requireMask && !masked) {
        return this._fail('Клиентский кадр обязан быть замаскирован');
      }

      let offset = 2;
      if (payloadLen === 126) {
        if (this._buf.length < 4) return;
        payloadLen = this._buf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this._buf.length < 10) return;
        const bigLen = this._buf.readBigUInt64BE(2);
        if (bigLen > BigInt(this.maxPayloadBytes)) {
          return this._fail('Превышен допустимый размер WebSocket-кадра');
        }
        payloadLen = Number(bigLen);
        offset = 10;
      }

      if (payloadLen > this.maxPayloadBytes) {
        return this._fail('Превышен лимит maxPayloadBytes');
      }
      if (opcode >= 0x8 && (!fin || payloadLen > 125)) {
        return this._fail('Управляющий кадр не может быть фрагментирован или >125 Б');
      }

      const maskLen = masked ? 4 : 0;
      const totalFrameLen = offset + maskLen + payloadLen;
      if (this._buf.length < totalFrameLen) return;

      let data = Buffer.from(this._buf.subarray(offset + maskLen, totalFrameLen));
      if (masked) {
        const maskKey = this._buf.subarray(offset, offset + 4);
        for (let i = 0; i < data.length; i++) {
          data[i] ^= maskKey[i & 3];
        }
      }
      this._buf = this._buf.subarray(totalFrameLen);

      if (opcode >= 0x8) {
        this.onFrame(opcode, data);
        continue;
      }

      // Сборка фрагментированных кадров данных
      if (opcode === OPCODE.CONTINUATION) {
        if (this._fragOpcode === null) {
          return this._fail('Неожиданный кадр продолжения без начала сообщения');
        }
        this._fragBytes += data.length;
        if (this._fragBytes > this.maxPayloadBytes) {
          return this._fail('Суммарный размер фрагментов превысил maxPayloadBytes');
        }
        this._fragChunks.push(data);
        if (fin) {
          const full = Buffer.concat(this._fragChunks);
          const origOpcode = this._fragOpcode;
          this._fragOpcode = null;
          this._fragChunks = [];
          this._fragBytes = 0;
          this.onFrame(origOpcode, full);
        }
      } else {
        if (this._fragOpcode !== null) {
          return this._fail('Новый кадр данных до завершения предыдущего фрагмента');
        }
        if (fin) {
          this.onFrame(opcode, data);
        } else {
          this._fragOpcode = opcode;
          this._fragChunks = [data];
          this._fragBytes = data.length;
        }
      }
    }
  }

  _fail(reason) {
    this._buf = Buffer.alloc(0);
    this.onProtocolError(new Error(reason));
  }
}

/** Обёртка серверного клиентского соединения */
export class ServerWsConnection extends EventEmitter {
  constructor(socket, { maxPayloadBytes = 2 * 1024 * 1024, maxBackpressureBytes = 1024 * 1024 } = {}) {
    super();
    this.socket = socket;
    this.maxBackpressureBytes = maxBackpressureBytes;
    this.readyState = 1; // OPEN
    this.context = {};   // Пользовательский контекст (сессия и т.д. — без хранения реального IP!)

    this._parser = new WsFrameParser({
      requireMask: true,
      maxPayloadBytes,
      onFrame: (opcode, data) => this._handleFrame(opcode, data),
      onProtocolError: (err) => {
        this.close(1002, err.message);
      },
    });

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._parser.push(chunk));
    socket.on('close', () => {
      if (this.readyState !== 3) {
        this.readyState = 3;
        this.emit('close', 1006, '');
      }
    });
    socket.on('error', (err) => {
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
      try { socket.destroy(); } catch { /* ignore */ }
    });
  }

  get bufferedAmount() {
    return this.socket.writableLength || 0;
  }

  sendBinary(bytes) {
    if (this.readyState !== 1 || this.socket.destroyed) return false;
    if (this.bufferedAmount > this.maxBackpressureBytes) return false;
    const frame = buildWsFrame(OPCODE.BINARY, bytes, { mask: false });
    try {
      this.socket.write(frame);
      return true;
    } catch {
      return false;
    }
  }

  sendText(str) {
    if (this.readyState !== 1 || this.socket.destroyed) return false;
    const frame = buildWsFrame(OPCODE.TEXT, Buffer.from(String(str), 'utf8'), { mask: false });
    try {
      this.socket.write(frame);
      return true;
    } catch {
      return false;
    }
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    const reasonBuf = Buffer.from(String(reason).slice(0, 80), 'utf8');
    const body = Buffer.allocUnsafe(2 + reasonBuf.length);
    body.writeUInt16BE(code, 0);
    reasonBuf.copy(body, 2);
    try {
      this.socket.end(buildWsFrame(OPCODE.CLOSE, body, { mask: false }));
    } catch {
      this.socket.destroy();
    }
    this.readyState = 3;
    this.emit('close', code, reason);
  }

  _handleFrame(opcode, data) {
    if (opcode === OPCODE.BINARY) {
      this.emit('message', new Uint8Array(data.buffer, data.byteOffset, data.byteLength), true);
    } else if (opcode === OPCODE.TEXT) {
      this.emit('message', data.toString('utf8'), false);
    } else if (opcode === OPCODE.PING) {
      if (this.readyState === 1) {
        this.socket.write(buildWsFrame(OPCODE.PONG, data, { mask: false }));
      }
    } else if (opcode === OPCODE.CLOSE) {
      const code = data.length >= 2 ? data.readUInt16BE(0) : 1000;
      const reason = data.length > 2 ? data.subarray(2).toString('utf8') : '';
      this.close(code, reason);
    }
  }
}

/** Сервер WebSocket, подключаемый к стандартному http.Server */
export class MinimalWsServer extends EventEmitter {
  constructor({ path = '/ws', maxPayloadBytes = 2 * 1024 * 1024 } = {}) {
    super();
    this.path = path;
    this.maxPayloadBytes = maxPayloadBytes;
    this.clients = new Set();
  }

  attach(httpServer, { verifyUpgrade } = {}) {
    httpServer.on('upgrade', (req, socket, head) => {
      try {
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        if (this.path && parsedUrl.pathname !== this.path) {
          socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        const key = req.headers['sec-websocket-key'];
        const upgrade = (req.headers.upgrade || '').toLowerCase();
        if (upgrade !== 'websocket' || !key) {
          socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        if (typeof verifyUpgrade === 'function' && verifyUpgrade(req) === false) {
          socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }

        const accept = crypto
          .createHash('sha1')
          .update(key.trim() + WS_GUID)
          .digest('base64');

        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );

        const conn = new ServerWsConnection(socket, { maxPayloadBytes: this.maxPayloadBytes });
        this.clients.add(conn);
        conn.on('close', () => this.clients.delete(conn));

        if (head && head.length > 0) {
          conn._parser.push(head);
        }
        this.emit('connection', conn, req);
      } catch {
        socket.destroy();
      }
    });
  }
}

/**
 * Браузеро-совместимый WebSocket-клиент для Node.js 20+ (используется в тестах и прокси-мосте Tor/I2P).
 * Поддерживает передачу кастомного `createConnection` (например, сокета через SOCKS5 к .onion!).
 */
export class MinimalWsClient {
  constructor(url, { createConnection } = {}) {
    this.url = url;
    this.binaryType = 'arraybuffer';
    this.readyState = 0; // CONNECTING
    this._socket = null;

    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;

    this._connect(createConnection);
  }

  get bufferedAmount() {
    return this._socket?.writableLength || 0;
  }

  send(data) {
    if (this.readyState !== 1 || !this._socket) {
      throw new Error('WebSocket не в состоянии OPEN');
    }
    const isString = typeof data === 'string';
    const buf = isString
      ? Buffer.from(data, 'utf8')
      : Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength ?? data.length);
    const frame = buildWsFrame(isString ? OPCODE.TEXT : OPCODE.BINARY, buf, { mask: true });
    this._socket.write(frame);
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    if (!this._socket) {
      this.readyState = 3;
      return;
    }
    const r = Buffer.from(String(reason).slice(0, 80), 'utf8');
    const body = Buffer.allocUnsafe(2 + r.length);
    body.writeUInt16BE(code, 0);
    r.copy(body, 2);
    try {
      this._socket.end(buildWsFrame(OPCODE.CLOSE, body, { mask: true }));
    } catch {
      this._socket.destroy();
    }
  }

  _connect(createConnection) {
    const parsed = new URL(this.url);
    const isSecure = parsed.protocol === 'wss:';
    const mod = isSecure ? https : http;
    const wsKey = crypto.randomBytes(16).toString('base64');

    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (isSecure ? 443 : 80),
      path: (parsed.pathname || '/') + (parsed.search || ''),
      method: 'GET',
      createConnection,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': wsKey,
      },
    });

    req.on('upgrade', (res, socket, head) => {
      const expectedAccept = crypto.createHash('sha1').update(wsKey + WS_GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== expectedAccept) {
        socket.destroy();
        this._fail(new Error('Некорректный Sec-WebSocket-Accept от сервера'));
        return;
      }

      this._socket = socket;
      this.readyState = 1;
      socket.setNoDelay(true);

      const parser = new WsFrameParser({
        requireMask: false,
        onFrame: (opcode, payload) => {
          if (opcode === OPCODE.BINARY) {
            const ab = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
            this.onmessage?.({ data: this.binaryType === 'arraybuffer' ? ab : payload });
          } else if (opcode === OPCODE.TEXT) {
            this.onmessage?.({ data: payload.toString('utf8') });
          } else if (opcode === OPCODE.PING) {
            socket.write(buildWsFrame(OPCODE.PONG, payload, { mask: true }));
          } else if (opcode === OPCODE.CLOSE) {
            const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
            this.readyState = 3;
            socket.destroy();
            this.onclose?.({ code, reason: '' });
          }
        },
        onProtocolError: (err) => {
          this.onerror?.(err);
          socket.destroy();
        },
      });

      if (head && head.length > 0) parser.push(head);
      socket.on('data', (chunk) => parser.push(chunk));
      socket.on('close', () => {
        if (this.readyState !== 3) {
          this.readyState = 3;
          this.onclose?.({ code: 1006, reason: '' });
        }
      });
      socket.on('error', (err) => this._fail(err));

      this.onopen?.({});
    });

    req.on('response', (res) => {
      res.resume();
      this._fail(new Error(`Сервер отклонил WebSocket Upgrade: HTTP ${res.statusCode}`));
    });
    req.on('error', (err) => this._fail(err));
    req.end();
  }

  _fail(err) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onerror?.(err);
    this.onclose?.({ code: 1006, reason: err.message });
  }
}
