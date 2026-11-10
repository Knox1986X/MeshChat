# Linux, Windows, Android

MeshChat — одна кодовая база, три способа поставить её на устройство:

1. **PWA** — открыть адрес relay и «Установить приложение». Работает везде, где есть браузер.
2. **Локальный сервер** — `npm start`, приложение и relay в одном процессе на своей машине.
3. **APK / нативный бандл** — для Android через Capacitor (CI-workflow уже в репозитории) и для десктопа через Tauri.

Данные всегда локальны (IndexedDB), поэтому «установка» — это просто оболочка.

---

## Arch / CachyOS

```bash
sudo pacman -S --needed nodejs npm git
git clone <репозиторий> ~/MeshChat && cd ~/MeshChat
npm ci
npm run build
npm start
```

Откройте `http://localhost:8787`.

### Как приложение в меню (systemd --user + ярлык)

`~/.config/systemd/user/meshchat.service`:

```ini
[Unit]
Description=MeshChat

[Service]
WorkingDirectory=%h/MeshChat
ExecStart=/usr/bin/node packages/relay/dist/relay.mjs --port 8787 --data %h/.local/share/meshchat
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now meshchat
```

`~/.local/share/applications/meshchat.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=MeshChat
Comment=Anonymous encrypted messenger
Exec=xdg-open http://localhost:8787
Icon=/home/<you>/MeshChat/packages/app/public/icons/icon-512.png
Terminal=false
Categories=Network;InstantMessaging;
```

PWA-вариант: откройте `http://localhost:8787` в Chromium → иконка «Установить»
в адресной строке. Приложение получит своё окно и offline-кеш.

### Нативный бандл (Tauri, опционально)

Нужен Rust (`rustup`) и WebKitGTK:

```bash
sudo pacman -S --needed webkit2gtk-4.1 base-devel
cargo install create-tauri-app
# или: npm create tauri-app@latest
```

В `tauri.conf.json` укажите `"devUrl": "http://localhost:8787"` и
`"frontendDist": "../relay/public"` — Tauri просто обернёт тот же UI. Сборка:
`npm run tauri build` → AppImage/`.deb`. Relay при этом можно запускать
systemd-юнитом выше или указать удалённый.

---

## Windows 10/11

1. Установите [Node.js LTS](https://nodejs.org) (winget: `winget install OpenJS.NodeJS.LTS`).
2. В PowerShell:

```powershell
git clone <репозиторий> $env:USERPROFILE\MeshChat
cd $env:USERPROFILE\MeshChat
npm ci
npm run build
npm start
```

3. Откройте `http://localhost:8787` в Edge или Chrome → меню «Приложения» →
**Установить этот сайт как приложение**. Появится ярлык в меню «Пуск».

Автозапуск: создайте `MeshChat.vbs` или задание в Планировщике:

```powershell
schtasks /create /tn MeshChat /tr "cmd /c cd /d %USERPROFILE%\MeshChat && node packages\relay\dist\relay.mjs" /sc onlogon
```

Чтобы приложение было доступно с телефона в той же Wi-Fi сети, разрешите порт:

```powershell
New-NetFirewallRule -DisplayName "MeshChat" -Direction Inbound -LocalPort 8787 -Protocol TCP -Action Allow
```

и откройте `http://<ip-ПК>:8787` на телефоне.

---

## Android

### Вариант A — PWA (5 секунд, рекомендуется)

1. Откройте адрес relay (например, `https://relay.example.com` или `http://<ip-ПК>:8787`) в Chrome.
2. Меню ⋮ → **Установить приложение** / «Добавить на главный экран».
3. Готово: иконка, полноэкранный режим, офлайн-кеш, уведомления браузера.

IndexedDB с ключами живёт в профиле Chrome. Не чистите данные сайта — иначе
понадобится бэкап личности (Настройки → Экспорт бэкапа).

### Вариант B — настоящий APK (Capacitor)

В репозитории есть конфиг `capacitor.config.ts` и workflow
`.github/workflows/android.yml`, который собирает debug-APK на каждый тег.

Локально (нужны JDK 17 и Android SDK):

```bash
npm ci && npm run build
npx cap add android        # один раз, создаст ./android
npx cap sync android
cd android && ./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

APK — это WebView-оболочка вокруг того же UI. Чтобы не зависеть от внешнего
relay, укажите в настройках свой relay (или поднимите relay на телефоне в Termux
и обращайтесь к `http://127.0.0.1:8787`).

### Вариант C — Termux (relay в кармане)

```bash
pkg install nodejs git
git clone <репозиторий> ~/MeshChat && cd ~/MeshChat
npm install && npm run build
node packages/relay/dist/relay.mjs --port 8787 --data ~/mesh-data
```

Телефон становится вашим relay: открывайте `http://127.0.0.1:8787` в браузере,
а друзьям давайте адрес через Cloudflare Tunnel или локальную сеть.

---

## iOS / iPadOS

PWA ставится через Safari: «Поделиться» → «На экран Домой». Ограничения:
WebSocket в фоне засыпает, push-уведомлений нет, фоновая доставка — только пока
приложение открыто. Приемлемо для тестов, не для «всегда на связи».

---

## Офлайн и локальная сеть

* Без интернета работает транспорт **local** (вкладки одного браузера) и PWA-кеш.
* В одной Wi-Fi сети: поднимите relay на одном устройстве (`--host 0.0.0.0`),
  остальные открывают `http://<ip>:8787`. Приглашение автоматически содержит этот
  адрес как relay-хинт.
* Сообщения, отправленные в офлайне, лежат в очереди до 24 часов и уходят, как
  только появляется любой транспорт.

---

## Обновление

```bash
git pull && npm ci && npm run build
# перезапустить сервис/процесс
```

PWA обновится сама при следующем открытии (service worker обновляет shell).
Ключи и история не затрагиваются: они в IndexedDB.

---

## Сравнение вариантов

| | PWA | Локальный сервер | APK (Capacitor) | Tauri (десктоп) |
|---|---|---|---|---|
| Установка | 1 клик | npm start | сборка + APK | сборка Rust |
| Автономность | кеш shell | да | да | да |
| Свой relay внутри | нет | да | опционально | опционально |
| Уведомления в фоне | ограничены | — | через WebView | — |
| Размер | 0 | Node | ~4 МБ APK | ~6 МБ AppImage |
