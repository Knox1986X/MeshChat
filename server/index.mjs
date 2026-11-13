// Главная точка входа сервера мессенджера (HTTP + RFC 6455 Binary WebSocket).
// Раздаёт статику с Brotli-сжатием, генерирует Service Worker офлайн-оболочки,
// принимает и отдаёт ТОЛЬКО зашифрованные на клиенте файлы (/api/blob) с поддержкой
// одноразового сжигания (once) и публикует обезличенные метрики (/api/health, /api/metrics).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { MinimalWsServer } from './ws-server.mjs';
import { PrivacyGate, PublicError, assertPublic } from './privacy-gate.mjs';
import { S3Mirror } from './s3-mirror.mjs';
import { BlindStorage, sha256B64 } from './storage.mjs';
import { AuthService } from './auth.mjs';
import { BlindRpcRouter } from './rpc.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const SHARED_DIR = path.join(PROJECT_ROOT, 'shared');

const MIME_TYPES = Object.freeze({
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
});

// Жёсткий CSP: никаких внешних скриптов, аналитики и шрифтов; разрешены только локальный WASM (Argon2id), Worker и сокеты
function buildCspHeader(env = process.env) {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob: data:",
    "connect-src 'self' http: https: ws: wss:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
  ];
  if (env.STRICT_FRAME === '1') {
    directives.push("frame-ancestors 'none'");
  }
  return directives.join('; ');
}

const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'geolocation=(), payment=(), usb=()',
});

const CORS_API_HEADERS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-veil-once, x-veil-burn-token, x-veil-ttl',
});

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    ...CORS_API_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBufferBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new PublicError(`Превышен допустимый размер тела запроса (${Math.round(maxBytes / 1048576)} МБ)`, 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, maxBytes = 256 * 1024) {
  const buf = await readBufferBody(req, maxBytes);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new PublicError('Некорректный JSON в теле запроса', 400);
  }
}

/** Вычисляет хеш сборки клиента и контрольную сумму APK для безопасного автообновления */
function buildReleaseDescriptor() {
  const pkgPath = path.join(PROJECT_ROOT, 'package.json');
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : { version: '1.1.0', versionCode: 2 };
  const assets = [];
  const hash = crypto.createHash('sha256');

  const walk = (baseDir, urlPrefix) => {
    if (!fs.existsSync(baseDir)) return;
    const entries = fs.readdirSync(baseDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(baseDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, `${urlPrefix}/${entry.name}`);
      } else {
        const relUrl = `${urlPrefix}/${entry.name}`;
        if (relUrl === '/sw.js') continue;
        assets.push(relUrl);
        hash.update(relUrl).update(fs.readFileSync(fullPath));
      }
    }
  };

  walk(PUBLIC_DIR, '');
  walk(SHARED_DIR, '/shared');
  const buildHash = hash.digest('hex').slice(0, 12);

  const apkPath = path.join(PROJECT_ROOT, 'MeshChat.apk');
  let apkAvailable = false;
  let apkSha256 = null;
  let apkSize = 0;
  if (fs.existsSync(apkPath)) {
    const apkBuf = fs.readFileSync(apkPath);
    apkAvailable = true;
    apkSize = apkBuf.length;
    apkSha256 = crypto.createHash('sha256').update(apkBuf).digest('hex');
  }

  return {
    app: 'MeshChat',
    version: pkg.version || '1.1.0',
    versionCode: Number(pkg.versionCode || 2),
    buildHash,
    assets,
    apkPath,
    apkAvailable,
    apkUrl: apkAvailable ? '/downloads/MeshChat.apk' : null,
    apkSha256,
    apkSize,
    githubRepo: 'Knox1986X/MeshChat',
  };
}

