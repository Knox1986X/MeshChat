// Оркестратор мультитранспорта (FallbackTransport).
// Последовательно перебирает доступные транспорты из реестра согласно выбранной политике:
//   - AUTO:        WS (быстрый) -> WebRTC P2P -> Tor (.onion) -> I2P (.b32.i2p)
//   - TOR_ONLY:    строго fail-closed (ТОЛЬКО транспорты kind === 'tor' и exposesIp === false)
//   - I2P_ONLY:    строго fail-closed (ТОЛЬКО транспорты kind === 'i2p' и exposesIp === false)
//   - DIRECT_ONLY: только прямой WS
//
// Автоматически переключает канал при обрыве (DISCONNECTED) или стойкой деградации (DEGRADED),
// буферизуя исходящие пакеты на время переключения без потери сообщений.

import {
  BaseTransport,
  TRANSPORT_STATE,
  TRANSPORT_POLICY,
} from './transport-interface.mjs';
import { transportRegistry } from './transport-registry.mjs';

export class FallbackTransport extends BaseTransport {
  /**
   * @param {object} options
   * @param {TransportRegistry} [options.registry]          Реестр плагинов транспорта
   * @param {string}            [options.policy='auto']     Политика маршрутизации (TRANSPORT_POLICY)
   * @param {object}            [options.transportConfig]   Общие параметры для дочерних транспортов (onionUrl, i2pUrl и т.д.)
   * @param {number}            [options.degradedGraceMs=5000] Через сколько мс в DEGRADED искать лучший канал
   * @param {number}            [options.maxPendingPackets=64] Буфер отправки на время горячего переключения
   */
  constructor(options = {}) {
    const policy = options.policy || TRANSPORT_POLICY.AUTO;
    const isStrictAnon = policy === TRANSPORT_POLICY.TOR_ONLY || policy === TRANSPORT_POLICY.I2P_ONLY;

    super({
      id: 'fallback',
      title: 'Мультитранспорт (Auto-Fallback)',
      kind: isStrictAnon ? (policy === TRANSPORT_POLICY.TOR_ONLY ? 'tor' : 'i2p') : 'custom',
      exposesIp: !isStrictAnon,
    });

    this.registry = options.registry || transportRegistry;
    this.policy = policy;
    this.transportConfig = options.transportConfig || {};
    this.degradedGraceMs = options.degradedGraceMs ?? 5000;
    this.maxPendingPackets = options.maxPendingPackets ?? 64;

    this._active = null;
    this._activeUnsubMsg = null;
    this._activeUnsubState = null;
    this._switching = false;
    this._closedExplicitly = false;
    this._degradedTimer = null;
    this._pendingSendQueue = [];
  }

  get activeTransportId() {
    return this._active?.id || null;
  }

  get activeTransport() {
    return this._active;
  }

  async connect({ signal } = {}) {
    this._closedExplicitly = false;
    if (this._active?.isConnected) return;
    await this._dialCandidates({ signal });
  }

  async send(bytes) {
    const packet = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (this._active?.isConnected) {
      await this._active.send(packet);
      this.stats.bytesSent += packet.byteLength;
      this.stats.messagesSent += 1;
      return true;
    }

    // Если прямо сейчас идёт горячее переключение транспорта — буферизуем пакет
    if (this._switching && this._pendingSendQueue.length < this.maxPendingPackets) {
      return new Promise((resolve, reject) => {
        this._pendingSendQueue.push({ packet, resolve, reject });
      });
    }

    throw new Error(`Нет доступного канала для политики "${this.policy}"`);
  }

  async close(reason = 'closed_by_client') {
    this._closedExplicitly = true;
    clearTimeout(this._degradedTimer);
    await this._detachActive(reason);
    this._rejectBuffered(new Error('FallbackTransport закрыт'));
    this._setState(TRANSPORT_STATE.CLOSED, { reason });
  }

