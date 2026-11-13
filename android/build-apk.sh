#!/usr/bin/env bash
# Воспроизводимая сборка подписанного Android-пакета MeshChat.apk без тяжёлого Gradle-демона.
# Использует официальные инструменты AOSP (aapt2 + javac + d8 + zipalign + apksigner v1/v2/v3).

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$PROJECT_DIR/android"
SDK_DIR="${ANDROID_SDK_ROOT:-/var/tmp/android-sdk}"
WORK_DIR="/var/tmp/meshchat-apk-build"
OUT_APK="$PROJECT_DIR/MeshChat.apk"
KEYSTORE="/var/tmp/meshchat-signing.jks"

if [[ -d /usr/lib/jvm/jdk-11/bin ]]; then
  export PATH="/usr/lib/jvm/jdk-11/bin:$PATH"
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

echo "[3/7] Упаковка клиентского ядра MeshChat (Signal Protocol + Preact + 5 транспортов) в assets/www..."
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

echo "[5/7] Компиляция нативного Java-кода (MainActivity + MeshLocalNode + MeshSocksBridge) и сборка DEX..."
find "$ANDROID_DIR/src" "$WORK_DIR/gen" -name "*.java" > "$WORK_DIR/sources.txt"
javac --release 11 -encoding UTF-8 -cp "$ANDROID_JAR" -d "$WORK_DIR/classes" @"$WORK_DIR/sources.txt"

find "$WORK_DIR/classes" -name "*.class" > "$WORK_DIR/classfiles.txt"
"$D8" --min-api 26 --lib "$ANDROID_JAR" --output "$WORK_DIR/dex" @"$WORK_DIR/classfiles.txt"

(cd "$WORK_DIR/dex" && zip -q "$WORK_DIR/unaligned.apk" classes.dex)

echo "[6/7] Выравнивание zipalign (4 байта) и криптографическая подпись APK (v1 + v2 + v3)..."
"$ZIPALIGN" -f -p 4 "$WORK_DIR/unaligned.apk" "$WORK_DIR/aligned.apk"

if [[ ! -f "$KEYSTORE" ]]; then
  keytool -genkeypair \
    -keystore "$KEYSTORE" \
    -storetype PKCS12 \
    -storepass meshchat2026 \
    -keypass meshchat2026 \
    -alias meshchat \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=MeshChat Messenger, OU=Privacy, O=MeshChat, C=NL"
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
"$APKSIGNER" verify --verbose "$OUT_APK"
("$AAPT2" dump badging "$OUT_APK" || true) | head -n 8
rm -rf "$WORK_DIR"

ls -lh "$OUT_APK"
echo "Готово: $OUT_APK"
