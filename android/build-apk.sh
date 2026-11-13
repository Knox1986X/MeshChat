#!/usr/bin/env bash
# Воспроизводимая сборка подписанного Android-пакета MeshChat.apk с постоянным ключом подписи.
# Хранилище ключей располагается внутри /home/user/messenger/android/keystore/meshchat-release.jks
# (исключено в .gitignore, сохраняется между сессиями и синхронизировано с GitHub Actions Secret),
# что навсегда исключает ошибку INSTALL_FAILED_UPDATE_INCOMPATIBLE при обновлениях поверх установленной версии.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$PROJECT_DIR/android"
SDK_DIR="${ANDROID_SDK_ROOT:-/var/tmp/android-sdk}"
WORK_DIR="/var/tmp/meshchat-apk-build"
OUT_APK="$PROJECT_DIR/MeshChat.apk"
KEYSTORE_DIR="$ANDROID_DIR/keystore"
KEYSTORE="${MESHCHAT_KEYSTORE:-$KEYSTORE_DIR/meshchat-release.jks}"

if [[ -d /usr/lib/jvm/jdk-11/bin ]]; then
  export PATH="/usr/lib/jvm/jdk-11/bin:$PATH"
fi

mkdir -p "$KEYSTORE_DIR"

# В среде CI восстанавливаем постоянный ключ релиза из секрета ANDROID_KEYSTORE_B64
if [[ -n "${ANDROID_KEYSTORE_B64:-}" && ! -f "$KEYSTORE" ]]; then
  echo "$ANDROID_KEYSTORE_B64" | tr -d '[:space:]' | base64 -d > "$KEYSTORE"
fi

echo "[1/7] Проверка Android SDK Build-Tools 33.0.2 и Platform API 33..."
mkdir -p "$SDK_DIR"
if [[ ! -x "$SDK_DIR/build-tools/aapt2" ]]; then
  curl -fsSL https://dl.google.com/android/repository/build-tools_r33.0.2-linux.zip -o "$SDK_DIR/bt.zip"
  unzip -q "$SDK_DIR/bt.zip" -d "$SDK_DIR" && rm -f "$SDK_DIR/bt.zip"
  mv "$SDK_DIR/android-13" "$SDK_DIR/build-tools"
fi
if [[ ! -f "$SDK_DIR/platform/android.jar" ]]; then
  curl -fsSL https://dl.google.com/android/repository/platform-33_r02.zip -o "$SDK_DIR/pf.zip"
  unzip -q "$SDK_DIR/pf.zip" -d "$SDK_DIR" && rm -f "$SDK_DIR/pf.zip"
  mv "$SDK_DIR/android-13" "$SDK_DIR/platform"
fi

AAPT2="$SDK_DIR/build-tools/aapt2"
D8="$SDK_DIR/build-tools/d8"
ZIPALIGN="$SDK_DIR/build-tools/zipalign"
APKSIGNER="$SDK_DIR/build-tools/apksigner"
ANDROID_JAR="$SDK_DIR/platform/android.jar"

echo "[2/7] Генерация иконок адаптивного лаунчера MeshChat (mdpi..xxxhdpi)..."
python3 "$ANDROID_DIR/generate-icons.py"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/compiled_res" "$WORK_DIR/gen" "$WORK_DIR/classes" "$WORK_DIR/dex" "$WORK_DIR/stage/assets/www"

echo "[3/7] Упаковка клиентского ядра MeshChat v1.5 в assets/www..."
cp -R "$PROJECT_DIR/public" "$WORK_DIR/stage/assets/www/public"
cp -R "$PROJECT_DIR/shared" "$WORK_DIR/stage/assets/www/shared"

echo "[4/7] Компиляция ресурсов и AndroidManifest.xml через aapt2..."
"$AAPT2" compile --dir "$ANDROID_DIR/res" -o "$WORK_DIR/compiled_res/res.zip"
"$AAPT2" link \
  -I "$ANDROID_JAR" \
  --manifest "$ANDROID_DIR/AndroidManifest.xml" \
  -A "$WORK_DIR/stage/assets" \
  -0 .mjs -0 .wasm -0 .svg \
  --java "$WORK_DIR/gen" \
  -o "$WORK_DIR/unaligned.apk" \
  "$WORK_DIR/compiled_res/res.zip"

echo "[5/7] Компиляция нативного Java-кода (MainActivity + MeshNativeVault + MeshUpdater) и сборка DEX..."
find "$ANDROID_DIR/src" "$WORK_DIR/gen" -name "*.java" > "$WORK_DIR/sources.txt"
javac --release 11 -encoding UTF-8 -cp "$ANDROID_JAR" -d "$WORK_DIR/classes" @"$WORK_DIR/sources.txt"

find "$WORK_DIR/classes" -name "*.class" > "$WORK_DIR/classfiles.txt"
"$D8" --min-api 26 --lib "$ANDROID_JAR" --output "$WORK_DIR/dex" @"$WORK_DIR/classfiles.txt"

(cd "$WORK_DIR/dex" && zip -q "$WORK_DIR/unaligned.apk" classes.dex)

echo "[6/7] Выравнивание zipalign (4 байта) и криптографическая подпись постоянным ключом (v1 + v2 + v3)..."
"$ZIPALIGN" -f -p 4 "$WORK_DIR/unaligned.apk" "$WORK_DIR/aligned.apk"

if [[ ! -f "$KEYSTORE" ]]; then
  if [[ "${CI:-false}" == "true" ]]; then
    echo "ОШИБКА CI: секрет ANDROID_KEYSTORE_B64 не задан! Генерация случайного ключа запрещена во избежание конфликта пакетов." >&2
    exit 1
  fi
  keytool -genkeypair \
    -keystore "$KEYSTORE" \
    -storetype PKCS12 \
    -storepass meshchat2026 \
    -keypass meshchat2026 \
    -alias meshchat \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=MeshChat Release, OU=Security, O=MeshChat, C=NL"
fi

"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:meshchat2026 \
  --key-pass pass:meshchat2026 \
  --ks-key-alias meshchat \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$OUT_APK" \
  "$WORK_DIR/aligned.apk"

echo "[7/7] Верификация цифровой подписи и манифеста MeshChat.apk..."
"$APKSIGNER" verify --verbose --print-certs "$OUT_APK" | head -n 12
("$AAPT2" dump badging "$OUT_APK" || true) | head -n 6
rm -rf "$WORK_DIR"

ls -lh "$OUT_APK"
echo "Готово: $OUT_APK"
