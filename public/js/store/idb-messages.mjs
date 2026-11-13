// Локальное зашифрованное хранилище клиента в IndexedDB (не localStorage!).
// Все записи (сессия, список чатов, история сообщений, очередь Outbox) шифруются на лету
// неизвлекаемым ключом AES-256-GCM (extractable: false), хранящимся в отдельном store IndexedDB.

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

const DB_NAME = 'veil_client_storage_v1';
const DB_VER = 1;
const STORE_KEY = 'master_key';
const STORE_DATA = 'encrypted_kv';

export class EncryptedClientDb {
  constructor() {
    this._db = null;
    this._key = null;
    this._mem = new Map();
  }

  async open() {
    if (this._key) return;
    if (typeof indexedDB !== 'undefined') {
      this._db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_KEY)) db.createObjectStore(STORE_KEY);
          if (!db.objectStoreNames.contains(STORE_DATA)) db.createObjectStore(STORE_DATA);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    let mk = await this._rawGet(STORE_KEY, 'clientMasterKey');
    if (!mk) {
      mk = await generateNonExtractableDbKey();
      await this._rawPut(STORE_KEY, 'clientMasterKey', mk);
    }
    this._key = mk;
  }

  async get(key, fallback = null) {
    await this.open();
    const rec = await this._rawGet(STORE_DATA, key);
    if (!rec) return fallback;
    try {
      const aad = utf8ToBytes(`VEIL-CLIENT-KV-v1:${key}`);
      const pt = await aesGcmDecrypt(this._key, fromBase64Url(rec.iv), fromBase64Url(rec.ct), aad);
      const val = JSON.parse(bytesToUtf8(pt));
      wipe(pt);
      return val;
    } catch {
      return fallback;
    }
  }

  async set(key, value) {
    await this.open();
    const iv = randomBytes(12);
    const plain = utf8ToBytes(JSON.stringify(value));
    const aad = utf8ToBytes(`VEIL-CLIENT-KV-v1:${key}`);
    const ct = await aesGcmEncrypt(this._key, iv, plain, aad);
    wipe(plain);
    await this._rawPut(STORE_DATA, key, { iv: toBase64Url(iv), ct: toBase64Url(ct) });
  }

  async del(key) {
    await this.open();
    if (!this._db) {
      this._mem.delete(`${STORE_DATA}:${key}`);
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = this._db.transaction(STORE_DATA, 'readwrite');
      tx.objectStore(STORE_DATA).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearAll() {
    this._key = null;
    this._mem.clear();
    if (!this._db) return;
    await new Promise((resolve, reject) => {
      const tx = this._db.transaction([STORE_KEY, STORE_DATA], 'readwrite');
      tx.objectStore(STORE_KEY).clear();
      tx.objectStore(STORE_DATA).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async _rawGet(storeName, key) {
    if (!this._db) return this._mem.get(`${storeName}:${key}`) || null;
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async _rawPut(storeName, key, val) {
    if (!this._db) {
      this._mem.set(`${storeName}:${key}`, val);
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
