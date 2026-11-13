// RPC-клиент для обращения к изолированному Crypto Web Worker из UI и Store.
// Поддерживает zero-copy передачу буферов (Transferable) при шифровании больших файлов.

export class CryptoWorkerClient {
  constructor(workerUrl = '/js/crypto/crypto.worker.mjs') {
    this._workerUrl = workerUrl;
    this._worker = null;
    this._seq = 0;
    this._pending = new Map();
  }

  start() {
    if (this._worker) return;
    this._worker = new Worker(this._workerUrl, { type: 'module', name: 'veil-crypto-worker' });
    this._worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data || {};
      const waiter = this._pending.get(id);
      if (!waiter) return;
      this._pending.delete(id);
      clearTimeout(waiter.timer);
      if (ok) waiter.resolve(result);
      else waiter.reject(new Error(error || 'Ошибка в CryptoWorker'));
    };
    this._worker.onerror = (err) => {
      for (const [, w] of this._pending) {
        clearTimeout(w.timer);
        w.reject(new Error(err?.message || 'Сбой потока CryptoWorker'));
      }
      this._pending.clear();
    };
  }

  call(method, params = {}, transfer = [], timeoutMs = 45000) {
    this.start();
    const id = ++this._seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending.delete(id)) {
          reject(new Error(`Таймаут криптооперации ${method} (${timeoutMs} мс)`));
        }
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._worker.postMessage({ id, method, params }, transfer);
    });
  }

  terminate() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    for (const [, w] of this._pending) {
      clearTimeout(w.timer);
      w.reject(new Error('CryptoWorker остановлен'));
    }
    this._pending.clear();
  }
}
