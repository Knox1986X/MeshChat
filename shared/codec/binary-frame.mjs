// Компактный бинарный протокол кадрирования поверх любого транспорта (WS, Tor, I2P, WebRTC).
// Устраняет +33% накладных расходов Base64 при передаче конвертов Sealed Sender и файлов.
//
// Формат кадра:
//   [0]      magic/version = 0x56 ('V', версия 1)
//   [1]      type          = RPC_REQ(1) | RPC_RES(2) | EVENT(3) | PING(4) | PONG(5) | COVER(6)
//   [2..5]   reqId         = uint32 big-endian (0 для событий и cover-трафика)
//   [6..7]   metaLen       = uint16 big-endian (длина UTF-8 JSON метаданных, 0..65535)
//   [8..8+M] metaBytes     = UTF-8 JSON (метод, параметры без блобов, код ошибки)
//   [8+M..]  body          = сырой бинарный Uint8Array (например, конверт Sealed Sender)

const PROTOCOL_MAGIC = 0x56;
const HEADER_FIXED_LEN = 8;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const FRAME_TYPE = Object.freeze({
  RPC_REQ: 0x01,
  RPC_RES: 0x02,
  EVENT: 0x03,
  PING: 0x04,
  PONG: 0x05,
  COVER: 0x06,
});

/** Сериализует кадр в единый Uint8Array */
export function encodeFrame({ type, id = 0, meta = null, body = null }) {
  if (type < 1 || type > 6) {
    throw new Error(`Неизвестный тип бинарного кадра: ${type}`);
  }
  const metaBytes = meta !== null && meta !== undefined
    ? encoder.encode(JSON.stringify(meta))
    : new Uint8Array(0);

  if (metaBytes.byteLength > 0xffff) {
    throw new Error(`Заголовок кадра превышает 64 КБ (${metaBytes.byteLength} Б)`);
  }

  const bodyBytes = body
    ? (body instanceof Uint8Array ? body : new Uint8Array(body))
    : new Uint8Array(0);

  const total = HEADER_FIXED_LEN + metaBytes.byteLength + bodyBytes.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  out[0] = PROTOCOL_MAGIC;
  out[1] = type;
  view.setUint32(2, id >>> 0, false);
  view.setUint16(6, metaBytes.byteLength, false);

  if (metaBytes.byteLength > 0) {
    out.set(metaBytes, HEADER_FIXED_LEN);
  }
  if (bodyBytes.byteLength > 0) {
    out.set(bodyBytes, HEADER_FIXED_LEN + metaBytes.byteLength);
  }
  return out;
}

/** Декодирует Uint8Array обратно в структуру { type, id, meta, body } */
export function decodeFrame(rawBytes) {
  const buf = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
  if (buf.byteLength < HEADER_FIXED_LEN) {
    throw new Error('Повреждён бинарный кадр: длина меньше 8 байт');
  }
  if (buf[0] !== PROTOCOL_MAGIC) {
    throw new Error(`Неподдерживаемая сигнатура кадра: 0x${buf[0].toString(16)}`);
  }

  const type = buf[1];
  if (type < 1 || type > 6) {
    throw new Error(`Неизвестный тип бинарного кадра: ${type}`);
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const id = view.getUint32(2, false);
  const metaLen = view.getUint16(6, false);

  if (HEADER_FIXED_LEN + metaLen > buf.byteLength) {
    throw new Error('Повреждён бинарный кадр: metaLen выходит за границы пакета');
  }

  let meta = null;
  if (metaLen > 0) {
    const metaSlice = buf.subarray(HEADER_FIXED_LEN, HEADER_FIXED_LEN + metaLen);
    meta = JSON.parse(decoder.decode(metaSlice));
  }

  const bodyOffset = HEADER_FIXED_LEN + metaLen;
  const body = bodyOffset < buf.byteLength
    ? buf.subarray(bodyOffset)
    : new Uint8Array(0);

  return { type, id, meta, body };
}

/** Формирует шумовой пакет фиксированного размера (512 Б) для маскировки простоев канала */
export function createCoverFrame(size = 512) {
  const payloadLen = Math.max(32, size - HEADER_FIXED_LEN);
  const noise = new Uint8Array(payloadLen);
  globalThis.crypto.getRandomValues(noise);
  return encodeFrame({ type: FRAME_TYPE.COVER, id: 0, meta: null, body: noise });
}
