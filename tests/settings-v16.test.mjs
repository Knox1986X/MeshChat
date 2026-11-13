// Автотесты расширенных настроек MeshChat v1.6:
// настраиваемый квант паддинга (256..4096 Б) в CryptoEngine, локальный PIN-код (SHA-256 + соль),
// зашифрованный резервный архив (PBKDF2-SHA256 210k + AES-256-GCM) и 10 тем оформления.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  utf8ToBytes,
  bytesToUtf8,
  padPayload,
  unpadPayload,
} from '../shared/crypto/index.mjs';
import { CryptoEngine } from '../public/js/crypto/crypto.worker.mjs';
import { CryptoKeyStore } from '../public/js/crypto/keystore-idb.mjs';
import {
  store,
  THEME_PRESETS,
  DEFAULT_SETTINGS,
  setAppPin,
  unlockWithPin,
  disableAppPin,
  exportEncryptedBackup,
  importEncryptedBackup,
} from '../public/js/store/app-store.mjs';
import { formatTime } from '../public/js/ui/boss-screen.mjs';

test('Крипто-паддинг v1.6: выравнивание ISO/IEC 7816-4 поддерживает кванты 256 / 512 / 1024 / 2048 / 4096 байт', async () => {
  const msg = utf8ToBytes('Короткое сообщение E2EE');

  for (const quantum of [256, 512, 1024, 2048, 4096]) {
    const padded = padPayload(msg, quantum);
    assert.equal(padded.byteLength, quantum, `Ожидался размер блока ${quantum} Б`);
    const unpadded = unpadPayload(padded);
    assert.equal(bytesToUtf8(unpadded), 'Короткое сообщение E2EE');
  }

  // Проверяем CryptoEngine.setCryptoConfig({ paddingBlockBytes: 2048 })
  const aliceEngine = new CryptoEngine(new CryptoKeyStore());
  const bobEngine = new CryptoEngine(new CryptoKeyStore());
  await aliceEngine.init();
  await bobEngine.init();

  const aliceProv = await aliceEngine.provisionIdentity({ userId: 'u_alice_v16', opkCount: 5 });
  const bobProv = await bobEngine.provisionIdentity({ userId: 'u_bob_v16', opkCount: 5 });

  await aliceEngine.setCryptoConfig({ paddingBlockBytes: 2048 });
  const loopRes = await aliceEngine.loopbackSelfTest({ text: 'PROBE' });
  assert.equal(loopRes.ok, true);
  // 2048 Б выровненного блока + 16 Б тега аутентификации AES-256-GCM = 2064 Б
  assert.equal(loopRes.paddedBytes, 2064);

  await aliceEngine.establishOutgoingSession({
    peerBundle: {
      identity: bobProv.publicBundle.identity,
      signedPreKey: bobProv.publicBundle.signedPreKey,
      oneTimePreKey: bobProv.publicBundle.oneTimePreKeys[0],
    },
  });

  const { sealedBytes } = await aliceEngine.encryptMessageForPeer({
    peerId: 'u_bob_v16',
    payloadObject: { type: 'chat', text: 'Проверка кванта 2048 Б' },
  });
  assert.ok(sealedBytes.byteLength >= 2048, 'Конверт Sealed Sender обязан быть не меньше кванта 2048 Б');

  await bobEngine.savePeerIdentity({ peerIdentity: aliceProv.publicBundle.identity });
  const dec = await bobEngine.decryptIncomingSealedEnvelope({ sealedBytes });
  assert.equal(dec.payload.text, 'Проверка кванта 2048 Б');
});

test('Локальный PIN-код и зашифрованный бэкап (PBKDF2 210k + AES-256-GCM)', async () => {
  assert.equal(Object.keys(THEME_PRESETS).length, 10);
  assert.equal(THEME_PRESETS.amoled.bg0, '#000000');
  assert.equal(DEFAULT_SETTINGS.paddingBlockBytes, 512);

  const sampleTs = Date.UTC(2026, 10, 13, 14, 5, 9);
  assert.match(formatTime(sampleTs, '24h_sec'), /:\d{2}:\d{2}/);
  assert.match(formatTime(sampleTs, '12h'), /(AM|PM|ДП|ПП)/i);

  // Проверка валидации и работы PIN-кода
  await assert.rejects(() => setAppPin('12a'), /от 4 до 8 цифр/);
  await setAppPin('2580');
  assert.ok(store.settings.pinHashB64.length > 10);
  assert.ok(store.settings.pinSaltB64.length > 10);

  store.ui.pinLocked = true;
  assert.equal(await unlockWithPin('9999'), false);
  assert.equal(store.ui.pinLocked, true);
  assert.equal(await unlockWithPin('2580'), true);
  assert.equal(store.ui.pinLocked, false);

  await assert.rejects(() => disableAppPin('0000'), /Неверный текущий PIN/);
  await disableAppPin('2580');
  assert.equal(store.settings.pinHashB64, '');

  // Проверка зашифрованного экспорта и импорта AES-256-GCM
  store.profile.displayName = 'Капитан Немо';
  store.theme.preset = 'emerald';
  store.settings.paddingBlockBytes = 1024;
  store.messages['dm:test'] = [{ id: 'm1', text: 'Секретный журнал', ts: 1700000000000 }];

  const vault = await exportEncryptedBackup('StrongVaultPass!2026');
  assert.equal(vault.format, 'meshchat-vault-v1');
  assert.equal(vault.cipher, 'AES-256-GCM');

  await assert.rejects(
    () => importEncryptedBackup(JSON.stringify(vault), 'WrongPass123'),
    /Неверная парольная фраза/
  );

  store.profile.displayName = 'Сброшено';
  store.theme.preset = 'obsidian';
  store.settings.paddingBlockBytes = 256;
  store.messages['dm:test'] = [];

  await importEncryptedBackup(JSON.stringify(vault), 'StrongVaultPass!2026');
  assert.equal(store.profile.displayName, 'Капитан Немо');
  assert.equal(store.theme.preset, 'emerald');
  assert.equal(store.settings.paddingBlockBytes, 1024);
  assert.equal(store.messages['dm:test'].length, 1);
  assert.equal(store.messages['dm:test'][0].text, 'Секретный журнал');
});
