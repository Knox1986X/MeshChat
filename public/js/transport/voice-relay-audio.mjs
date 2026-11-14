// Сквозной зашифрованный голосовой движок реального времени (AES-256-GCM + ITU-T G.711 μ-law 8 кГц)
// Обеспечивает гарантированную двустороннюю голосовую связь через мобильные сети 4G/LTE (Symmetric CGNAT),
// когда прямое UDP-соединение WebRTC блокируется оператором связи. Ключ звонка передаётся только внутри Double Ratchet.

const TARGET_SAMPLE_RATE = 8000;
const FRAME_SAMPLES = 1280; // 160 мс при 8000 Гц (~6.25 кадра/с, ~8 КБ/с)
const ULAW_BIAS = 0x84;
const ULAW_CLIP = 32635;

/** Кодирует один 16-битный линейный PCM-отсчёт [-32768..32767] в 8-битный байт ITU-T G.711 μ-law */
export function encodeMuLawSample(pcm16) {
  let sample = pcm16 | 0;
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > ULAW_CLIP) sample = ULAW_CLIP;
  sample += ULAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    // Поиск старшего значащего сегмента логарифмической шкалы
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

/** Декодирует 8-битный байт ITU-T G.711 μ-law обратно в нормированный Float32 [-1..1] */
export function decodeMuLawSampleToFloat(ulawByte) {
  const u = (~ulawByte) & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = (((mantissa << 3) + ULAW_BIAS) << exponent) - ULAW_BIAS;
  if (sign !== 0) sample = -sample;
  return Math.max(-1, Math.min(1, sample / 32768));
}

// Предвычисленная таблица декодирования μ-law (256 значений) для нулевой нагрузки на CPU в аудиопотоке
const ULAW_DECODE_TABLE = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  ULAW_DECODE_TABLE[i] = decodeMuLawSampleToFloat(i);
}

/** Понижает частоту дискретизации входного Float32-буфера до 8000 Гц с усреднением и кодирует в μ-law */
export function downsampleAndEncodeMuLaw(inputFloat32, inputSampleRate) {
  if (!inputFloat32 || inputFloat32.length === 0) return new Uint8Array(0);
  if (inputSampleRate <= TARGET_SAMPLE_RATE) {
    const out = new Uint8Array(inputFloat32.length);
    for (let i = 0; i < inputFloat32.length; i++) {
      const clamped = Math.max(-1, Math.min(1, inputFloat32[i]));
      out[i] = encodeMuLawSample((clamped * 32767) | 0);
    }
    return out;
  }

  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(inputFloat32.length / ratio);
  const out = new Uint8Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(inputFloat32.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += inputFloat32[j];
    }
    const avg = sum / (end - start);
    const clamped = Math.max(-1, Math.min(1, avg));
    out[i] = encodeMuLawSample((clamped * 32767) | 0);
  }
  return out;
}

/** Декодирует буфер μ-law в Float32Array для воспроизведения через Web Audio API */
export function decodeMuLawBuffer(ulawBytes) {
  const out = new Float32Array(ulawBytes.length);
  for (let i = 0; i < ulawBytes.length; i++) {
    out[i] = ULAW_DECODE_TABLE[ulawBytes[i]];
  }
  return out;
}