  async _dialCandidates({ signal, skipTransportId = null } = {}) {
    if (this._switching || this._closedExplicitly) return;
    this._switching = true;

    try {
      const candidates = this.registry
        .resolveForPolicy(this.policy, this.transportConfig)
        .filter((d) => d.id !== skipTransportId);

      // Критическая защита fail-closed: в анонимных режимах повторно проверяем exposesIp === false
      if (this.policy === TRANSPORT_POLICY.TOR_ONLY || this.policy === TRANSPORT_POLICY.I2P_ONLY) {
        for (const c of candidates) {
          if (c.exposesIp !== false) {
            throw new Error(`Нарушение fail-closed: плагин "${c.id}" раскрывает IP!`);
          }
        }
      }

      if (candidates.length === 0) {
        throw new Error(
          this.policy === TRANSPORT_POLICY.TOR_ONLY
            ? 'Режим «Только Tor»: не задан действительный адрес .onion (прямой выход заблокирован)'
            : this.policy === TRANSPORT_POLICY.I2P_ONLY
              ? 'Режим «Только I2P»: не задан действительный адрес .i2p (прямой выход заблокирован)'
              : 'Нет доступных плагинов транспорта для выбранной политики'
        );
      }

      if (!this._active?.isConnected) {
        this._setState(TRANSPORT_STATE.CONNECTING);
      }

      const errors = [];
      for (const descriptor of candidates) {
        if (this._closedExplicitly || signal?.aborted) break;

        const instance = this.registry.create(descriptor.id, this.transportConfig);
        const attemptCtl = new AbortController();
        const timer = setTimeout(() => attemptCtl.abort(), descriptor.connectTimeoutMs);
        if (signal) {
          signal.addEventListener('abort', () => attemptCtl.abort(), { once: true });
        }

        try {
          await instance.connect({ signal: attemptCtl.signal });
          clearTimeout(timer);

          await this._promoteTransport(instance);
          await this._flushBuffered();
          return;
        } catch (err) {
          clearTimeout(timer);
          await instance.close('dial_failed').catch(() => {});
          errors.push(`${descriptor.id}: ${err.message}`);
        }
      }

      if (!this._active?.isConnected) {
        const combined = new Error(`Все транспорты недоступны (${errors.join(' | ')})`);
        this._rejectBuffered(combined);
        this._setState(TRANSPORT_STATE.DISCONNECTED, { error: combined });
        throw combined;
      }
    } finally {
      this._switching = false;
    }
  }

  async _promoteTransport(nextInstance) {
    clearTimeout(this._degradedTimer);
    await this._detachActive('switched_to_' + nextInstance.id);

    this._active = nextInstance;
    this.rttMs = nextInstance.rttMs;

    this._activeUnsubMsg = nextInstance.onMessage((bytes) => {
      this.rttMs = nextInstance.rttMs;
      this._emitMessage(bytes);
    });

    this._activeUnsubState = nextInstance.onStateChange((childState, detail) => {
      if (this._active !== nextInstance || this._closedExplicitly) return;
      this.rttMs = nextInstance.rttMs;

      if (childState === TRANSPORT_STATE.DEGRADED) {
        this._setState(TRANSPORT_STATE.DEGRADED, { activeId: nextInstance.id, ...detail });
        clearTimeout(this._degradedTimer);
        this._degradedTimer = setTimeout(() => {
          if (this._active === nextInstance && nextInstance.state === TRANSPORT_STATE.DEGRADED) {
            // Make-before-break: ищем альтернативный живой канал, пока текущий деградировал
            this._dialCandidates({ skipTransportId: nextInstance.id }).catch(() => {});
          }
        }, this.degradedGraceMs);
      } else if (childState === TRANSPORT_STATE.CONNECTED) {
        clearTimeout(this._degradedTimer);
        this._setState(TRANSPORT_STATE.CONNECTED, { activeId: nextInstance.id, force: true });
      } else if (childState === TRANSPORT_STATE.DISCONNECTED || childState === TRANSPORT_STATE.CLOSED) {
        clearTimeout(this._degradedTimer);
        // Текущий канал оборвался — мгновенно пробуем всю цепочку кандидатов заново
        this._dialCandidates().catch(() => {});
      }
    });

    this._setState(TRANSPORT_STATE.CONNECTED, { activeId: nextInstance.id, force: true });
  }

  async _detachActive(reason) {
    if (this._activeUnsubMsg) { this._activeUnsubMsg(); this._activeUnsubMsg = null; }
    if (this._activeUnsubState) { this._activeUnsubState(); this._activeUnsubState = null; }
    if (this._active) {
      const prev = this._active;
      this._active = null;
      await prev.close(reason).catch(() => {});
    }
  }

  async _flushBuffered() {
    if (!this._active?.isConnected || this._pendingSendQueue.length === 0) return;
    const batch = this._pendingSendQueue.splice(0, this._pendingSendQueue.length);
    for (const item of batch) {
      try {
        await this._active.send(item.packet);
        this.stats.bytesSent += item.packet.byteLength;
        this.stats.messagesSent += 1;
        item.resolve(true);
      } catch (err) {
        item.reject(err);
      }
    }
  }

  _rejectBuffered(err) {
    const batch = this._pendingSendQueue.splice(0, this._pendingSendQueue.length);
    for (const item of batch) item.reject(err);
  }
}
