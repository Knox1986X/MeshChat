// Точка входа браузерного клиента:
//   - монтирование Preact-приложения (<65 КБ в сжатом виде),
//   - регистрация офлайн Service Worker (/sw.js),
//   - глобальный перехват двойного Esc («Прикрыться»).

import { html, render } from '../vendor/preact.mjs';
import { bootClientApp, store, toggleBossMode, notifyStore } from './store/app-store.mjs';
import { AppRoot } from './ui/layout.mjs';

// Подключаем глобальную горячую клавишу двойного Esc («Прикрыться»)
let lastEscAt = 0;
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const now = Date.now();
    if (now - lastEscAt < 420) {
      lastEscAt = 0;
      toggleBossMode();
      return;
    }
    lastEscAt = now;
    if (store.ui.modal) {
      store.ui.modal = null;
      notifyStore();
    }
  }
});

// Регистрация офлайн-кеша оболочки (Service Worker)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const mountNode = document.getElementById('app');
render(html`<${AppRoot} />`, mountNode);
bootClientApp();
