// Менеджер голосовых E2EE-звонков 1-на-1 (Dual-Engine: WebRTC DTLS-SRTP + AES-256-GCM G.711 Relay)
// Сигналинг и 256-битный ключ звонка передаются исключительно внутри сквозной сессии Double Ratchet + Sealed Sender.
// При блокировке прямого UDP оператором мобильной связи (4G/LTE Symmetric CGNAT) или в режиме скрытия IP («relay»)
// голос автоматически идёт через бинарный сквозной зашифрованный канал AES-256-GCM без потери соединения.

import { randomBytes, toBase64Url, fromBase64Url } from '../../../shared/crypto/primitives.mjs';
import { TRANSPORT_POLICY } from './transport-interface.mjs';
import { EncryptedVoiceRelaySession } from './voice-relay-audio.mjs';

const SAS_WORDS = [
  'АЛЬФА', 'БАЗА', 'ВЕКТОР', 'ГРАНИТ', 'ЗЕНИТ', 'КВАРЦ', 'ЛИДЕР', 'МАЯК',
  'ОРБИТА', 'ПОЛЮС', 'РУБИН', 'СЕВЕР', 'ТИТАН', 'ФОТОН', 'ШТОРМ', 'ЭФИР',
];

/**
 * Вычисляет симметричный проверочный код сверки DTLS-SRTP SAS (4 слова + HEX-суффикс)
 * из локального и удалённого SDP отпечатков сертификатов и идентификатора звонка.
 */
export async function computeDtlsSas(localSdp = '', remoteSdp = '', callId = '') {
  const extractFp = (sdp) => {
    const m = String(sdp || '').match(/a=fingerprint:([^\r\n]+)/i);
    return m ? m[1].trim().toUpperCase() : String(sdp || '').trim();
  };
  const f1 = extractFp(localSdp);
  const f2 = extractFp(remoteSdp);
  const sorted = [f1, f2].sort().join('|') + (callId ? `|${callId}` : '');
  const bytes = new TextEncoder().encode(sorted);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const words = [
    SAS_WORDS[digest[0] & 15],
    SAS_WORDS[(digest[0] >> 4) & 15],
    SAS_WORDS[digest[1] & 15],
    SAS_WORDS[(digest[1] >> 4) & 15],
  ].join(' · ');
  const hexTail = Array.from(digest.slice(2, 4))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return `${words} [${hexTail}]`;
}

function hasTurnServer(iceServers) {
  if (!Array.isArray(iceServers)) return false;
  return iceServers.some((srv) => {
    const urls = Array.isArray(srv?.urls) ? srv.urls : [srv?.urls];
    return urls.some((u) => typeof u === 'string' && /^turns?:/i.test(u));
  });
}

async function ensureAndroidMicPermission() {
  const bridge = globalThis.window?.MeshChatAndroid;
  if (!bridge || typeof bridge.hasAudioPermission !== 'function') return;
  try {
    if (bridge.hasAudioPermission()) return;
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        globalThis.window?.removeEventListener?.('meshchat:audio-perm', done);
        resolve();
      };
      globalThis.window?.addEventListener?.('meshchat:audio-perm', done, { once: true });
      bridge.ensureAudioPermission?.();
      const t = setTimeout(done, 6500);
      t.unref?.();
    });
  } catch {
    // Продолжаем стандартный запрос getUserMedia
  }
}

async function waitInitialIceGathering(pc, timeoutMs = 850) {
  if (!pc || !pc.iceGatheringState || pc.iceGatheringState === 'complete') return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener?.('icegatheringstatechange', onState);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    if (typeof pc.addEventListener === 'function') {
      pc.addEventListener('icegatheringstatechange', onState);
    } else {
      resolve();
      return;
    }
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
  });
}

export class E2eeCallManager {
  constructor({
    getIceServers = async () => [{ urls: ['stun:stun.cloudflare.com:3478'] }],
    getIceTransportPolicy = () => 'all',
    sendSignalToChat = async () => {},
    sendVoiceFrameToChat = async () => {},
    onStateChange = () => {},
    onNotice = () => {},
  } = {}) {
    this.getIceServers = getIceServers;
    this.getIceTransportPolicy = getIceTransportPolicy;
    this.sendSignalToChat = sendSignalToChat;
    this.sendVoiceFrameToChat = sendVoiceFrameToChat;
    this.onStateChange = onStateChange;
    this.onNotice = onNotice;

    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.remoteAudioEl = null;
    this.pendingOfferSignal = null;
    this.pendingCandidates = [];
    this.earlyCandidatesByCallId = new Map();
    this.durationTimer = null;
    this.ringTimeout = null;
    this.relaySession = null;
    this.callKeyBytes = null;
    this.activeChat = null;
    this._signalChain = Promise.resolve();

    this.state = this._emptyState();
  }

