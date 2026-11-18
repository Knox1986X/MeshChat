# MeshChat 📡

**Анонимный, бесплатный, быстрый и защищённый мессенджер нового поколения.**

Telegram (скорость) + Signal (шифрование) + Briar (офлайн-меш) + Session/SimpleX (анонимность) + Discord (звонки/группы).

## ✨ Фишки

- 🔐 **E2E шифрование** — Double Ratchet, сервер ничего не видит
- 👻 **Анонимность** — без телефона и email, личность = криптографический ключ
- 🆓 **Бесплатно** — Cloudflare free + Fly.io free + P2P, $0/мес
- ⚡ **Быстро** — WebSocket + WebRTC, edge-деплой
- 🌐 **Без VPN** — 5 транспортов с автопереключением при блокировках
- 📱 **Android first**, потом Linux (CachyOS) и Windows

## 🚀 Транспорты

| Транспорт | Назначение |
|---|---|
| ☁️ Cloudflare Edge | Основной, обход DPI |
| 🪰 Fly.io Edge | Резервный маршрут |
| ⚡ WebRTC P2P | Напрямую между устройствами |
| 🧅 Tor / I2P | Луковичная маршрутизация |
| 📡 Mesh Offline | Bluetooth / Wi-Fi Direct / LAN |

## 🛠 Стек

- **Клиент:** React + Vite + Tailwind CSS + Capacitor (Android)
- **Крипто:** WebCrypto (Ed25519), Double Ratchet (скоро)
- **Сервер:** Cloudflare Workers + Fly.io (скоро, пока демо-заглушки)

## ▶️ Запуск

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production сборка
```

## 📱 Android APK

```bash
npm run build
npx cap add android   # один раз
npx cap sync android
npx cap open android  # собрать APK в Android Studio
```

## 🔑 Ключи (когда будешь готов)

Скопируй `.env.example` в `.env` и заполни Cloudflare / Fly.io ключи.
Сейчас приложение работает в **демо-режиме** — интерфейс полностью готов, транспорты — заглушки.

## 📁 Структура

```
src/
  components/   # UI: чаты, звонки, настройки, онбординг
  lib/          # данные, идентичность (WebCrypto), транспорты
```

## 🗺 Roadmap

- [x] v0.1 Demo: интерфейс, анонимная идентичность, чаты, звонки (UI)
- [ ] Подключить Cloudflare Workers + Fly.io relay
- [ ] Настоящий Double Ratchet E2E
- [ ] WebRTC голос/видео звонки
- [ ] Android APK
- [ ] Linux (CachyOS) + Windows сборки
- [ ] Офлайн-меш (Bluetooth), Tor, боты, каналы

---

*Open Source. Без слежки. Без VPN. MeshChat.*