/** Собирает Service Worker с хешем всех файлов клиента и поддержкой мгновенного хот-апдейта */
function buildServiceWorkerScript(desc = buildReleaseDescriptor()) {
  const version = desc.buildHash;
  const assets = desc.assets;

  return `// Автосборка офлайн-кеша оболочки MeshChat, версия ${version}
const CACHE_NAME = 'meshchat-shell-${version}';
const SHELL_ASSETS = ${JSON.stringify(assets)};
const ASSET_SET = new Set(SHELL_ASSETS);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(SHELL_ASSETS.map((url) =>
        fetch(url, { cache: 'no-cache' }).then((res) => {
          if (res.ok) return cache.put(url, res);
        })
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('meshchat-shell-') || k.startsWith('veil-shell-')) && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!ASSET_SET.has(pathname)) return;
  event.respondWith(
    caches.open(CACHE_NAME)
      .then((cache) => cache.match(pathname))
      .then((cached) => cached || fetch(event.request))
  );
});
`;
}

/** Создаёт полный экземпляр сервера (удобно и для production, и для интеграционных тестов) */
export async function createMessengerServer(options = {}) {
  const env = options.env || process.env;
  const maxBlobBytes = Number(env.MAX_BLOB_MB || 50) * 1024 * 1024;
  const metricsToken = env.METRICS_TOKEN || '';
  const onionHostnameFile = env.TOR_HS_HOSTNAME_FILE || '/var/lib/tor/veil_hs/hostname';

  const privacyGate = new PrivacyGate({
    basePowBits: options.powBits ?? Number(env.POW_BITS || 14),
    trustProxy: env.TRUST_PROXY === '1' || Boolean(env.RENDER || env.FLY_APP_NAME),
  });
  const s3Mirror = new S3Mirror(env);
  const storage = new BlindStorage({
    dataDir: options.dataDir || env.DATA_DIR || path.join(PROJECT_ROOT, 'data'),
    s3Mirror,
  });
  await storage.init();

  const auth = new AuthService({ storage, privacyGate, env });
  const rpcRouter = new BlindRpcRouter({ storage, auth, privacyGate });
  const wsServer = new MinimalWsServer({ path: '/ws', maxPayloadBytes: 2 * 1024 * 1024 });

  const compressedCache = new Map();
  let cachedRelease = null;
  let cachedSw = null;

  const getReleaseInfo = () => {
    if (!cachedRelease) cachedRelease = buildReleaseDescriptor();
    return cachedRelease;
  };

  const getOnionAddress = () => {
    if (env.ONION_ADDRESS) return env.ONION_ADDRESS.trim();
    try {
      if (fs.existsSync(onionHostnameFile)) {
        return fs.readFileSync(onionHostnameFile, 'utf8').trim();
      }
    } catch { /* ignore */ }
    return null;
  };

  const serveStaticDir = (req, res, baseDir, relPath) => {
    const safeRel = path.normalize(relPath).replace(/^([/\\]*\.\.[/\\])+/, '');
    const fullPath = path.join(baseDir, safeRel);
    if (!fullPath.startsWith(baseDir) || !fs.existsSync(fullPath)) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end();
      return;
    }

    const ext = path.extname(fullPath).slice(1).toLowerCase();
    const etag = `"${stat.size}-${Math.round(stat.mtimeMs)}"`;
    const headers = {
      ...SECURITY_HEADERS,
      'content-type': MIME_TYPES[ext] || 'application/octet-stream',
      etag,
      'cache-control': fullPath.includes('/vendor/') ? 'public, max-age=604800, immutable' : 'no-cache',
    };
    if (ext === 'html') {
      headers['content-security-policy'] = buildCspHeader(env);
    }
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    const acceptEnc = String(req.headers['accept-encoding'] || '');
    if (/^(html|js|mjs|css|json|svg|webmanifest)$/.test(ext) && /\b(br|gzip)\b/.test(acceptEnc)) {
      const enc = /\bbr\b/.test(acceptEnc) ? 'br' : 'gzip';
      const cacheKey = `${enc}:${fullPath}:${etag}`;
      let compressed = compressedCache.get(cacheKey);
      if (!compressed) {
        const raw = fs.readFileSync(fullPath);
        compressed = enc === 'br'
          ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } })
          : zlib.gzipSync(raw, { level: 6 });
        compressedCache.set(cacheKey, compressed);
      }
      headers['content-encoding'] = enc;
      headers.vary = 'accept-encoding';
      headers['content-length'] = String(compressed.length);
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : compressed);
      return;
    }

    headers['content-length'] = String(stat.size);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(fullPath).pipe(res);
  };

  const httpServer = http.createServer(async (req, res) => {
    const reqCtx = privacyGate.inspectRequest(req);
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = parsedUrl.pathname;
    const isRead = req.method === 'GET' || req.method === 'HEAD';

    if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
      res.writeHead(204, { ...SECURITY_HEADERS, ...CORS_API_HEADERS });
      res.end();
      return;
    }

    try {
      // 1. Health-check и публичная конфигурация транспортов узла (.onion / .i2p зеркала)
      if (isRead && pathname === '/api/health') {
        const rel = getReleaseInfo();
        return sendJson(res, 200, {
          ok: true,
          app: 'MeshChat',
          version: rel.version,
          versionCode: rel.versionCode,
          buildHash: rel.buildHash,
          uptimeSec: Math.floor(process.uptime()),
          s3Enabled: s3Mirror.enabled,
          transports: {
            ws: true,
            onion: getOnionAddress(),
            i2p: env.I2P_ADDRESS || null,
          },
        });
      }

      // 1B. Дескриптор автообновления для Web/PWA и Android APK (с SHA-256 проверкой целостности)
      if (isRead && pathname === '/api/version') {
        const rel = getReleaseInfo();
        return sendJson(res, 200, {
          ok: true,
          app: rel.app,
          version: rel.version,
          versionCode: rel.versionCode,
          buildHash: rel.buildHash,
          apkAvailable: rel.apkAvailable,
          apkUrl: rel.apkUrl,
          apkSha256: rel.apkSha256,
          apkSize: rel.apkSize,
          githubRepo: rel.githubRepo,
        });
      }

      // 1C. Прямая раздача подписанного пакета MeshChat.apk с заголовком SHA-256
      if (isRead && (pathname === '/downloads/MeshChat.apk' || pathname === '/MeshChat.apk')) {
        const rel = getReleaseInfo();
        assertPublic(rel.apkAvailable && fs.existsSync(rel.apkPath), 'APK-пакет ещё не собран на этом узле', 404);
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          ...CORS_API_HEADERS,
          'content-type': 'application/vnd.android.package-archive',
          'content-disposition': 'attachment; filename="MeshChat.apk"',
          'content-length': String(rel.apkSize),
          'x-apk-sha256': rel.apkSha256 || '',
          'cache-control': 'no-cache',
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        fs.createReadStream(rel.apkPath).pipe(res);
        return;
      }

      // 2. Метрики Prometheus (без персональных данных и IP)
      if (req.method === 'GET' && pathname === '/api/metrics') {
        if (metricsToken) {
          const authHdr = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
          assertPublic(authHdr === metricsToken, 'Доступ к метрикам запрещён', 403);
        }
        const m = storage.getAnonymousMetrics();
        const mem = process.memoryUsage();
        const lines = [
          '# HELP veil_ws_connections_active Active WebSocket connections',
          '# TYPE veil_ws_connections_active gauge',
          `veil_ws_connections_active ${wsServer.clients.size}`,
          '# HELP veil_envelopes_queued_total Undelivered encrypted envelopes in blind mailboxes',
          '# TYPE veil_envelopes_queued_total gauge',
          `veil_envelopes_queued_total ${m.envelopesQueued}`,
          '# HELP veil_blobs_bytes_total Encrypted client blob storage bytes',
          '# TYPE veil_blobs_bytes_total gauge',
          `veil_blobs_bytes_total ${m.blobBytesTotal}`,
          '# HELP veil_process_rss_bytes Process RSS memory in bytes',
          '# TYPE veil_process_rss_bytes gauge',
          `veil_process_rss_bytes ${mem.rss}`,
        ].join('\n') + '\n';
        res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(lines);
        return;
      }

      // 3. REST-эндпоинты Zero-Knowledge аутентификации
      if (req.method === 'POST' && pathname === '/api/auth/pow') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, auth.requestPow(body.purpose, reqCtx));
      }
      if (req.method === 'POST' && pathname === '/api/auth/register') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, await auth.register(body, reqCtx));
      }
      if (req.method === 'POST' && pathname === '/api/auth/challenge') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, auth.issueLoginChallenge(body, reqCtx));
      }
      if (req.method === 'POST' && pathname === '/api/auth/login') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, await auth.verifyLogin(body, reqCtx));
      }

      // 4. Загрузка зашифрованного на клиенте файла (сервер принимает ТОЛЬКО шифртекст!)
      if (req.method === 'POST' && pathname === '/api/blob') {
        privacyGate.enforceLimit('blob-up', reqCtx.clientTag, 25, 60_000);
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        assertPublic(storage.verifySessionToken(token), 'Требуется авторизация для загрузки блоба', 401);

        const ctype = String(req.headers['content-type'] || '').toLowerCase();
        assertPublic(
          ctype.startsWith('application/octet-stream'),
          'Сервер принимает только зашифрованные бинарные блобы (application/octet-stream)',
          415
        );

        const once = req.headers['x-veil-once'] === '1';
        const burnToken = once ? crypto.randomBytes(20).toString('base64url') : '';
        const ttlSec = Number(req.headers['x-veil-ttl'] || 30 * 86400);
        const encryptedBytes = await readBufferBody(req, maxBlobBytes);
        assertPublic(encryptedBytes.length >= 28, 'Пустой или незашифрованный блоб отклонён');

        const saved = await storage.saveEncryptedBlob({
          bytes: encryptedBytes,
          once,
          burnToken,
          ttlSec,
        });
        return sendJson(res, 200, {
          blobId: saved.id,
          size: saved.size,
          sha256B64: saved.sha256B64,
          once: saved.once,
          burnToken: once ? burnToken : undefined,
          expiresAt: saved.expiresAt,
        });
      }

      // 5. Скачивание зашифрованного блоба (с физическим удалением для одноразовых фото/видео once!)
      if (req.method === 'GET' && pathname.startsWith('/api/blob/')) {
        privacyGate.enforceLimit('blob-dl', reqCtx.clientTag, 120, 60_000);
        const blobId = pathname.slice('/api/blob/'.length);
        assertPublic(/^b_[a-f0-9]{32}$/.test(blobId), 'Некорректный идентификатор блоба', 400);

        const found = await storage.readEncryptedBlob(blobId);
        assertPublic(found, 'Зашифрованный файл не найден или уже уничтожен', 404);

        const { record, buffer } = found;
        if (record.once) {
          const providedBurn = String(req.headers['x-veil-burn-token'] || parsedUrl.searchParams.get('burn') || '');
          assertPublic(
            providedBurn && sha256B64(providedBurn) === record.burnTokenHash,
            'Для одноразового медиа требуется действительный токен прочтения',
            403
          );
          // Немедленно уничтожаем файл с диска и из S3 сразу после отдачи!
          await storage.deleteEncryptedBlob(blobId);
        }

        res.writeHead(200, {
          ...SECURITY_HEADERS,
          ...CORS_API_HEADERS,
          'content-type': 'application/octet-stream',
          'content-length': String(buffer.length),
          'cache-control': record.once ? 'no-store' : 'private, max-age=86400, immutable',
          'content-security-policy': "default-src 'none'; sandbox",
        });
        res.end(buffer);
        return;
      }

      // 6. Гостевые REST-ручки E2E «Голой правды» (/q/<username>)
      if (req.method === 'GET' && pathname.startsWith('/api/ask/')) {
        privacyGate.enforceLimit('ask-info', reqCtx.clientTag, 60, 60_000);
        const uname = decodeURIComponent(pathname.slice('/api/ask/'.length)).replace(/^@/, '').toLowerCase();
        const target = storage.getUserByUsername(uname);
        assertPublic(target && target.askEnabled, 'Пользователь не найден или закрыл вопросы', 404);
        return sendJson(res, 200, {
          username: target.username,
          mailboxId: target.mailboxId,
          ikDhPub: target.identity.ikDhPub,
        });
      }

      if (req.method === 'POST' && pathname === '/api/ask/send') {
        privacyGate.enforceLimit('ask-send', reqCtx.clientTag, 8, 10 * 60_000);
        const body = await readJsonBody(req, 32 * 1024);
        privacyGate.verifyPowSolution(body.powChallenge, body.powNonce, 'ask');
        const target = storage.getUserByMailbox(String(body.mailboxId || ''));
        assertPublic(target && target.askEnabled, 'Получатель недоступен', 404);
        assertPublic(typeof body.payloadB64 === 'string' && body.payloadB64.length <= 8192, 'Некорректный шифртекст');

        const senderBlockTag = reqCtx.deriveSenderBlockTag(target.askSalt);
        const out = storage.enqueueAnonymousAsk({
          mailboxId: target.mailboxId,
          payloadB64: body.payloadB64,
          senderBlockTag,
        });
        if (!out.shadowed) {
          rpcRouter.pushToMailbox(target.mailboxId, 'ask.new', {
            id: out.id,
            payloadB64: body.payloadB64,
            senderBlockTag,
          });
        }
        return sendJson(res, 200, { ok: true });
      }

      // 7. Service Worker и маршруты приложения
      if (req.method === 'GET' && pathname === '/sw.js') {
        if (!cachedSw) cachedSw = buildServiceWorkerScript(getReleaseInfo());
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-cache',
          'service-worker-allowed': '/',
        });
        res.end(cachedSw);
        return;
      }

      if (isRead && pathname.startsWith('/q/')) {
        return serveStaticDir(req, res, PUBLIC_DIR, 'ask.html');
      }

      if (isRead && pathname.startsWith('/shared/')) {
        return serveStaticDir(req, res, SHARED_DIR, pathname.slice('/shared/'.length));
      }

      if (isRead && pathname.startsWith('/public/')) {
        return serveStaticDir(req, res, PUBLIC_DIR, pathname.slice('/public/'.length));
      }

      if (isRead) {
        const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
        return serveStaticDir(req, res, PUBLIC_DIR, rel);
      }

      sendJson(res, 404, { error: 'Маршрут не найден' });
    } catch (err) {
      if (err instanceof PublicError) {
        sendJson(res, err.statusCode, { error: err.message });
      } else {
        // Не выводим внутренние стектрейсы клиенту и не логируем тело запроса
        sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
      }
    }
  });

  wsServer.attach(httpServer, {
    verifyUpgrade: (req) => {
      try {
        const ctx = privacyGate.inspectRequest(req);
        privacyGate.enforceLimit('ws-conn', ctx.clientTag, 30, 60_000);
        return true;
      } catch {
        return false;
      }
    },
  });

  wsServer.on('connection', (conn, req) => rpcRouter.bindConnection(conn, req));

  return {
    httpServer,
    wsServer,
    storage,
    auth,
    privacyGate,
    rpcRouter,
    async listen(port = Number(env.PORT || 3000), host = env.HOST || '0.0.0.0') {
      await new Promise((resolve) => httpServer.listen(port, host, resolve));
      return httpServer.address();
    },
    async close() {
      for (const c of wsServer.clients) {
        c.close(1001, 'server_shutdown');
      }
      await new Promise((resolve) => httpServer.close(() => resolve()));
      auth.destroy();
      privacyGate.destroy();
      await storage.close();
    },
  };
}

// Автозапуск, если файл вызван напрямую (`node server/index.mjs`)
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const srv = await createMessengerServer();
  const addr = await srv.listen();
  console.log(`[meshchat-server] listening on ${addr.address}:${addr.port}`);

  const shutdown = async () => {
    await srv.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
