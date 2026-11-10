/** Minimal async key/value store so the engine works in a browser and in Node. */
export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

export class MemoryKV implements KVStore {
  private map = new Map<string, string>();
  constructor(seed?: Record<string, string>) {
    if (seed) for (const [k, v] of Object.entries(seed)) this.map.set(k, v);
  }
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

export const STATE_KEY = 'meshchat/state/v1';
