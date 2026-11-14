// Автотест системы автообновления (/api/version + /downloads/MeshChat.apk + SHA-256 целостность),
// а также защиты от сжимания карточек Flexbox и переключателя скриншотов FLAG_SECURE в Android.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMessengerServer } from '../server/index.mjs';
import {
  store,
  handleBackNavigation,
  toggleScreenshotProtection,
} from '../public/js/store/app-store.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Автообновление: /api/version отдаёт верный buildHash и SHA-256 подписанного MeshChat.apk v1.8.0', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshchat-upd-'));
  const srv = await createMessengerServer({ dataDir: tmpDir });
  const addr = await srv.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const verRes = await fetch(`${baseUrl}/api/version`);
    assert.equal(verRes.status, 200);
    const ver = await verRes.json();

    assert.equal(ver.ok, true);
    assert.equal(ver.app, 'MeshChat');
    assert.equal(ver.version, '1.8.0');
    assert.equal(ver.versionCode, 9);
    assert.match(ver.buildHash, /^[a-f0-9]{12}$/);
    assert.equal(ver.githubRepo, 'Knox1986X/MeshChat');

    if (ver.apkAvailable) {
      assert.equal(ver.apkUrl, '/downloads/MeshChat.apk');
      assert.match(ver.apkSha256, /^[a-f0-9]{64}$/);

      const apkRes = await fetch(`${baseUrl}${ver.apkUrl}`);
      assert.equal(apkRes.status, 200);
      assert.equal(apkRes.headers.get('content-type'), 'application/vnd.android.package-archive');
      assert.equal(apkRes.headers.get('x-apk-sha256'), ver.apkSha256);

      const apkBuf = Buffer.from(await apkRes.arrayBuffer());
      const actualSha = crypto.createHash('sha256').update(apkBuf).digest('hex');
      assert.equal(actualSha, ver.apkSha256, 'Скачанный APK обязан байт-в-байт совпадать с SHA-256 из /api/version');
    }
  } finally {
    await srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Интерфейс и Android Bridge: скриншоты разрешены по умолчанию, навигация «Назад» и анти-сжатие карточек работают', () => {
  const mainJava = fs.readFileSync(
    path.join(ROOT_DIR, 'android/src/org/meshchat/app/MainActivity.java'),
    'utf8'
  );
  assert.match(mainJava, /getBoolean\(KEY_SCREENSHOT_PROTECTION,\s*false\)/);
  assert.match(mainJava, /setScreenshotProtection\(boolean enabled\)/);
  assert.match(mainJava, /window\.clearFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/);

  const css = fs.readFileSync(path.join(ROOT_DIR, 'public/css/app.css'), 'utf8');
  assert.match(css, /\.mesh-scroll-body\s*>\s*\*,[\s\S]*?flex-shrink:\s*0/);

  // Проверяем нативный мост переключения FLAG_SECURE и SPA-цепочку кнопки «Назад»
  let nativeFlag = false;
  globalThis.MeshChatAndroid = {
    setScreenshotProtection(enabled) {
      nativeFlag = Boolean(enabled);
      return nativeFlag;
    },
  };
  try {
    store.android.screenshotProtection = false;
    toggleScreenshotProtection();
    assert.equal(store.android.screenshotProtection, true);
    assert.equal(nativeFlag, true);

    toggleScreenshotProtection();
    assert.equal(store.android.screenshotProtection, false);
    assert.equal(nativeFlag, false);

    store.me = { userId: 'u1', username: 'alice' };
    store.ui.navTab = 'chats';
    store.ui.activeChatId = 'echo:loopback';
    store.ui.inspectorOpen = true;
    store.ui.modal = 'settings';

    assert.equal(handleBackNavigation(), true);
    assert.equal(store.ui.modal, null);

    assert.equal(handleBackNavigation(), true);
    assert.equal(store.ui.inspectorOpen, false);

    assert.equal(handleBackNavigation(), true);
    assert.equal(store.ui.activeChatId, null);

    store.ui.navTab = 'settings';
    assert.equal(handleBackNavigation(), true);
    assert.equal(store.ui.navTab, 'chats');

    assert.equal(handleBackNavigation(), false);
  } finally {
    delete globalThis.MeshChatAndroid;
    store.me = null;
  }
});
