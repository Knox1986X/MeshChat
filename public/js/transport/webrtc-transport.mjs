// P2P Mesh-транспорт поверх WebRTC RTCDataChannel (до 8 пиров одновременно без участия сервера в трафике).
// Назначение:
//   1. Прямая P2P-синхронизация между собственными устройствами пользователя (телефон <-> ноутбук).
//   2. Прямые чаты и малые группы до 8 участников (после обмена SDP через эфемерный сигналинг или QR).
//
// Инженерные гарантии:
//   - Автоматическая нарезка пакетов по 16 КБ и сборка на приёме (совместимость SCTP Firefox <-> Chromium).
//   - Поддержка режима relayOnly = true (использует только 5-минутный эфемерный TURN, скрывая домашний IP пиров).
//   - Явно помечен exposesIp = true в реестре: в режимах TOR_ONLY / I2P_ONLY жёстко отключается против STUN-утечек!

import { BaseTransport, TRANSPORT_STATE } from './transport-interface.mjs';
import { transportRegistry } from './transport-registry.mjs';

export const MAX_MESH_PEERS = 8;
const CHUNK_MAGIC = 0x57; // 'W'
const CHUNK_HEADER_BYTES = 10; // [magic(1), flags(1), msgId(4), chunkIdx(2), totalChunks(2)]
const MAX_SCTP_CHUNK_PAYLOAD = 16 * 1024;

/** Разбивает произвольный Uint8Array на SCTP-безопасные чанки по 16 КБ */
export function splitIntoRtcChunks(bytes, msgSeq = 1) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const totalChunks = Math.max(1, Math.ceil(src.byteLength / MAX_SCTP_CHUNK_PAYLOAD));
  if (totalChunks > 4096) {
    throw new Error('Пакет превышает максимальный размер P2P-передачи (64 МБ)');
  }

  const chunks = [];
  for (let idx = 0; idx < totalChunks; idx++) {
    const start = idx * MAX_SCTP_CHUNK_PAYLOAD;
    const slice = src.subarray(start, Math.min(src.byteLength, start + MAX_SCTP_CHUNK_PAYLOAD));
    const packet = new Uint8Array(CHUNK_HEADER_BYTES + slice.byteLength);
    const view = new DataView(packet.buffer);
    packet[0] = CHUNK_MAGIC;
    packet[1] = totalChunks === 1 ? 0x01 : 0x00;
    view.setUint32(2, msgSeq >>> 0, false);
    view.setUint16(6, idx, false);
    view.setUint16(8, totalChunks, false);
    packet.set(slice, CHUNK_HEADER_BYTES);
    chunks.push(packet);
  }
  return chunks;
}

export class WebRTCTransport extends BaseTransport {
  /**
   * @param {object} options
   * @param {Array}    [options.iceServers]            Список STUN/TURN серверов (из turn.credentials)
   * @param {boolean}  [options.relayOnly=false]       Строгий TURN relay без раскрытия локального/публичного IP пиру
   * @param {Function} [options.sendSignal]            Коллбэк отправки E2E-зашифрованного SDP/ICE пакета пиру
   * @param {Function} [options.RTCPeerConnectionImpl] Инъекция конструктора для модульных тестов в Node.js
   */
  constructor(options = {}) {
    const isRelayOnly = Boolean(options.relayOnly || options.iceTransportPolicy === 'relay');
    super({
      id: 'webrtc',
      title: 'WebRTC P2P Mesh (до 8 пиров)',
      kind: 'p2p',
      exposesIp: !isRelayOnly, // Без relayOnly пиры видят ICE-кандидаты друг друга
    });

    this.iceServers = options.iceServers || [{ urls: ['stun:stun.cloudflare.com:3478'] }];
    this.relayOnly = isRelayOnly;
    this.sendSignal = options.sendSignal || null;
    this._PeerConn = options.RTCPeerConnectionImpl || globalThis.RTCPeerConnection;

    this.peers = new Map(); // peerId -> { pc, dc, reassembly: Map<msgId, { got, parts, ts }> }
    this._msgSeq = 0;
  }