/** Вычисляет 8-байтный тег идентификатора звонка для быстрой фильтрации бинарных кадров */
export async function deriveCallTagBytes(callId) {
  const data = new TextEncoder().encode(`MESHCHAT-CALL-TAG:${callId}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return hash.slice(0, 8);
}

/** Шифрует буфер аудиокадра ключом звонка AES-256-GCM: [8B callTag || 12B IV || Ciphertext+Tag] */
export async function encryptVoiceFrame(aesKey, callTag8, ulawBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: callTag8 },
    aesKey,
    ulawBytes
  );
  const ct = new Uint8Array(ctBuf);
  const packet = new Uint8Array(8 + 12 + ct.byteLength);
  packet.set(callTag8, 0);
  packet.set(iv, 8);
  packet.set(ct, 20);
  return packet;
}

/** Проверяет callTag и расшифровывает входящий бинарный аудиокадр AES-256-GCM */
export async function decryptVoiceFrame(aesKey, expectedCallTag8, packetBytes) {
  if (!(packetBytes instanceof Uint8Array) || packetBytes.byteLength < 36) {
    return null;
  }
  for (let i = 0; i < 8; i++) {
    if (packetBytes[i] !== expectedCallTag8[i]) return null;
  }
  const iv = packetBytes.subarray(8, 20);
  const ct = packetBytes.subarray(20);
  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: expectedCallTag8 },
      aesKey,
      ct
    );
    return new Uint8Array(plainBuf);
  } catch {
    return null;
  }
}

/**
 * Полнодуплексная сессия шифрованного голосового ретранслятора поверх Web Audio API.
 */
export class EncryptedVoiceRelaySession {
  /**
   * @param {object} opts
   * @param {string} opts.callId
   * @param {Uint8Array} opts.rawKey32 — 32-байтный секретный ключ звонка из Double Ratchet
   * @param {MediaStream|null} opts.localStream — захваченный поток микрофона
   * @param {(packetBytes: Uint8Array) => Promise<void>} opts.onSendFrame — отправка зашифрованного кадра
   */
  constructor({ callId, rawKey32, localStream, onSendFrame }) {
    this.callId = callId;
    this.rawKey32 = rawKey32;
    this.localStream = localStream;
    this.onSendFrame = onSendFrame;

    this.aesKey = null;
    this.callTag8 = null;
    this.audioCtx = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.silentGain = null;

    this.active = false;
    this.muted = false;
    this.suppressedByP2p = false;
    this.nextPlayTime = 0;
    this.rxFrames = 0;
    this.txFrames = 0;

    this._pendingRing = new Uint8Array(FRAME_SAMPLES * 4);
    this._pendingLen = 0;
    this._sendingInFlight = false;
  }

  async start() {
    if (this.active) return;
    this.active = true;

    this.callTag8 = await deriveCallTagBytes(this.callId);
    this.aesKey = await crypto.subtle.importKey(
      'raw',
      this.rawKey32,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );

    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return;

    this.audioCtx = new AudioCtx();
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    if (this.localStream && this.localStream.getAudioTracks().length > 0) {
      try {
        this.sourceNode = this.audioCtx.createMediaStreamSource(this.localStream);
        // Буфер 4096 при 48 кГц даёт ~85 мс (~682 отсчёта 8 кГц), каждые ~2 тика отправляется 160-мс кадр
        this.processorNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
        this.silentGain = this.audioCtx.createGain();
        this.silentGain.gain.value = 0;

        this.processorNode.onaudioprocess = (ev) => {
          if (!this.active || this.muted || this.suppressedByP2p) return;
          const input = ev.inputBuffer.getChannelData(0);
          const encoded = downsampleAndEncodeMuLaw(input, this.audioCtx.sampleRate);
          if (encoded.length === 0) return;

          if (this._pendingLen + encoded.length <= this._pendingRing.length) {
            this._pendingRing.set(encoded, this._pendingLen);
            this._pendingLen += encoded.length;
          }

          if (this._pendingLen >= FRAME_SAMPLES && !this._sendingInFlight) {
            const frame = this._pendingRing.slice(0, FRAME_SAMPLES);
            this._pendingRing.copyWithin(0, FRAME_SAMPLES, this._pendingLen);
            this._pendingLen -= FRAME_SAMPLES;
            this._flushEncryptedFrame(frame);
          }
        };

        this.sourceNode.connect(this.processorNode);
        this.processorNode.connect(this.silentGain);
        this.silentGain.connect(this.audioCtx.destination);
      } catch {
        // Даже если микрофон недоступен, приём и воспроизведение голоса собеседника продолжают работать
      }
    }
  }

  async _flushEncryptedFrame(ulawFrame) {
    if (!this.active || !this.aesKey || !this.callTag8) return;
    this._sendingInFlight = true;
    try {
      const packet = await encryptVoiceFrame(this.aesKey, this.callTag8, ulawFrame);
      this.txFrames += 1;
      await this.onSendFrame(packet);
    } catch {
      // Потеря отдельного голосового UDP/WS-кадра не обрывает звонок
    } finally {
      this._sendingInFlight = false;
    }
  }

  /** Расшифровывает и ставит входящий голосовой кадр в бесшовную очередь воспроизведения */
  async handleIncomingPacket(packetBytes) {
    if (!this.active || !this.aesKey || !this.callTag8 || !this.audioCtx) return false;
    // Если прямое P2P-соединение активно и передаёт звук, не дублируем аудиопоток
    if (this.suppressedByP2p) return false;

    const ulaw = await decryptVoiceFrame(this.aesKey, this.callTag8, packetBytes);
    if (!ulaw || ulaw.length === 0) return false;

    this.rxFrames += 1;
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume().catch(() => {});
    }

    const pcmFloat = decodeMuLawBuffer(ulaw);
    const audioBuf = this.audioCtx.createBuffer(1, pcmFloat.length, TARGET_SAMPLE_RATE);
    audioBuf.copyToChannel(pcmFloat, 0);

    const now = this.audioCtx.currentTime;
    if (this.nextPlayTime < now + 0.01 || this.nextPlayTime > now + 0.45) {
      // Адаптивный джиттер-буфер 85 мс с защитой от накопления задержки на мобильном 4G
      this.nextPlayTime = now + 0.085;
    }

    const src = this.audioCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this.audioCtx.destination);
    src.start(this.nextPlayTime);
    this.nextPlayTime += audioBuf.duration;
    return true;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
  }

  setSuppressedByP2p(suppressed) {
    this.suppressedByP2p = Boolean(suppressed);
    if (this.suppressedByP2p) {
      this._pendingLen = 0;
    }
  }

  stop() {
    this.active = false;
    this._pendingLen = 0;
    try {
      if (this.processorNode) {
        this.processorNode.onaudioprocess = null;
        this.processorNode.disconnect();
      }
    } catch {}
    try {
      if (this.sourceNode) this.sourceNode.disconnect();
    } catch {}
    try {
      if (this.silentGain) this.silentGain.disconnect();
    } catch {}
    try {
      if (this.audioCtx && this.audioCtx.state !== 'closed') {
        this.audioCtx.close().catch(() => {});
      }
    } catch {}
    this.processorNode = null;
    this.sourceNode = null;
    this.silentGain = null;
    this.audioCtx = null;
    this.aesKey = null;
  }
}
