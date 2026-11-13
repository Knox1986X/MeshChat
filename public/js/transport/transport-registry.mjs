// Плагинный реестр транспортов.
// Новый транспорт — это отдельный модуль, вызывающий transportRegistry.register({ id, title, ... , create }).
// Также отвечает за фильтрацию доступных каналов согласно политике приватности пользователя.

import { TRANSPORT_POLICY, assertValidTransportInstance } from './transport-interface.mjs';

export class TransportRegistry {
  constructor() {
    this._plugins = new Map(); // id -> descriptor
  }

  /**
   * Регистрирует плагин транспорта.
   * @param {object} plugin
   * @param {string} plugin.id            Уникальный код ('ws', 'webrtc', 'tor', 'i2p', ...)
   * @param {string} plugin.title         Название для настроек
   * @param {'direct'|'p2p'|'tor'|'i2p'|'custom'} plugin.kind
   * @param {boolean} plugin.exposesIp    Раскрывает ли транспорт реальный IP-адрес клиента
   * @param {number} [plugin.priority=50] Приоритет в режиме AUTO (меньше = пробуем раньше)
   * @param {number} [plugin.connectTimeoutMs=8000] Рекомендуемый таймаут установки канала
   * @param {(config: object) => object} plugin.create Фабрика экземпляра транспорта
   */
  register(plugin) {
    if (!plugin || typeof plugin.id !== 'string' || !plugin.id.trim()) {
      throw new Error('Плагин транспорта обязан содержать непустой строковый id');
    }
    if (typeof plugin.create !== 'function') {
      throw new Error(`Плагин "${plugin.id}" обязан предоставлять фабрику create(config)`);
    }
    if (typeof plugin.exposesIp !== 'boolean') {
      throw new Error(`Плагин "${plugin.id}" обязан явно указывать флаг exposesIp (true/false)`);
    }

    const normalized = Object.freeze({
      id: plugin.id.trim(),
      title: plugin.title || plugin.id,
      description: plugin.description || '',
      kind: plugin.kind || 'custom',
      exposesIp: plugin.exposesIp,
      priority: Number.isFinite(plugin.priority) ? plugin.priority : 50,
      connectTimeoutMs: Number.isFinite(plugin.connectTimeoutMs) ? plugin.connectTimeoutMs : 8000,
      isSupported: typeof plugin.isSupported === 'function' ? plugin.isSupported : () => true,
      create: plugin.create,
    });

    this._plugins.set(normalized.id, normalized);
    return normalized;
  }

  unregister(id) {
    return this._plugins.delete(id);
  }

  has(id) {
    return this._plugins.has(id);
  }

  getDescriptor(id) {
    return this._plugins.get(id) || null;
  }

  /** Возвращает все зарегистрированные плагины, отсортированные по приоритету */
  list() {
    return [...this._plugins.values()].sort((a, b) => a.priority - b.priority);
  }

  /** Создаёт и валидирует экземпляр транспорта по его id */
  create(id, config = {}) {
    const plugin = this._plugins.get(id);
    if (!plugin) {
      throw new Error(`Транспорт "${id}" не зарегистрирован в transportRegistry`);
    }
    const instance = plugin.create(config);
    return assertValidTransportInstance(instance);
  }

  /**
   * Возвращает упорядоченный список плагинов-кандидатов для выбранной пользователем политики.
   * В режимах TOR_ONLY и I2P_ONLY жёстко отсекает любые транспорты с exposesIp === true (fail-closed).
   */
  resolveForPolicy(policy = TRANSPORT_POLICY.AUTO, runtimeConfig = {}) {
    const all = this.list().filter((p) => p.isSupported(runtimeConfig));

    switch (policy) {
      case TRANSPORT_POLICY.TOR_ONLY:
        return all.filter((p) => p.kind === 'tor' && p.exposesIp === false);

      case TRANSPORT_POLICY.I2P_ONLY:
        return all.filter((p) => p.kind === 'i2p' && p.exposesIp === false);

      case TRANSPORT_POLICY.DIRECT_ONLY:
        return all.filter((p) => p.kind === 'direct');

      case TRANSPORT_POLICY.P2P_FIRST: {
        const p2p = all.filter((p) => p.kind === 'p2p');
        const rest = all.filter((p) => p.kind !== 'p2p');
        return [...p2p, ...rest];
      }

      case TRANSPORT_POLICY.AUTO:
      default:
        return all;
    }
  }
}

export const transportRegistry = new TransportRegistry();