  /** Готовность P2P-слоя (хотя бы один открытый DataChannel либо готовность принимать пиров) */
  async connect() {
    if (!this._PeerConn) {
      const err = new Error('RTCPeerConnection не поддерживается в данном окружении');
      this._setState(TRANSPORT_STATE.DISCONNECTED, { error: err });
      throw err;
    }
    if (this._countOpenChannels() > 0) {
      this._setState(TRANSPORT_STATE.CONNECTED);
      return;
    }
    // Если функция автодиала стартовых пиров задана в конфиге — инициируем рукопожатие
    this._setState(TRANSPORT_STATE.CONNECTING);
    if (this._countOpenChannels() === 0 && !this.sendSignal) {
      const err = new Error('Нет активных P2P-каналов и не задан канал сигналинга');
      this._setState(TRANSPORT_STATE.DISCONNECTED, { error: err });
      throw err;
    }
  }

  /** Инициирует прямое P2P-соединение с новым узлом mesh-сети (лимит — 8 пиров) */
  async connectToPeer(peerId) {
    if (this.peers.size >= MAX_MESH_PEERS && !this.peers.has(peerId)) {
      throw new Error(`Достигнут предел WebRTC Mesh (${MAX_MESH_PEERS} участников)`);
    }
    const entry = this._ensurePeerEntry(peerId, true);
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    if (this.sendSignal) {
      await this.sendSignal(peerId, { type: 'offer', sdp: entry.pc.localDescription });
    }
    return entry.pc.localDescription;
  }

  /** Обрабатывает входящий E2E-зашифрованный пакет сигналинга (offer / answer / candidate) */
  async handleIncomingSignal(peerId, signalMsg) {
    if (!signalMsg || typeof signalMsg.type !== 'string') return null;
    if (this.peers.size >= MAX_MESH_PEERS && !this.peers.has(peerId)) {
      throw new Error(`Отклонено входящее соединение: лимит mesh (${MAX_MESH_PEERS})`);
    }

    if (signalMsg.type === 'offer') {
      const entry = this._ensurePeerEntry(peerId, false);
      await entry.pc.setRemoteDescription(signalMsg.sdp);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      if (this.sendSignal) {
        await this.sendSignal(peerId, { type: 'answer', sdp: entry.pc.localDescription });
      }
      return entry.pc.localDescription;
    }

    const entry = this.peers.get(peerId);
    if (!entry) return null;

    if (signalMsg.type === 'answer') {
      await entry.pc.setRemoteDescription(signalMsg.sdp);
    } else if (signalMsg.type === 'candidate' && signalMsg.candidate) {
      await entry.pc.addIceCandidate(signalMsg.candidate);
    }
    return null;
  }

  /**
   * Отправляет бинарный пакет либо конкретному пиру, либо веерно всем открытым узлам mesh-группы.
   */
  async send(bytes, { targetPeerId = null } = {}) {
    const targets = [];
    if (targetPeerId) {
      const p = this.peers.get(targetPeerId);
      if (p?.dc?.readyState === 'open') targets.push(p.dc);
    } else {
      for (const p of this.peers.values()) {
        if (p.dc?.readyState === 'open') targets.push(p.dc);
      }
    }

    if (targets.length === 0) {
      throw new Error('Нет открытых каналов RTCDataChannel для отправки');
    }

    const seq = (this._msgSeq = (this._msgSeq + 1) >>> 0) || 1;
    const chunks = splitIntoRtcChunks(bytes, seq);

    for (const dc of targets) {
      for (const ch of chunks) {
        dc.send(ch);
      }
    }
    const byteLen = bytes.byteLength ?? bytes.length;
    this.stats.bytesSent += byteLen * targets.length;
    this.stats.messagesSent += 1;
    return true;
  }

  async close(reason = 'closed_by_client') {
    for (const [, entry] of this.peers) {
      try { entry.dc?.close(); } catch { /* ignore */ }
      try { entry.pc?.close(); } catch { /* ignore */ }
      entry.reassembly.clear();
    }
    this.peers.clear();
    this._setState(TRANSPORT_STATE.CLOSED, { reason });
  }

