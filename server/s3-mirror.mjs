// Автономный S3-совместимый клиент (AWS Signature V4) без тяжёлого aws-sdk.
// Работает с бесплатными тарифами Cloudflare R2 (10 ГБ), Backblaze B2 (10 ГБ), Yandex Object Storage и MinIO.
// Хранит только обезличенные зашифрованные блобы и сжатые снапшоты БД для эфемерных хостингов (Render Free).

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function encodeS3Path(key) {
  return String(key)
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export class S3Mirror {
  constructor(env = process.env) {
    this.endpoint = (env.S3_ENDPOINT || '').replace(/\/+$/, '');
    this.region = env.S3_REGION || 'auto';
    this.bucket = env.S3_BUCKET || '';
    this.accessKeyId = env.S3_KEY_ID || '';
    this.secretAccessKey = env.S3_SECRET || '';
    this.prefix = (env.S3_PREFIX || 'veil').replace(/^\/+|\/+$/g, '');

    this.enabled = Boolean(this.endpoint && this.bucket && this.accessKeyId && this.secretAccessKey);
    this.stats = { puts: 0, gets: 0, deletes: 0, lastSnapshotAt: 0, lastError: null };
  }

  /** Выполняет подписанный по AWS Signature V4 HTTP-запрос к S3-хранилищу */
  async request(method, objectKey, { body = Buffer.alloc(0), contentType = 'application/octet-stream', timeoutMs = 45000 } = {}) {
    if (!this.enabled) return { status: 0, body: Buffer.alloc(0) };

    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const fullKey = `${this.prefix}/${objectKey}`.replace(/\/+/g, '/');
    const url = new URL(`${this.endpoint}/${encodeURIComponent(this.bucket)}/${encodeS3Path(fullKey)}`);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(payload);

    const headers = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (method === 'PUT') {
      headers['content-type'] = contentType;
      headers['content-length'] = String(payload.length);
    }

    const sortedKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join('');
    const signedHeaders = sortedKeys.join(';');

    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    headers.authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(url, {
      method,
      headers,
      body: method === 'PUT' ? payload : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const resBuf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: resBuf };
  }

  async putBlob(blobId, encryptedBuffer) {
    if (!this.enabled) return false;
    try {
      const r = await this.request('PUT', `blobs/${blobId}.bin`, { body: encryptedBuffer });
      if (r.status >= 200 && r.status < 300) {
        this.stats.puts += 1;
        return true;
      }
      throw new Error(`S3 PUT blob HTTP ${r.status}`);
    } catch (err) {
      this.stats.lastError = err.message;
      return false;
    }
  }

  async getBlob(blobId) {
    if (!this.enabled) return null;
    try {
      const r = await this.request('GET', `blobs/${blobId}.bin`);
      if (r.status === 200) {
        this.stats.gets += 1;
        return r.body;
      }
      return null;
    } catch (err) {
      this.stats.lastError = err.message;
      return null;
    }
  }

  async deleteBlob(blobId) {
    if (!this.enabled) return false;
    try {
      const r = await this.request('DELETE', `blobs/${blobId}.bin`);
      if (r.status >= 200 && r.status < 300) {
        this.stats.deletes += 1;
        return true;
      }
      return false;
    } catch (err) {
      this.stats.lastError = err.message;
      return false;
    }
  }

  /** Сохраняет сжатый снапшот слепой базы данных в S3 (для Render Free / Fly.io без диска) */
  async pushSnapshot(jsonString) {
    if (!this.enabled) return false;
    try {
      const gz = await gzipAsync(Buffer.from(jsonString, 'utf8'), { level: 6 });
      const r = await this.request('PUT', 'snapshots/blind-state.json.gz', {
        body: gz,
        contentType: 'application/gzip',
      });
      if (r.status >= 200 && r.status < 300) {
        this.stats.lastSnapshotAt = Date.now();
        return true;
      }
      throw new Error(`S3 snapshot PUT HTTP ${r.status}`);
    } catch (err) {
      this.stats.lastError = err.message;
      return false;
    }
  }

  /** Восстанавливает последний снапшот базы данных при холодном старте эфемерного контейнера */
  async pullSnapshot() {
    if (!this.enabled) return null;
    try {
      const r = await this.request('GET', 'snapshots/blind-state.json.gz');
      if (r.status !== 200 || r.body.length === 0) return null;
      const raw = await gunzipAsync(r.body);
      return JSON.parse(raw.toString('utf8'));
    } catch (err) {
      this.stats.lastError = err.message;
      return null;
    }
  }
}
