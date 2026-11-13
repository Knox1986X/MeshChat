// Автотесты постоянного сохранения сессии без повторной регистрации:
//   1. Беспарольное продление токена неизвлекаемым ключом ECDSA P-256 (me:zkAuthPriv).
//   2. Прозрачная регидратация аккаунта с ТЕМ ЖЕ userId и ключами после полного сброса диска сервера.
//   3. Криптографическая самопроверка loopbackSelfTest (AES-256-GCM + ISO/IEC 7816-4 512 Б).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMessengerServer } from '../server/index.mjs';
import { CryptoEngine } from '../public/js/crypto/crypto.worker.mjs';
import { randomBytes, toBase64Url } from '../shared/crypto/primitives.mjs';

async function postJson(baseUrl, pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

test('Постоянная сессия: беспарольный ZK-вход и авто-регидратация при перезапуске эфемерного узла', async () => {
  const tmpDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'meshchat-persist-1-'));
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'meshchat-persist-2-'));

  const srv1 = await createMessengerServer({ dataDir: tmpDir1 });
  const addr1 = await srv1.listen(0, '127.0.0.1');
  const url1 = `http://127.0.0.1:${addr1.port}`;

  let srv2 = null;
  try {
    const engine = new CryptoEngine();
    await engine.init();

    // Проверка локального криптографического эхо-теста
    const echo = await engine.loopbackSelfTest({ text: 'Проверка стойкости E2EE' });
    assert.equal(echo.ok, true);
    assert.equal(echo.decryptedText, 'Проверка стойкости E2EE');
    assert.ok(echo.paddedBytes >= 512, 'Шифртекст обязан быть выровнен минимум до блока 512 байт');

    // Первичная регистрация пользователя
    const userId = `u_${toBase64Url(randomBytes(15))}`;
    const pow1 = await postJson(url1, '/api/auth/pow', { purpose: 'register' });
    const zkReg = await engine.prepareZkRegistration({
      username: 'vegas_persistent',
      password: 'CorrectHorseBatteryStaple!99',
      algorithm: 'scrypt',
    });
    const prov = await engine.provisionIdentity({ userId, opkCount: 15, createRecoveryKit: true });
    const nonce1 = await engine.solvePow(pow1);

    const reg1 = await postJson(url1, '/api/auth/register', {
      username: 'vegas_persistent',
      powChallenge: pow1.challengeToken,
      powNonce: nonce1,
      authPubB64: zkReg.authPubB64,
      encryptedAuthKey: zkReg.encryptedAuthKey,
      publicBundle: prov.publicBundle,
      encryptedRecovery: prov.recoveryKit.encryptedBackup,
    });
    assert.equal(reg1.userId, userId);

    // 1. Беспарольное обновление токена неизвлекаемым ключом me:zkAuthPriv
    const storedZkKey = await engine.store.getNativeKey('me:zkAuthPriv');
    assert.ok(storedZkKey, 'Ключ me:zkAuthPriv должен сохраняться в защищённом хранилище');
    assert.equal(storedZkKey.extractable, false, 'Приватный ключ ZK-сессии обязан иметь extractable=false');

    const ch = await postJson(url1, '/api/auth/challenge', { username: 'vegas_persistent' });
    const silentSig = await engine.signStoredZkChallenge({
      username: 'vegas_persistent',
      challengeNonce: ch.challengeNonce,
    });
    const silentLogin = await postJson(url1, '/api/auth/login', {
      username: 'vegas_persistent',
      challengeNonce: ch.challengeNonce,
      signatureB64: silentSig,
    });
    assert.equal(silentLogin.userId, userId);
    assert.ok(silentLogin.token && silentLogin.token !== reg1.token);

    // 2. Имитация полного перезапуска эфемерного облачного контейнера (чистый каталог tmpDir2)
    await srv1.close();
    srv2 = await createMessengerServer({ dataDir: tmpDir2 });
    const addr2 = await srv2.listen(0, '127.0.0.1');
    const url2 = `http://127.0.0.1:${addr2.port}`;

    const rehydPkg = await engine.exportRelayRehydrationPackage({ opkCount: 12 });
    assert.equal(rehydPkg.publicBundle.identity.userId, userId);
    assert.equal(rehydPkg.publicBundle.identity.ikSignPub, prov.publicBundle.identity.ikSignPub);

    const pow2 = await postJson(url2, '/api/auth/pow', { purpose: 'register' });
    const nonce2 = await engine.solvePow(pow2);
    const reg2 = await postJson(url2, '/api/auth/register', {
      username: rehydPkg.username,
      powChallenge: pow2.challengeToken,
      powNonce: nonce2,
      authPubB64: rehydPkg.authPubB64,
      encryptedAuthKey: rehydPkg.encryptedAuthKey,
      publicBundle: rehydPkg.publicBundle,
      encryptedRecovery: rehydPkg.encryptedRecovery,
    });

    assert.equal(reg2.userId, userId, 'После регидратации сохраняется ТОТ ЖЕ САМЫЙ userId и ключи личности');
    assert.equal(reg2.username, 'vegas_persistent');
  } finally {
    await srv1.close().catch(() => {});
    if (srv2) await srv2.close().catch(() => {});
    fs.rmSync(tmpDir1, { recursive: true, force: true });
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  }
});
