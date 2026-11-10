# Свой relay: деплой

Relay — это «бесплатный сервер» MeshChat: один Node-процесс, никакой БД, только
память + journal-файл. Он же раздаёт веб-интерфейс, поэтому открыв адрес relay,
вы сразу получаете мессенджер.

Требования: Node 20+ (или Docker). Порт по умолчанию 8787.

## 0. Локально за 30 секунд

```bash
npm install
npm run build
npm start                       # http://localhost:8787
# или с параметрами:
node packages/relay/dist/relay.mjs --port 8787 --data ./data --pow 16 --name "relay друзей"
```

Флаги: `--port`, `--host`, `--pow`, `--ttl-days`, `--data`, `--static`, `--name`,
`--log`. То же через переменные `MESHCHAT_*`.

## 1. Docker (проще всего)

```bash
docker compose up -d --build
# → http://localhost:8787
```

`docker-compose.yml` уже содержит volume, healthcheck и переменные окружения.

Одиночный контейнер:

```bash
docker build -t meshchat .
docker run -d -p 8787:8787 -v meshchat-data:/data \
  -e MESHCHAT_POW=16 -e MESHCHAT_TTL_DAYS=7 --name meshchat meshchat
```

## 2. VPS (любой, 1 vCPU / 256 МБ хватит)

```bash
# Ubuntu/Debian
apt install -y nodejs npm nginx caddy
git clone <этот репозиторий> /opt/meshchat && cd /opt/meshchat
npm ci --omit=dev
npm run build
npm start   # проверка
```

### systemd

`/etc/systemd/system/meshchat.service`:

```ini
[Unit]
Description=MeshChat relay
After=network.target

[Service]
Type=simple
User=meshchat
WorkingDirectory=/opt/meshchat
ExecStart=/usr/bin/node packages/relay/dist/relay.mjs --port 8787 --data /var/lib/meshchat --pow 16
Restart=always
RestartSec=3
Environment=MESHCHAT_NAME=my-relay
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/meshchat

[Install]
WantedBy=multi-user.target
```

```bash
useradd -r -s /usr/sbin/nologin meshchat
mkdir -p /var/lib/meshchat && chown meshchat /var/lib/meshchat
systemctl enable --now meshchat
```

### TLS через Caddy (автоматический HTTPS и WebSocket)

```
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Caddy сам проксирует WebSocket. Для nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name relay.example.com;
  # ssl_certificate … (certbot)
  client_max_body_size 4m;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
  }
}
```

Важно: `proxy_read_timeout` ≥ 60 c, иначе long-poll будет рваться (клиент
переживёт, но лишние реконнекты).

## 3. Бесплатные PaaS

### Fly.io

```bash
fly launch --no-deploy          # подхватит fly.toml
fly volumes create meshchat_data --size 1
fly deploy
fly open
```

`fly.toml` уже настроен: `internal_port 8787`, healthcheck `/v1/health`, volume в
`/data`, `MESHCHAT_POW=16`.

### Railway / Render / Koyeb

* Build: `npm ci && npm run build`
* Start: `node packages/relay/dist/relay.mjs`
* Переменные: `MESHCHAT_PORT` (обычно выдаёт платформа), `MESHCHAT_POW=16`, `MESHCHAT_DATA` — если есть диск; без диска relay работает в памяти (сообщения живут до рестарта).
* WebSocket включён по умолчанию у всех трёх.

### Raspberry Pi / старый ноут

Тот же systemd-юнит. 128 МБ RAM достаточно для десятков пользователей.
Доступ из интернета: Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:8787`)
или Tailscale Funnel — оба бесплатны и дают HTTPS/WSS.

## 4. Tor onion (сильная анонимность)

```bash
apt install tor
cat >> /etc/tor/torrc <<'EOF'
HiddenServiceDir /var/lib/tor/meshchat/
HiddenServicePort 80 127.0.0.1:8787
EOF
systemctl restart tor
cat /var/lib/tor/meshchat/hostname   # xxxxx.onion
```

Дальше в приложении: *Настройки → Relay* → `http://xxxxx.onion` (и открывать
само приложение через Tor Browser, иначе браузер не умеет .onion).
Собеседник должен добавить ваш onion-relay в своё приглашение/контакт.

## 5. Android / Termux (relay в кармане)

```bash
pkg install nodejs git
git clone <репозиторий> && cd MeshChat
npm install && npm run build
node packages/relay/dist/relay.mjs --port 8787 --data ~/mesh-data
```

Доступ из локальной сети: `http://<ip-телефона>:8787`. Для интернета — Cloudflare
Tunnel из Termux.

## 6. Обновление и бэкап

* Обновление: `git pull && npm ci --omit=dev && npm run build && systemctl restart meshchat`.
* Бэкап: каталог `--data` (journal конвертов + prekeys). Там **только шифротекст**
  и публичные ключи; потеря данных = потеря непрочитанных сообщений.
* Секретов на сервере нет. Это и есть смысл zero-knowledge.

## 7. Мониторинг

```bash
curl -s https://relay.example.com/v1/health | jq
# { ok, name, version, pow, ttlMs, envelopes, uptimeMs }
```

Полезные метрики: `envelopes`, `uptimeMs`, размер journal-файла, 4xx/5xx.
Логи по умолчанию не содержат ни IP, ни тегов — включайте `--log` только осознанно.

## 8. Траблшутинг

| Симптом | Причина / решение |
|---|---|
| UI отдаёт 503 `ui not built` | не выполнен `npm run build` (нужен `packages/relay/public`) |
| WebSocket не поднимается | прокси без `Upgrade`; клиент сам уйдёт в long-poll |
| сообщения «в очереди» | не совпадает `pow` (клиент берёт из `/v1/health`) или relay недоступен |
| контакт не появляется | собеседник не опубликовал prekeys: пусть откроет приложение и подождёт пару секунд |
| `429` | сработал rate limit (`MESHCHAT_RATE_LIMIT`), по умолчанию 240 запросов/мин на IP |
