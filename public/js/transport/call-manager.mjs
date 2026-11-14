// Менеджер защищённых голосовых вызовов P2P WebRTC (DTLS-SRTP) поверх сигналинга Signal Protocol.
// Все пакеты сигналинга (offer / answer / candidate / hangup / decline / busy) передаются строго
// внутри конвертов Double Ratchet + Sealed Sender; сервер не знает ни факта звонка, ни участников.
// Для защиты от MITM на медиапотоке вычисляет проверочный код DTLS SAS по обоим SDP-отпечаткам.

import { sha256, utf8ToBytes, randomBytes, toBase64Url } from '../../../shared/crypto/primitives.mjs';
import { TRANSPORT_POLICY } from './transport-interface.mjs';

/**
 * Извлекает строки криптографических отпечатков сертификатов DTLS из SDP и вычисляет
 * симметричный проверочный код (SAS) для голосовой сверки между собеседниками.
 */
export async function computeDtlsSas(localSdp = '', remoteSdp = '') {
  const extractFp = (sdp) => {
    const m = String(sdp || '').match(/a=fingerprint:([^\r\n]+)/i);
    return m ? m[1].trim().toUpperCase() : '';
  };
  const fpA = extractFp(localSdp);
  const fpB = extractFp(remoteSdp);
  if (!fpA || !fpB) return null;
  const ordered = [fpA, fpB].sort().join('||');
  const digest = await sha256(utf8ToBytes(`MESHCHAT-DTLS-SAS-v1:${ordered}`));
  const hex = Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${hex.slice(0, 4)} · ${hex.slice(4, 8)} · ${hex.slice(8, 12)} · ${hex.slice(12, 16)}`;
}

export class E2eeCallManager {
  /**
   * @param {object} deps
   * @param {(chat: object, payload: object) => Promise<void>} deps.sendSignalToChat
   * @param {() => void} deps.onStateChange
   * @param {(kind: string) => void} [deps.onRingTick]
   * @param {typeof RTCPeerConnection} [deps.RTCPeerConnectionImpl]
   * @param {() => Promise<MediaStream>} [deps.getUserAudioStream]
   */
  constructor(deps = {}) {
    this.sendSignalToChat = deps.sendSignalToChat;
    this.onStateChange = deps.onStateChange || (() => {});
    this.onRingTick = deps.onRingTick || null;
    this._PeerConn = deps.RTCPeerConnectionImpl || globalThis.RTCPeerConnection;
    this._getAudio = deps.getUserAudioStream || (() => this._defaultGetAudioStream());

    this.state = this._emptyState();
    this._pc = null;
    this._localStream = null;
    this._remoteAudioEl = null;
    this._pendingOfferSdp = null;
    this._queuedCandidates = [];
    this._durationTimer = null;
    this._ringTimer = null;
    this._levelTimer = null;
    this._audioCtx = null;
  }

  _emptyState() {
    return {
      active: false,
      callId: '',
      chatId: '',
      peerId: '',
      peerTitle: '',
      direction: 'outgoing', // 'outgoing' | 'incoming'
      phase: 'idle',         // 'idle' | 'ringing' | 'connecting' | 'connected' | 'ended'
      reason: '',
      muted: false,
      startedAt: 0,
      elapsedSec: 0,
      dtlsSas: null,
      micLevel: 0,
      relayOnly: false,
    };
  }

  async _defaultGetAudioStream() {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Доступ к микрофону (getUserMedia) не поддерживается в текущем окружении');
    }
    return globalThis.navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  }

  _ensureRemoteAudioElement(remoteStream) {
    if (typeof document === 'undefined') return;
    if (!this._remoteAudioEl) {
      this._remoteAudioEl = document.createElement('audio');
      this._remoteAudioEl.autoplay = true;
      this._remoteAudioEl.playsInline = true;
      this._remoteAudioEl.style.display = 'none';
      document.body.appendChild(this._remoteAudioEl);
    }
    this._remoteAudioEl.srcObject = remoteStream;
    this._remoteAudioEl.play?.().catch(() => {});
  }

  _startLevelMeter(stream) {
    if (typeof window === 'undefined') return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !stream?.getAudioTracks?.().length) return;
    try {
      this._audioCtx = new Ctx();
      const src = this._audioCtx.createMediaStreamSource(stream);
      const analyser = this._audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      clearInterval(this._levelTimer);
      this._levelTimer = setInterval(() => {
        if (this.state.muted || !this.state.active) {
          if (this.state.micLevel !== 0) {
            this.state.micLevel = 0;
            this.onStateChange();
          }
          return;
        }
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = Math.min(100, Math.round((sum / data.length) * 1.4));
        if (Math.abs(avg - this.state.micLevel) >= 6) {
          this.state.micLevel = avg;
          this.onStateChange();
        }
      }, 180);
      this._levelTimer?.unref?.();
    } catch { /* ignore */ }
  }

  _startRingLoop() {
    this._stopRingLoop();
    if (this.onRingTick) this.onRingTick();
    this._ringTimer = setInterval(() => {
      if (this.state.phase === 'ringing' && this.onRingTick) {
        this.onRingTick();
      }
    }, 2400);
    this._ringTimer?.unref?.();
  }

  _stopRingLoop() {
    clearInterval(this._ringTimer);
    this._ringTimer = null;
  }

  _markConnected() {
    if (this.state.phase === 'connected') return;
    this._stopRingLoop();
    this.state.phase = 'connected';
    this.state.startedAt = Date.now();
    this.state.elapsedSec = 0;
    clearInterval(this._durationTimer);
    this._durationTimer = setInterval(() => {
      if (this.state.phase === 'connected') {
        this.state.elapsedSec = Math.max(0, Math.floor((Date.now() - this.state.startedAt) / 1000));
        this.onStateChange();
      }
    }, 1000);
    this._durationTimer?.unref?.();
    this.onStateChange();
  }

  _createPeerConnection(chat, callId, iceServers, iceTransportPolicy) {
    if (!this._PeerConn) {
      throw new Error('WebRTC RTCPeerConnection недоступен в этом окружении');
    }
    const relayOnly = iceTransportPolicy === 'relay';
    const pc = new this._PeerConn({
      iceServers: iceServers || [],
      iceTransportPolicy: relayOnly ? 'relay' : 'all',
    });

    pc.onicecandidate = (ev) => {
      if (ev?.candidate && this.state.callId === callId) {
        this.sendSignalToChat(chat, {
          type: 'call-signal',
          callId,
          action: 'candidate',
          candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate,
        }).catch(() => {});
      }
    };

    pc.ontrack = (ev) => {
      const remoteStream = ev?.streams?.[0];
      if (remoteStream) {
        this._ensureRemoteAudioElement(remoteStream);
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        this._markConnected();
      } else if (st === 'failed' || st === 'disconnected' || st === 'closed') {
        if (this.state.active && this.state.callId === callId && st === 'failed') {
          this._teardown('Обрыв медиапотока ICE/DTLS');
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      const ist = pc.iceConnectionState;
      if (ist === 'connected' || ist === 'completed') {
        this._markConnected();
      }
    };

    return pc;
  }

  /** Запускает исходящий E2EE P2P аудиовызов */
  async startOutgoingCall({ chat, iceServers = [], iceTransportPolicy = 'all', transportPolicy = 'auto' }) {
    if (!chat || chat.kind !== 'dm') {
      throw new Error('Голосовые вызовы доступны только для прямых E2EE-контактов');
    }
    if (transportPolicy === TRANSPORT_POLICY.TOR_ONLY || transportPolicy === TRANSPORT_POLICY.I2P_ONLY) {
      throw new Error('В строгом режиме «Только Tor / I2P» прямой медиапоток WebRTC заблокирован для защиты IP');
    }
    if (this.state.active && this.state.phase !== 'ended') {
      throw new Error('Другой голосовой вызов уже активен');
    }

    this._cleanupMediaOnly();
    const callId = toBase64Url(randomBytes(9));
    this.state = {
      ...this._emptyState(),
      active: true,
      callId,
      chatId: chat.id,
      peerId: chat.peerId,
      peerTitle: chat.peerProfile?.displayName || chat.title,
      direction: 'outgoing',
      phase: 'ringing',
      relayOnly: iceTransportPolicy === 'relay',
    };
    this.onStateChange();

    try {
      const stream = await this._getAudio();
      this._localStream = stream;
      this._startLevelMeter(stream);

      const pc = this._createPeerConnection(chat, callId, iceServers, iceTransportPolicy);
      this._pc = pc;
      for (const track of stream.getTracks?.() || []) {
        pc.addTrack(track, stream);
      }

      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);

      await this.sendSignalToChat(chat, {
        type: 'call-signal',
        callId,
        action: 'offer',
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      });
    } catch (err) {
      this._teardown(err.message || 'Ошибка инициализации микрофона');
      throw err;
    }
  }

  /** Обрабатывает входящий зашифрованный пакет call-signal от собеседника */
  async handleIncomingSignal(chat, payload, { getIceServers, iceTransportPolicy = 'all', transportPolicy = 'auto' } = {}) {
    const { callId, action, sdp, candidate } = payload || {};
    if (!callId || !action || !chat) return;

    if (action === 'offer') {
      if (transportPolicy === TRANSPORT_POLICY.TOR_ONLY || transportPolicy === TRANSPORT_POLICY.I2P_ONLY) {
        await this.sendSignalToChat(chat, { type: 'call-signal', callId, action: 'decline' }).catch(() => {});
        return;
      }
      if (this.state.active && this.state.phase !== 'ended' && this.state.callId !== callId) {
        await this.sendSignalToChat(chat, { type: 'call-signal', callId, action: 'busy' }).catch(() => {});
        return;
      }

      this._cleanupMediaOnly();
      this._pendingOfferSdp = sdp;
      this._queuedCandidates = [];
      this._incomingCfg = { chat, getIceServers, iceTransportPolicy };

      this.state = {
        ...this._emptyState(),
        active: true,
        callId,
        chatId: chat.id,
        peerId: chat.peerId,
        peerTitle: chat.peerProfile?.displayName || chat.title,
        direction: 'incoming',
        phase: 'ringing',
        relayOnly: iceTransportPolicy === 'relay',
      };
      this._startRingLoop();
      this.onStateChange();
      return;
    }

    if (this.state.callId !== callId) return;

    if (action === 'answer' && this._pc && sdp) {
      this.state.phase = 'connecting';
      this.onStateChange();
      await this._pc.setRemoteDescription(sdp);
      await this._flushQueuedCandidates();
      this.state.dtlsSas = await computeDtlsSas(this._pc.localDescription?.sdp, sdp.sdp);
      // Если в тестовом или локальном окружении ICE уже готов, переводим в connected
      if (
        this._pc.connectionState === 'connected' ||
        this._pc.iceConnectionState === 'connected' ||
        this._pc.iceConnectionState === 'completed'
      ) {
        this._markConnected();
      } else {
        this.onStateChange();
      }
      return;
    }

    if (action === 'candidate' && candidate) {
      if (this._pc && this._pc.remoteDescription) {
        await this._pc.addIceCandidate(candidate).catch(() => {});
      } else {
        this._queuedCandidates.push(candidate);
      }
      return;
    }

    if (action === 'hangup') {
      this._teardown('Вызов завершён собеседником');
    } else if (action === 'decline') {
      this._teardown('Собеседник отклонил вызов');
    } else if (action === 'busy') {
      this._teardown('Линия собеседника занята');
    }
  }

  /** Принимает входящий E2EE аудиовызов */
  async acceptIncomingCall() {
    if (!this.state.active || this.state.direction !== 'incoming' || !this._pendingOfferSdp) return;
    const { chat, getIceServers, iceTransportPolicy } = this._incomingCfg || {};
    const callId = this.state.callId;
    this._stopRingLoop();
    this.state.phase = 'connecting';
    this.onStateChange();

    try {
      const [stream, iceServers] = await Promise.all([
        this._getAudio(),
        getIceServers ? getIceServers() : Promise.resolve([]),
      ]);
      this._localStream = stream;
      this._startLevelMeter(stream);

      const pc = this._createPeerConnection(chat, callId, iceServers, iceTransportPolicy);
      this._pc = pc;
      for (const track of stream.getTracks?.() || []) {
        pc.addTrack(track, stream);
      }

      await pc.setRemoteDescription(this._pendingOfferSdp);
      await this._flushQueuedCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.state.dtlsSas = await computeDtlsSas(pc.localDescription?.sdp, this._pendingOfferSdp.sdp);

      await this.sendSignalToChat(chat, {
        type: 'call-signal',
        callId,
        action: 'answer',
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      });

      if (
        pc.connectionState === 'connected' ||
        pc.iceConnectionState === 'connected' ||
        pc.iceConnectionState === 'completed'
      ) {
        this._markConnected();
      } else {
        this.onStateChange();
      }
    } catch (err) {
      this._teardown(err.message || 'Не удалось принять вызов');
      throw err;
    }
  }

  async declineIncomingCall(chat) {
    if (!this.state.active) return;
    const callId = this.state.callId;
    if (chat && callId) {
      this.sendSignalToChat(chat, { type: 'call-signal', callId, action: 'decline' }).catch(() => {});
    }
    this._teardown('Вызов отклонён');
  }

  async hangup(chat) {
    if (!this.state.active) return;
    const callId = this.state.callId;
    if (chat && callId && this.state.phase !== 'ended') {
      this.sendSignalToChat(chat, { type: 'call-signal', callId, action: 'hangup' }).catch(() => {});
    }
    this._teardown('Вызов завершён');
  }

  toggleMute() {
    if (!this.state.active) return false;
    this.state.muted = !this.state.muted;
    for (const t of this._localStream?.getAudioTracks?.() || []) {
      t.enabled = !this.state.muted;
    }
    this.onStateChange();
    return this.state.muted;
  }

  dismissEndedModal() {
    this._cleanupMediaOnly();
    this.state = this._emptyState();
    this.onStateChange();
  }

  async _flushQueuedCandidates() {
    if (!this._pc || !this._queuedCandidates.length) return;
    const items = [...this._queuedCandidates];
    this._queuedCandidates = [];
    for (const c of items) {
      await this._pc.addIceCandidate(c).catch(() => {});
    }
  }

  _cleanupMediaOnly() {
    this._stopRingLoop();
    clearInterval(this._durationTimer);
    clearInterval(this._levelTimer);
    this._durationTimer = null;
    this._levelTimer = null;

    if (this._localStream) {
      for (const t of this._localStream.getTracks?.() || []) {
        try { t.stop(); } catch { /* ignore */ }
      }
      this._localStream = null;
    }
    if (this._pc) {
      try { this._pc.close(); } catch { /* ignore */ }
      this._pc = null;
    }
    if (this._audioCtx) {
      try { this._audioCtx.close(); } catch { /* ignore */ }
      this._audioCtx = null;
    }
    if (this._remoteAudioEl) {
      try { this._remoteAudioEl.srcObject = null; } catch { /* ignore */ }
    }
    this._pendingOfferSdp = null;
    this._queuedCandidates = [];
  }

  _teardown(reason = 'Вызов завершён') {
    this._cleanupMediaOnly();
    this.state.phase = 'ended';
    this.state.reason = reason;
    this.state.micLevel = 0;
    this.onStateChange();
    const endedId = this.state.callId;
    const t = setTimeout(() => {
      if (this.state.callId === endedId && this.state.phase === 'ended') {
        this.state = this._emptyState();
        this.onStateChange();
      }
    }, 1800);
    t?.unref?.();
  }
}
