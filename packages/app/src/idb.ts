import type { KVStore } from '../../core/src/storage';

/** IndexedDB backed key/value store (the engine keeps one JSON blob in it). */
export class IdbKV implements KVStore {
  private db: IDBDatabase;
  private readonly store = 'kv';

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(name = 'meshchat'): Promise<IdbKV> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new IdbKV(db);
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(this.store, mode).objectStore(this.store);
  }

  private request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get(key: string): Promise<string | null> {
    const value = await this.request<string | undefined>(this.tx('readonly').get(key));
    return value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.request(this.tx('readwrite').put(value, key));
  }

  async del(key: string): Promise<void> {
    await this.request(this.tx('readwrite').delete(key));
  }

  async keys(): Promise<string[]> {
    const keys = await this.request<IDBValidKey[]>(this.tx('readonly').getAllKeys());
    return keys.map(String);
  }

  async clear(): Promise<void> {
    await this.request(this.tx('readwrite').clear());
  }
}

/** Fallback for private windows where IndexedDB is unavailable. */
export class MemoryFallback implements KVStore {
  private map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

export async function openStorage(): Promise<KVStore> {
  try {
    return await IdbKV.open();
  } catch {
    console.warn('MeshChat: IndexedDB unavailable, using in-memory storage');
    return new MemoryFallback();
  }
}