  _emptyState() {
    return {
      active: false,
      status: 'idle', // 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'ended'
      phase: 'idle',  // 'idle' | 'ringing' | 'connecting' | 'connected' | 'ended'
      direction: 'outgoing',
      callId: null,
      chatId: null,
      peerName: '',
      peerTitle: '',
      muted: false,
      speaker: false,
      startedAt: 0,
      durationSec: 0,
      elapsedSec: 0,
      sasEmojis: '',
      dtlsSas: '',
      icePolicy: 'all',
      transportMode: 'negotiating', // 'negotiating' | 'p2p-dtls' | 'relay-e2ee'
      micAvailable: true,
      reason: '',
    };
  }

  _setStatus(status, extra = {}) {
    const phase =
      status === 'outgoing' || status === 'incoming'
        ? 'ringing'
        : status;
    const active = status !== 'idle';
    Object.assign(this.state, extra, { status, phase, active });
    this.onStateChange({ ...this.state });
  }

  _emit() {
    this.onStateChange({ ...this.state });
  }

  _enqueueSignal(chat, signalPayload) {
    this._signalChain = this._signalChain
      .then(() => this.sendSignalToChat(chat, signalPayload))
      .catch(() => {});
    return this._signalChain;
  }

  _setAndroidCallAudio(active, speaker = false) {
    try {
      globalThis.window?.MeshChatAndroid?.setCallAudioMode?.(Boolean(active), Boolean(speaker));
    } catch {}
  }

  _cancelAndroidCallNotification(chatId) {
    try {
      if (chatId) {
        globalThis.window?.MeshChatAndroid?.cancelChatNotification?.(chatId);
      }
    } catch {}
  }

