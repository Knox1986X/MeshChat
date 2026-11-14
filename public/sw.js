// Автономный Service Worker MeshChat v2.1 (build 12).
// Кеширует только неизменяемую оболочку приложения (HTML/CSS/JS/WASM) для мгновенного старта офлайн.
// Никогда не кеширует /api/*, /local-ref, /downloads/* или зашифрованные вложения.

const CACHE_NAME = 'meshchat-shell-v12';
const CORE_SHELL = [
  '/',
  '/index.html',
  '/css/app.css?v=12',
  '/js/app.mjs?v=12',
  '/js/store/local-ref-store.mjs',
  '/js/ui/attachment-sheet.mjs',
  '/js/ui/atmosphere-layer.mjs',
  '/js/ui/settings-sections.mjs',
  '/js/transport/voice-relay-audio.mjs',
  '/icon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname === '/local-ref' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/downloads/') ||
    url.pathname.startsWith('/q/')
  ) {
    return;
  }

  // Стратегия Network-First с откатом к кешу при работе без интернета / в локальной сети
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
  );
});
