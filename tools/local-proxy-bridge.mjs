// Локальный SOCKS5-мост (127.0.0.1:17700) для подключения обычных браузеров (Chrome, Safari, Edge)
// к скрытым сервисам Tor (.onion) и I2P (.b32.i2p) без смены системных настроек прокси ОС.
//
// Безопасность:
//   - Слушает СТРОГО 127.0.0.1 (недоступен из локальной сети).
//   - Выполняет RFC 1928 SOCKS5 с ATYP = 0x03 (доменное имя резолвится внутри демона Tor/I2P,
//     никаких локальных DNS-запросов и DNS-утечек!).
//   - Автоматически пробует системный Tor (127.0.0.1:9050) и Tor Browser (127.0.0.1:9150),
//     а для I2P — демон i2pd SOCKS5 (127.0.0.1:4447).

import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ONION_HOST_RE = /^[a-z2-7]{56}\.onion$/i;
const I2P_HOST_RE = /^[a-z0-9.-]+\.i2p$/i;

/**
 * Открывает TCP-туннель через локальный SOCKS5-прокси (RFC 1928) с удалённым резолвингом имени (ATYP=0x03).
 */
export function connectViaSocks5({ proxyHost = '127.0.0.1', proxyPort, destHost, destPort, timeoutMs = 25000 }) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: proxyHost, port: proxyPort });
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(new Error(`Таймаут SOCKS5 (${proxyHost}:${proxyPort} -> ${destHost}:${destPort})`));
    }, timeoutMs);

    sock.once('error', fail);

    sock.once('connect', () => {
      // Шаг 1 RFC 1928: VER=5, NMETHODS=1, METHOD=0x00 (No Auth)
      sock.write(Buffer.from([0x05, 0x01, 0x00]));

      sock.once('data', (greetingResp) => {
        if (greetingResp.length < 2 || greetingResp[0] !== 0x05 || greetingResp[1] !== 0x00) {
          return fail(new Error('SOCKS5-прокси отклонил метод без аутентификации'));
        }

        // Шаг 2 RFC 1928: CMD=0x01 (CONNECT), RSV=0x00, ATYP=0x03 (DOMAINNAME)
        const hostBytes = Buffer.from(destHost, 'ascii');
        const req = Buffer.allocUnsafe(4 + 1 + hostBytes.length + 2);
        req[0] = 0x05;
        req[1] = 0x01;
        req[2] = 0x00;
        req[3] = 0x03;
        req[4] = hostBytes.length;
        hostBytes.copy(req, 5);
        req.writeUInt16BE(destPort, 5 + hostBytes.length);
        sock.write(req);

        let replyBuf = Buffer.alloc(0);
        const onReplyChunk = (chunk) => {
          replyBuf = Buffer.concat([replyBuf, chunk]);
          if (replyBuf.length < 4) return;
          if (replyBuf[0] !== 0x05 || replyBuf[1] !== 0x00) {
            sock.off('data', onReplyChunk);
            return fail(new Error(`SOCKS5 ошибка соединения с скрытым сервисом (код 0x${replyBuf[1].toString(16)})`));
          }

          const atyp = replyBuf[3];
          let needed = 4 + 2;
          if (atyp === 0x01) needed += 4;
          else if (atyp === 0x04) needed += 16;
          else if (atyp === 0x03) {
            if (replyBuf.length < 5) return;
            needed += 1 + replyBuf[4];
          } else {
            sock.off('data', onReplyChunk);
            return fail(new Error('Неизвестный ATYP в ответе SOCKS5'));
          }

          if (replyBuf.length < needed) return;
          sock.off('data', onReplyChunk);
          sock.off('error', fail);
          clearTimeout(timer);
          settled = true;

          const extra = replyBuf.subarray(needed);
          if (extra.length > 0) sock.unshift(extra);
          resolve(sock);
        };

        sock.on('data', onReplyChunk);
      });
    });
  });
}

/** Создаёт локальный HTTP Upgrade мост `ws://127.0.0.1:17700/{tor|i2p}?target=ws://...` */
export function createLocalProxyBridge({
  torSocksPorts = [9050, 9150],
  i2pSocksPorts = [4447],
  allowedOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i,
} = {}) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify({ ok: true, bridge: 'veil-socks5-bridge' }));
      return;
    }
    res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Upgrade Required');
  });

  server.on('upgrade', async (req, clientSocket, head) => {
    try {
      const origin = req.headers.origin || '';
      if (origin && allowedOriginPattern && !allowedOriginPattern.test(origin)) {
        clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        clientSocket.destroy();
        return;
      }

      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      const mode = parsed.pathname.replace(/^\/+/, ''); // 'tor' | 'i2p'
      const targetStr = parsed.searchParams.get('target') || '';
      const targetUrl = new URL(targetStr);

      if (targetUrl.protocol !== 'ws:') {
        throw new Error('Локальный мост принимает ws:// адрес скрытого сервиса');
      }

      let candidatePorts;
      let extraHeaderName = 'X-Veil-Transport';
      if (mode === 'tor') {
        if (!ONION_HOST_RE.test(targetUrl.hostname)) {
          throw new Error('Ожидался корректный 56-символьный адрес Tor v3 (.onion)');
        }
        candidatePorts = torSocksPorts;
      } else if (mode === 'i2p') {
        if (!I2P_HOST_RE.test(targetUrl.hostname)) {
          throw new Error('Ожидался корректный адрес скрытого сервиса .i2p');
        }
        candidatePorts = i2pSocksPorts;
      } else {
        throw new Error('Неизвестный маршрут моста (используйте /tor или /i2p)');
      }

      const destPort = Number(targetUrl.port || 80);
      let upstream = null;
      let lastErr = null;

      for (const pPort of candidatePorts) {
        try {
          upstream = await connectViaSocks5({
            proxyHost: '127.0.0.1',
            proxyPort: pPort,
            destHost: targetUrl.hostname,
            destPort,
          });
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!upstream) {
        throw lastErr || new Error(`Локальный демон ${mode.toUpperCase()} недоступен`);
      }

      // Пробрасываем исходный HTTP Upgrade запрос прямо внутрь туннеля .onion / .i2p
      const targetPath = (targetUrl.pathname || '/ws') + (targetUrl.search || '');
      const forwardLines = [
        `GET ${targetPath} HTTP/1.1`,
        `Host: ${targetUrl.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}`,
        `Sec-WebSocket-Version: ${req.headers['sec-websocket-version'] || '13'}`,
        `${extraHeaderName}: ${mode}`,
        '\r\n',
      ];
      upstream.write(forwardLines.join('\r\n'));
      if (head && head.length > 0) upstream.write(head);

      clientSocket.setNoDelay(true);
      upstream.setNoDelay(true);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);

      const cleanup = () => {
        clientSocket.destroy();
        upstream.destroy();
      };
      clientSocket.on('error', cleanup);
      upstream.on('error', cleanup);
      clientSocket.on('close', cleanup);
      upstream.on('close', cleanup);
    } catch (err) {
      try {
        clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n${err.message}`);
      } catch { /* ignore */ }
      clientSocket.destroy();
    }
  });

  return {
    server,
    async listen(port = Number(process.env.BRIDGE_PORT || 17700)) {
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
      return server.address();
    },
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const bridge = createLocalProxyBridge({ allowedOriginPattern: null });
  const addr = await bridge.listen();
  console.log(`[veil-bridge] SOCKS5 Tor/I2P bridge listening on 127.0.0.1:${addr.port}`);
}