  async _acquireMicrophone() {
    await ensureAndroidMicPermission();
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      return null;
    }
    try {
      return await globalThis.navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
    } catch {
      try {
        return await globalThis.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        return null;
      }
    }
  }

  async _startEncryptedRelayAudio(chat) {
    if (!this.callKeyBytes || !this.state.callId) return;
    if (this.relaySession) {
      this.relaySession.stop();
      this.relaySession = null;
    }
    const session = new EncryptedVoiceRelaySession({
      callId: this.state.callId,
      rawKey32: this.callKeyBytes,
      localStream: this.localStream,
      onSendFrame: async (packetBytes) => {
        if (this.state.status !== 'connected' && this.state.status !== 'connecting') return;
        await this.sendVoiceFrameToChat(chat, packetBytes);
      },
    });
    session.setMuted(this.state.muted);
    await session.start();
    this.relaySession = session;
    if (this.state.transportMode !== 'p2p-dtls') {
      this.state.transportMode = 'relay-e2ee';
      this._emit();
    }
  }

  async _markCallConnected(localSdp = '', remoteSdp = '') {
    if (this.ringTimeout) {
      clearTimeout(this.ringTimeout);
      this.ringTimeout = null;
    }
    const wasConnected = this.state.status === 'connected';
    const sas = await computeDtlsSas(localSdp, remoteSdp);
    if (!wasConnected) {
      this.state.startedAt = Date.now();
      this._startDurationClock();
    }
    this._setStatus('connected', {
      sasEmojis: sas,
      dtlsSas: sas,
    });
  }

  async _createPeerConnection(chat, callId, overrideIceServers = null, overrideIcePolicy = null) {
    const requestedPolicy = (overrideIcePolicy || this.getIceTransportPolicy()) === 'relay' ? 'relay' : 'all';
    this.state.icePolicy = requestedPolicy;

    const iceServers = overrideIceServers || (await this.getIceServers());
    // Если включён режим скрытия IP («relay») и нет внешнего TURN-сервера,
    // мы не открываем прямой UDP WebRTC и ведём звонок через слепой E2EE-ретранслятор AES-256-GCM!
    if (requestedPolicy === 'relay' && !hasTurnServer(iceServers)) {
      return null;
    }
    if (typeof RTCPeerConnection === 'undefined') {
      return null;
    }

    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: requestedPolicy,
    });

    if (typeof MediaStream !== 'undefined') {
      this.remoteStream = new MediaStream();
    }
    if (typeof Audio !== 'undefined') {
      this.remoteAudioEl = new Audio();
      this.remoteAudioEl.autoplay = true;
      this.remoteAudioEl.playsInline = true;
      if (this.remoteStream) {
        this.remoteAudioEl.srcObject = this.remoteStream;
      }
    }

    pc.ontrack = (ev) => {
      if (this.remoteStream) {
        if (ev.streams && ev.streams[0]) {
          for (const track of ev.streams[0].getTracks()) {
            this.remoteStream.addTrack?.(track);
          }
        } else if (ev.track) {
          this.remoteStream.addTrack?.(ev.track);
        }
      }
      this.remoteAudioEl?.play?.().catch(() => {});
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.state.callId === callId) {
        this._enqueueSignal(chat, {
          type: 'call-signal',
          callId,
          action: 'candidate',
          candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate,
          sentAt: Date.now(),
        });
      }
    };

    const syncP2pState = async () => {
      if (this.pc !== pc) return;
      const st = pc.connectionState || pc.iceConnectionState;
      const iceSt = pc.iceConnectionState;
      if (st === 'connected' || iceSt === 'connected' || iceSt === 'completed') {
        this.state.transportMode = 'p2p-dtls';
        if (this.relaySession) {
          this.relaySession.setSuppressedByP2p(true);
        }
        this.remoteAudioEl?.play?.().catch(() => {});
        await this._markCallConnected(
          pc.localDescription?.sdp || '',
          pc.remoteDescription?.sdp || ''
        );
      } else if (st === 'disconnected' || st === 'failed' || iceSt === 'disconnected' || iceSt === 'failed') {
        if (this.relaySession && this.state.status === 'connected') {
          this.relaySession.setSuppressedByP2p(false);
          this.state.transportMode = 'relay-e2ee';
          this._emit();
        }
      }
    };

    pc.onconnectionstatechange = syncP2pState;
    pc.oniceconnectionstatechange = syncP2pState;

    return pc;
  }

  /** Инициирует исходящий звонок собеседнику (поддерживает как startOutgoingCall(chat), так и объект опций) */
  async startOutgoingCall(chatOrOpts) {
    const isOpts = chatOrOpts && typeof chatOrOpts === 'object' && 'chat' in chatOrOpts;
    const chat = isOpts ? chatOrOpts.chat : chatOrOpts;
    const transportPolicy = isOpts ? chatOrOpts.transportPolicy : null;
    const overrideIceServers = isOpts ? chatOrOpts.iceServers : null;
    const overrideIcePolicy = isOpts ? chatOrOpts.iceTransportPolicy : null;

    if (
      transportPolicy === TRANSPORT_POLICY.TOR_ONLY ||
      transportPolicy === TRANSPORT_POLICY.I2P_ONLY
    ) {
      throw new Error('Голосовые вызовы отключены в строгом режиме «Только Tor / I2P» для защиты IP');
    }

    if (!chat || chat.kind === 'room') {
      this.onNotice('Звонки доступны в личных E2EE-диалогах', 'warn');
      return;
    }
    if (this.state.status !== 'idle' && this.state.status !== 'ended') {
      this.onNotice('Уже выполняется другой звонок', 'warn');
      return;
    }

    const callId = `call_${toBase64Url(randomBytes(12))}`;
    this.callKeyBytes = randomBytes(32);
    this.activeChat = chat;
    const peerLabel = chat.title || chat.username || 'Собеседник';

    this.state = {
      ...this._emptyState(),
      callId,
      chatId: chat.id,
      direction: 'outgoing',
      peerName: peerLabel,
      peerTitle: peerLabel,
    };
    this._setStatus('outgoing');
    this._setAndroidCallAudio(true, false);

    try {
      this.localStream = await this._acquireMicrophone();
      this.state.micAvailable = Boolean(this.localStream);

      this.pc = await this._createPeerConnection(chat, callId, overrideIceServers, overrideIcePolicy);
      let offerSdp = '';

      if (this.pc) {
        if (this.localStream) {
          for (const track of this.localStream.getTracks()) {
            this.pc.addTrack(track, this.localStream);
          }
        } else {
          this.pc.addTransceiver?.('audio', { direction: 'recvonly' });
        }
        const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
        await this.pc.setLocalDescription(offer);
        await waitInitialIceGathering(this.pc, 850);
        offerSdp = this.pc.localDescription?.sdp || offer.sdp || '';
      }

      await this._enqueueSignal(chat, {
        type: 'call-signal',
        callId,
        action: 'offer',
        sdp: offerSdp,
        callKeyB64: toBase64Url(this.callKeyBytes),
        sentAt: Date.now(),
      });

      this.ringTimeout = setTimeout(() => {
        if (this.state.status === 'outgoing' && this.state.callId === callId) {
          this.hangup(chat, 'no-answer');
          this.onNotice('Собеседник не ответил на вызов', 'info');
        }
      }, 45_000);
      this.ringTimeout.unref?.();
    } catch (err) {
      this._resetToIdle();
      this.onNotice(err?.message || 'Не удалось начать голосовой вызов', 'error');
    }
  }

  /** Принимает входящий звонок */
  async acceptIncomingCall(chatArg = null) {
    const chat = chatArg || this.activeChat;
    if (this.state.status !== 'incoming' || !this.pendingOfferSignal || !chat) return;
    const { callId, sdp, callKeyB64 } = this.pendingOfferSignal;
    this.activeChat = chat;
    this._cancelAndroidCallNotification(chat.id);
    this._setAndroidCallAudio(true, this.state.speaker);

    if (callKeyB64) {
      try {
        this.callKeyBytes = fromBase64Url(callKeyB64);
      } catch {
        this.callKeyBytes = null;
      }
    }
    if (!this.callKeyBytes || this.callKeyBytes.byteLength !== 32) {
      this.callKeyBytes = randomBytes(32);
    }

    this._setStatus('connecting');

    try {
      this.localStream = await this._acquireMicrophone();
      this.state.micAvailable = Boolean(this.localStream);

      this.pc = await this._createPeerConnection(chat, callId);
      let answerSdp = '';

      if (this.pc && sdp) {
        if (this.localStream) {
          for (const track of this.localStream.getTracks()) {
            this.pc.addTrack(track, this.localStream);
          }
        } else {
          this.pc.addTransceiver?.('audio', { direction: 'recvonly' });
        }
        await this.pc.setRemoteDescription({ type: 'offer', sdp });
        await this._flushPendingCandidates();

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await waitInitialIceGathering(this.pc, 850);
        answerSdp = this.pc.localDescription?.sdp || answer.sdp || '';
      }

      // Запускаем шифрованный голосовой канал сразу при ответе — связь работает мгновенно даже на 4G CGNAT!
      await this._startEncryptedRelayAudio(chat);

      await this._enqueueSignal(chat, {
        type: 'call-signal',
        callId,
        action: 'answer',
        sdp: answerSdp,
        callKeyB64: toBase64Url(this.callKeyBytes),
        sentAt: Date.now(),
      });

      await this._markCallConnected(answerSdp, sdp || '');
    } catch (err) {
      this._resetToIdle();
      this.onNotice(err?.message || 'Не удалось принять звонок', 'error');
    }
  }

  async declineIncomingCall(chat = null) {
    return this.hangup(chat || this.activeChat, 'declined');
  }

  /** Отклоняет или завершает текущий звонок */
  async hangup(chat = null, reason = 'hangup') {
    const activeCallId = this.state.callId;
    const targetChat = chat || this.activeChat;
    const targetChatId = targetChat?.id || this.state.chatId;
    this._cancelAndroidCallNotification(targetChatId);
    this._releaseMediaResources();
    this._setStatus('ended', { reason: 'Вызов завершён' });
    if (activeCallId && targetChat) {
      await this._enqueueSignal(targetChat, {
        type: 'call-signal',
        callId: activeCallId,
        action: 'hangup',
        reason,
        sentAt: Date.now(),
      });
    }
  }

  dismissEndedModal() {
    this._resetToIdle();
  }

  toggleMute() {
    if (!this.state.callId) return false;
    const nextMuted = !this.state.muted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !nextMuted;
      }
    }
    if (this.relaySession) {
      this.relaySession.setMuted(nextMuted);
    }
    this.state.muted = nextMuted;
    this._emit();
    return nextMuted;
  }

  toggleSpeaker() {
    if (!this.state.callId) return false;
    const nextSpeaker = !this.state.speaker;
    this.state.speaker = nextSpeaker;
    this._setAndroidCallAudio(true, nextSpeaker);
    this._emit();
    return nextSpeaker;
  }

  /** Обрабатывает входящий бинарный зашифрованный голосовой кадр AES-256-GCM */
  async handleIncomingVoiceFrame(packetBytes) {
    if (!this.relaySession) return false;
    return this.relaySession.handleIncomingPacket(packetBytes);
  }

  /** Обрабатывает входящий расшифрованный пакет сигналинга из Double Ratchet */
  async handleIncomingSignal(chat, payload) {
    if (!payload || !payload.callId) return;
    const { callId, action } = payload;

    if (payload.sentAt && Math.abs(Date.now() - Number(payload.sentAt)) > 60_000 && action === 'offer') {
      return;
    }

    if (action === 'offer') {
      if (this.state.status !== 'idle' && this.state.status !== 'ended') {
        await this._enqueueSignal(chat, {
          type: 'call-signal',
          callId,
          action: 'hangup',
          reason: 'busy',
          sentAt: Date.now(),
        });
        return;
      }

      const early = this.earlyCandidatesByCallId.get(callId) || [];
      this.earlyCandidatesByCallId.delete(callId);
      this.pendingOfferSignal = payload;
      this.pendingCandidates = [...early];
      this.activeChat = chat;
      const peerLabel = chat?.title || chat?.username || 'Собеседник';

      this.state = {
        ...this._emptyState(),
        callId,
        chatId: chat?.id || null,
        direction: 'incoming',
        peerName: peerLabel,
        peerTitle: peerLabel,
      };
      this._setStatus('incoming');

      this.ringTimeout = setTimeout(() => {
        if (this.state.status === 'incoming' && this.state.callId === callId) {
          this._cancelAndroidCallNotification(chat?.id);
          this._resetToIdle();
        }
      }, 45_000);
      this.ringTimeout.unref?.();
      return;
    }

    if (action === 'candidate' && payload.candidate) {
      if (this.state.callId !== callId) {
        const list = this.earlyCandidatesByCallId.get(callId) || [];
        if (list.length < 32) {
          list.push(payload.candidate);
          this.earlyCandidatesByCallId.set(callId, list);
        }
        return;
      }
      if (this.pc && this.pc.remoteDescription) {
        try {
          await this.pc.addIceCandidate(payload.candidate);
        } catch {}
      } else {
        this.pendingCandidates.push(payload.candidate);
      }
      return;
    }

    if (this.state.callId !== callId) return;

    if (action === 'answer') {
      if (payload.callKeyB64 && (!this.callKeyBytes || this.callKeyBytes.byteLength !== 32)) {
        try {
          this.callKeyBytes = fromBase64Url(payload.callKeyB64);
        } catch {}
      }
      if (this.pc && payload.sdp) {
        try {
          await this.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
          await this._flushPendingCandidates();
        } catch {}
      }
      await this._startEncryptedRelayAudio(this.activeChat || chat);
      await this._markCallConnected(
        this.pc?.localDescription?.sdp || '',
        payload.sdp || ''
      );
      return;
    }

    if (action === 'hangup') {
      const reason = payload.reason;
      this._cancelAndroidCallNotification(chat?.id || this.state.chatId);
      this._releaseMediaResources();
      this._setStatus('ended', {
        reason: reason === 'busy' ? 'Линия собеседника занята' : 'Вызов завершён',
      });
      if (reason === 'busy') {
        this.onNotice('Линия собеседника занята', 'info');
      } else {
        this.onNotice('Звонок завершён', 'info');
      }
    }
  }

  async _flushPendingCandidates() {
    if (!this.pc || !this.pc.remoteDescription) return;
    const list = this.pendingCandidates.splice(0);
    for (const c of list) {
      try {
        await this.pc.addIceCandidate(c);
      } catch {}
    }
  }

  _startDurationClock() {
    if (this.durationTimer) clearInterval(this.durationTimer);
    this.durationTimer = setInterval(() => {
      if (this.state.status === 'connected' && this.state.startedAt) {
        const sec = Math.floor((Date.now() - this.state.startedAt) / 1000);
        this.state.durationSec = sec;
        this.state.elapsedSec = sec;
        this._emit();
      }
    }, 1000);
    this.durationTimer.unref?.();
  }

  _releaseMediaResources() {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
    if (this.ringTimeout) {
      clearTimeout(this.ringTimeout);
      this.ringTimeout = null;
    }
    if (this.relaySession) {
      this.relaySession.stop();
      this.relaySession = null;
    }
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) {
        try { t.stop(); } catch {}
      }
      this.localStream = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch {}
      this.pc = null;
    }
    if (this.remoteAudioEl) {
      try {
        this.remoteAudioEl.pause();
        this.remoteAudioEl.srcObject = null;
      } catch {}
      this.remoteAudioEl = null;
    }
    this.remoteStream = null;
    this.pendingOfferSignal = null;
    this.pendingCandidates = [];
    this.callKeyBytes = null;
    this._setAndroidCallAudio(false, false);
  }

  _resetToIdle() {
    this._releaseMediaResources();
    this.activeChat = null;
    this.state = this._emptyState();
    this._emit();
  }
}
