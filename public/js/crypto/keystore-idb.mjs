// Хранилище криптоключей в IndexedDB.
// Приватные ключи личности (IK_Sign, IK_DH), SignedPreKey и локальный мастер-ключ БД (dbMasterKey)
// хранятся как нативные объекты CryptoKey с extractable = false — даже при XSS их байты нельзя прочитать.
// Все состояния сессий Double Ratchet и метаданные шифруются в store `vault` ключом dbMasterKey (AES-256-GCM).

import {
  utf8ToBytes,
  bytesToUtf8,
  randomBytes,
  toBase64Url,
  fromBase64Url,
  aesGcmEncrypt,
  aesGcmDecrypt,
  generateNonExtractableDbKey,
  wipe,
} from '../../../shared/crypto/primitives.mjs';

const DB_NAME = 'veil_crypto_keystore_v1';
const DB_VERSION = 1;
const STORE_KEYS = 'native_keys'; // Нативные CryptoKey (extractable: false)
const STORE_VAULT = 'vault';      // Шифртексты AES-256-GCM под dbMasterKey

/** Обёртка IndexedDB с прозрачным in-memory режимом для тестов в Node.js */
export class CryptoKeyStore {
  constructor() {
    this._db = null;
    this._memKeys = new Map();
    this._memVault = new Map();
    this._masterKey = null;
  }

  async open() {
    if (this._masterKey) return;

    if (typeof indexedDB !== 'undefined') {
      this._db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_KEYS)) {
            db.createObjectStore(STORE_KEYS);
          }
          if (!db.objectStoreNames.contains(STORE_VAULT)) {
            db.createObjectStore(STORE_VAULT);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Не удалось открыть IndexedDB для ключей'));
      });
    }

    // Инициализируем неизвлекаемый локальный мастер-ключ хранилища
    let mk = await this.getNativeKey('sys:dbMasterKey');
    if (!mk) {
      mk = await generateNonExtractableDbKey();
      await this.putNativeKey('sys:dbMasterKey', mk);
    }
    this._masterKey = mk;
  }

  /** Сохранение нативного объекта CryptoKey (с проверкой extractable === false для приватных ключей) */
  async putNativeKey(id, cryptoKey, { allowExtractable = false } = {}) {
    if (!allowExtractable && cryptoKey && cryptoKey.type === 'private' && cryptoKey.extractable) {
      throw new Error(`Отказ сохранения: приватный ключ "${id}" обязан иметь extractable=false`);
    }
    if (!this._db) {
      this._memKeys.set(id, cryptoKey);
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = this._db.transaction(STORE_KEYS, 'readwrite');
      tx.objectStore(STORE_KEYS).put(cryptoKey, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Чтение нативного объекта CryptoKey */
  async getNativeKey(id) {
    if (!this._db) {
      return this._memKeys.get(id) || null;
    }
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(STORE_KEYS, 'readonly');
      const req = tx.objectStore(STORE_KEYS).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /** Удаление нативного ключа (например, погашенного One-Time PreKey) */
  async deleteNativeKey(id) {
    if (!this._db) {
      this._memKeys.delete(id);
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = this._db.transaction(STORE_KEYS, 'readwrite');
      tx.objectStore(STORE_KEYS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Зашифрованная запись произвольного JSON-состояния (например, сессии Double Ratchet) */
  async putEncryptedRecord(recordId, value) {
    await this.open();
    const iv = randomBytes(12);
    const plain = utf8ToBytes(JSON.stringify(value));
    const aad = utf8ToBytes(`MSG-IDB-REC-v1:${recordId}`);
    const ct = await aesGcmEncrypt(this._masterKey, iv, plain, aad);
    wipe(plain);

    const payload = { iv: toBase64Url(iv), ct: toBase64Url(ct) };
    if (!this._db) {
      this._memVault.set(recordId, payload);
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = this._db.transaction(STORE_VAULT, 'readwrite');
      tx.objectStore(STORE_VAULT).put(payload, recordId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Чтение и расшифровка записи из локального хранилища */
  async getEncryptedRecord(recordId) {
    await this.open();
    let payload = null;
    if (!this._db) {
      payload = this._memVault.get(recordId) || null;
    } else {
      payload = await new Promise((resolve, reject) => {
        const tx = this._db.transaction(STORE_VAULT, 'readonly');
        const req = tx.objectStore(STORE_VAULT).get(recordId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }
    if (!payload) return null;

    const aad = utf8ToBytes(`MSG-IDB-REC-v1:${recordId}`);
    const pt = await aesGcmDecrypt(
      this._masterKey,
      fromBase64Url(payload.iv),
      fromBase64Url(payload.ct),
      aad
    );
    const parsed = JSON.parse(bytesToUtf8(pt));
    wipe(pt);
    return parsed;
  }

  async deleteEncryptedRecord(recordId) {
    if (!this._db) {
      this._memVault.delete(recordId);
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = this._db.transaction(STORE_VAULT, 'readwrite');
      tx.objectStore(STORE_VAULT).delete(recordId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Полное уничтожение всех ключей и сессий на устройстве (выход с зачисткой / тревожная кнопка) */
  async wipeAll() {
    this._masterKey = null;
    this._memKeys.clear();
    this._memVault.clear();
    if (!this._db) return;
    await new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_KEYS, STORE_VAULT], 'readwrite');
      tx.objectStore(STORE_KEYS).clear();
      tx.objectStore(STORE_VAULT).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
