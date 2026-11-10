/**
 * Application level protocol that lives *inside* the encrypted channel.
 *
 * Every payload is padded to a multiple of 256 bytes before encryption so the
 * relay (and anyone watching the wire) cannot tell "ok" from a three page
 * message, nor infer content from length.
 */
import { concat, str, utf8 } from './sodium';

export const PAD_BLOCK = 256;

export type Payload =
  | { t: 'msg'; id: string; ts: number; text: string; ttl?: number; replyTo?: string }
  | { t: 'ack'; ids: string[]; state: 'delivered' | 'read'; ts: number }
  | { t: 'typing'; on: boolean; ts: number }
  | { t: 'profile'; name: string; about?: string; ts: number }
  | { t: 'delete'; ids: string[]; ts: number }
  | {
      t: 'file';
      id: string;
      ts: number;
      name: string;
      mime: string;
      size: number;
      index: number;
      total: number;
      data: string;
      ttl?: number;
    }
  | { t: 'receipt-settings'; readReceipts: boolean; ts: number };

export function encodePayload(payload: Payload): Uint8Array {
  const body = utf8(JSON.stringify(payload));
  if (body.length > 0xffff) throw new Error('payload too large');
  const framed = new Uint8Array(2 + body.length);
  framed[0] = (body.length >> 8) & 0xff;
  framed[1] = body.length & 0xff;
  framed.set(body, 2);
  const padded = Math.max(2, Math.ceil(framed.length / PAD_BLOCK) * PAD_BLOCK);
  const out = new Uint8Array(padded);
  out.set(framed, 0);
  return out;
}

export function decodePayload(bytes: Uint8Array): Payload {
  if (bytes.length < 2) throw new Error('short payload');
  const len = (bytes[0] << 8) | bytes[1];
  if (len > bytes.length - 2) throw new Error('corrupt payload');
  const json = str(bytes.slice(2, 2 + len));
  const payload = JSON.parse(json) as Payload;
  if (!payload || typeof payload.t !== 'string') throw new Error('corrupt payload');
  return payload;
}

/** File chunk sizing, padded so all chunks except the last look identical. */
export const FILE_CHUNK_BYTES = 32 * 1024;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function padFileChunk(data: Uint8Array): Uint8Array {
  const padded = Math.ceil((data.length + 2) / PAD_BLOCK) * PAD_BLOCK;
  const out = new Uint8Array(padded);
  out[0] = (data.length >> 8) & 0xff;
  out[1] = data.length & 0xff;
  out.set(data, 2);
  return out;
}

export function unpadFileChunk(bytes: Uint8Array): Uint8Array {
  const len = (bytes[0] << 8) | bytes[1];
  if (len > bytes.length - 2) throw new Error('corrupt chunk');
  return bytes.slice(2, 2 + len);
}

export function totalChunks(size: number): number {
  return Math.max(1, Math.ceil(size / FILE_CHUNK_BYTES));
}

export function concatAll(chunks: Uint8Array[]): Uint8Array {
  return concat(...chunks);
}
