// Автотест системы автообновления (/api/version + /downloads/MeshChat.apk + SHA-256 целостность)

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMessengerServer } from '../server/index.mjs';

test('Автообновление: /api/version отдаёт верный buildHash и SHA-256 подписанного MeshChat.apk', async () => {
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
    assert.equal(ver.version, '1.3.0');
    assert.equal(ver.versionCode, 4);
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