  getConnectedPeerIds() {
    const out = [];
    for (const [id, entry] of this.peers.entries()) {
      if (entry.dc?.readyState === 'open') out.push(id);
    }
    return out;
  }

  _countOpenChannels() {
    return this.getConnectedPeerIds().length;
  }

  _ensurePeerEntry(peerId, isInitiator) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);

    const pc = new this._PeerConn({
      iceServers: this.iceServers,
      iceTransportPolicy: this.relayOnly ? 'relay' : 'all',
    });

    const entry = {
      peerId,
      pc,
      dc: null,
      reassembly: new Map(),
    };
    this.peers.set(peerId, entry);

    pc.onicecandidate = (ev) => {
      if (ev?.candidate && this.sendSignal) {
        this.sendSignal(peerId, { type: 'candidate', candidate: ev.candidate }).catch(() => {});
      }
    };

    if (isInitiator) {
      const dc = pc.createDataChannel('veil-mesh-v1', { ordered: true });
      this._bindDataChannel(entry, dc);
    } else {
      pc.ondatachannel = (ev) => {
        if (ev?.channel) this._bindDataChannel(entry, ev.channel);
      };
    }

    return entry;
  }

  _bindDataChannel(entry, dc) {
    entry.dc = dc;
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      this._setState(TRANSPORT_STATE.CONNECTED, { peerId: entry.peerId, meshSize: this._countOpenChannels() });
    };

    dc.onclose = () => {
      this.peers.delete(entry.peerId);
      if (this._countOpenChannels() === 0 && this.state !== TRANSPORT_STATE.CLOSED) {
        this._setState(TRANSPORT_STATE.DISCONNECTED, { peerId: entry.peerId });
      }
    };

    dc.onmessage = (ev) => {
      const raw = ev.data instanceof Uint8Array
        ? ev.data
        : new Uint8Array(ev.data);
      this._reassembleIncomingChunk(entry, raw);
    };
  }

  _reassembleIncomingChunk(entry, packet) {
    if (packet.byteLength < CHUNK_HEADER_BYTES || packet[0] !== CHUNK_MAGIC) {
      // Обратная совместимость с одиночным сырым кадром
      this._emitMessage(packet);
      return;
    }

    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const msgId = view.getUint32(2, false);
    const chunkIdx = view.getUint16(6, false);
    const totalChunks = view.getUint16(8, false);
    const body = packet.subarray(CHUNK_HEADER_BYTES);

    if (totalChunks === 1 && chunkIdx === 0) {
      this._emitMessage(body);
      return;
    }

    if (totalChunks === 0 || chunkIdx >= totalChunks || totalChunks > 4096) return;

    let slot = entry.reassembly.get(msgId);
    if (!slot) {
      slot = { total: totalChunks, got: 0, parts: new Array(totalChunks), ts: Date.now() };
      entry.reassembly.set(msgId, slot);
    }
    if (!slot.parts[chunkIdx]) {
      slot.parts[chunkIdx] = new Uint8Array(body);
      slot.got += 1;
    }

    if (slot.got === slot.total) {
      entry.reassembly.delete(msgId);
      let fullLen = 0;
      for (const p of slot.parts) fullLen += p.byteLength;
      const merged = new Uint8Array(fullLen);
      let offset = 0;
      for (const p of slot.parts) {
        merged.set(p, offset);
        offset += p.byteLength;
      }
      this._emitMessage(merged);
    }
  }
}

transportRegistry.register({
  id: 'webrtc',
  title: 'WebRTC P2P Mesh',
  description: 'Прямой зашифрованный обмен между устройствами без участия сервера (до 8 пиров)',
  kind: 'p2p',
  exposesIp: true, // Блокируется реестром при политике TOR_ONLY / I2P_ONLY против STUN-утечки IP
  priority: 20,
  connectTimeoutMs: 8000,
  isSupported: (cfg) =>
    Boolean((cfg?.RTCPeerConnectionImpl || globalThis.RTCPeerConnection) && cfg?.enableMeshDial),
  create: (cfg) => new WebRTCTransport(cfg),
});
