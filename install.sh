#!/usr/bin/env bash
# Автоматический установщик MeshChat для Debian / Ubuntu / Raspberry Pi OS (0 ₽).
# Поднимает слепой сервер + Tor Hidden Service v3 (.onion) + i2pd (.b32.i2p) через Docker Compose
# либо в нативном режиме systemd + Node.js 20, если Docker недоступен.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { printf "${CYAN}[meshchat-install]${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
err()  { printf "${RED}[ОШИБКА]${NC} %s\n" "$*" >&2; exit 1; }

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

MODE="${1:---docker}"

# 1. Генерация .env со случайными криптографическими секретами (если ещё не создан)
if [[ ! -f .env ]]; then
  log "Генерирую локальный файл конфигурации .env..."
  RAND_TURN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  RAND_METRICS="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > .env <<EOF
LISTEN_BIND=0.0.0.0
PORT=3000
INVITE_ONLY=0
POW_BITS=14
MAX_BLOB_MB=50
TURN_SECRET=${RAND_TURN}
METRICS_TOKEN=${RAND_METRICS}
ONION_ADDRESS=
I2P_ADDRESS=
S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=
S3_KEY_ID=
S3_SECRET=
EOF
  chmod 600 .env
  ok "Файл .env создан (права 0600)."
fi

if [[ "$MODE" == "--native" ]]; then
  log "Выбран нативный режим запуска (без Docker)..."
  command -v node >/dev/null 2>&1 || err "Установите Node.js >= 20 (https://nodejs.org) и повторите запуск."
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  (( NODE_MAJOR >= 20 )) || err "Требуется Node.js >= 20, обнаружен $(node -v)"

  mkdir -p "$PROJECT_DIR/data"
  log "Прогоняю криптографические и транспортные автотесты..."
  npm test
  ok "Все тесты пройдены. Запуск сервера: npm start"
  exit 0
fi

# 2. Режим Docker Compose (Сервер + Tor .onion + I2P .b32.i2p)
if ! command -v docker >/dev/null 2>&1; then
  log "Docker не найден. Устанавливаю Docker Engine..."
  curl -fsSL https://get.docker.com | sh
fi

log "Собираю и запускаю контейнеры veil + tor + i2pd..."
docker compose up -d --build

log "Ожидаю готовности сервера (/api/health) и генерации ключей Tor Onion v3..."
for _ in {1..20}; do
  if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

ONION_HOST=""
for _ in {1..25}; do
  ONION_HOST="$(docker exec veil-tor cat /var/lib/tor/veil_hs/hostname 2>/dev/null || true)"
  if [[ -n "$ONION_HOST" ]]; then
    break
  fi
  sleep 1
done

if [[ -n "$ONION_HOST" ]]; then
  sed -i.bak "s|^ONION_ADDRESS=.*|ONION_ADDRESS=${ONION_HOST}|" .env && rm -f .env.bak
  docker compose up -d veil >/dev/null
fi

echo ""
ok "MeshChat успешно развёрнут!"
echo "──────────────────────────────────────────────────────────────"
echo "  Локальный / Clearnet URL : http://127.0.0.1:${PORT:-3000}"
if [[ -n "$ONION_HOST" ]]; then
  echo "  Скрытое зеркало Tor v3   : http://${ONION_HOST}"
fi
echo "  Проверка здоровья узла   : curl -s http://127.0.0.1:${PORT:-3000}/api/health"
echo "  Локальный мост на клиенте: npm run bridge (127.0.0.1:17700)"
echo "──────────────────────────────────────────────────────────────"
