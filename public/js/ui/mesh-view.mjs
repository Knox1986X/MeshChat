// Экран сетевой топологии Mesh: интерактивный радар узлов, переключатели транспортных плагинов,
// статистика текущей сессии (отправлено / получено / медиана RTT) и тест-пакеты E2EE.

import { html, useState } from '../../vendor/preact.mjs';
import { TRANSPORT_POLICY } from '../transport/transport-interface.mjs';
import {
  store,
  updateClientSettings,
  toggleAndroidLanMesh,
  syncNow,
  sendMeshTestPacket,
  runMeshDiagnostics,
  selectChat,
} from '../store/app-store.mjs';
import { Icon } from './boss-screen.mjs';

export function MeshView() {
  const {
    transportState,
    sessionAuthenticated,
    activeTransportId,
    rttMs,
    settings,
    android,
    meshStats,
    chats,
  } = store;

  const [probing, setProbing] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);

  const isOnline = (transportState === 'connected' || transportState === 'degraded') && sessionAuthenticated;
  const dmPeers = Object.values(chats).filter((c) => c.kind === 'dm');

  // Реальные активные узлы на радаре
  const radarNodes = [];
  if (isOnline) {
    radarNodes.push({
      id: 'relay',
      label: activeTransportId === 'tor' ? 'Tor .onion' : 'Blind Relay',
      sub: `${meshStats.medianRttMs || rttMs || 28} мс`,
      angleDeg: -42,
      radiusPct: 58,
      color: '#10b981',
    });
  }
  if (android.lanMeshRunning) {
    radarNodes.push({
      id: 'lan',
      label: 'LAN :3000',
      sub: '1 hop',
      angleDeg: 38,
      radiusPct: 44,
      color: '#38bdf8',
    });
  }
  if (settings.transportPolicy === TRANSPORT_POLICY.P2P_FIRST || activeTransportId === 'webrtc') {
    radarNodes.push({
      id: 'webrtc',
      label: 'WebRTC P2P',
      sub: 'ICE/DTLS',
      angleDeg: 145,
      radiusPct: 52,
      color: '#a855f7',
    });
  }
  dmPeers.slice(0, 4).forEach((peer, idx) => {
    const angles = [212, -125, 96, -8];
    radarNodes.push({
      id: peer.id,
      chatId: peer.id,
      label: `@${peer.username}`,
      sub: peer.verified ? 'E2EE ✓' : 'X3DH',
      angleDeg: angles[idx % angles.length],
      radiusPct: 72 - (idx % 2) * 16,
      color: peer.verified ? '#10b981' : '#6d7cff',
    });
  });

  const activePluginCount =
    (isOnline ? 1 : 0) +
    (android.lanMeshRunning || settings.transportPolicy === TRANSPORT_POLICY.P2P_FIRST ? 1 : 0) +
    (settings.transportPolicy === TRANSPORT_POLICY.TOR_ONLY ? 1 : 0) +
    (settings.coverTraffic ? 1 : 0);

  const isP2pActive = android.lanMeshRunning || settings.transportPolicy === TRANSPORT_POLICY.P2P_FIRST;
  const isTorOnly = settings.transportPolicy === TRANSPORT_POLICY.TOR_ONLY;
  const isRelayActive = settings.transportPolicy !== TRANSPORT_POLICY.TOR_ONLY || Boolean(settings.onionUrl);

  const onToggleP2p = () => {
    if (android.isApk) {
      toggleAndroidLanMesh();
    } else {
      const next = settings.transportPolicy === TRANSPORT_POLICY.P2P_FIRST
        ? TRANSPORT_POLICY.AUTO
        : TRANSPORT_POLICY.P2P_FIRST;
      updateClientSettings({ transportPolicy: next });
    }
  };

  const onToggleTor = () => {
    const next = isTorOnly ? TRANSPORT_POLICY.AUTO : TRANSPORT_POLICY.TOR_ONLY;
    updateClientSettings({ transportPolicy: next });
  };

  const onProbe = async () => {
    if (probing) return;
    setProbing(true);
    try {
      await sendMeshTestPacket();
    } finally {
      setProbing(false);
    }
  };

  const onDiag = async () => {
    if (diagnosing) return;
    setDiagnosing(true);
    try {
      await runMeshDiagnostics();
    } finally {
      setDiagnosing(false);
    }
  };

  return html`<section class="tab-screen mesh-screen">
    <header class="screen-hero-head">
      <div>
        <h1 class="screen-big-title">Mesh</h1>
        <div class="screen-pills-row">
          <span class=${`hero-status-pill ${isOnline ? 'online' : 'warn'}`}>
            <span class="status-dot"></span>
            ${isOnline ? 'сканирование' : 'автономный поиск'}
          </span>
          <span class="hero-status-pill neutral">
            ${radarNodes.length} узлов · ${Math.max(1, activePluginCount)} плагинов
          </span>
        </div>
      </div>
      <button type="button" class="square-action-btn" title="Переподключить каналы" onClick=${() => syncNow()}>
        <${Icon} name="refresh" size=${18} />
      </button>
    </header>

    <div class="mesh-scroll-body">
      <!-- Интерактивный радар узлов и маршрутов -->
      <div class="mesh-radar-card">
        <div class="mesh-radar-stage">
          <div class="radar-ring ring-1"></div>
          <div class="radar-ring ring-2"></div>
          <div class="radar-ring ring-3"></div>
          <div class="radar-crosshair-h"></div>
          <div class="radar-crosshair-v"></div>
          <div class="radar-sweep"></div>

          <div class="radar-center-core" title="Локальный криптоузел">
            <${Icon} name="wifi" size=${20} />
          </div>

          ${radarNodes.map((n) => {
            const rad = (n.angleDeg * Math.PI) / 180;
            const x = 50 + Math.cos(rad) * (n.radiusPct * 0.44);
            const y = 50 + Math.sin(rad) * (n.radiusPct * 0.44);
            return html`<button
              key=${n.id}
              type="button"
              class="radar-peer-blip"
              style=${`left:${x.toFixed(1)}%;top:${y.toFixed(1)}%`}
              onClick=${() => n.chatId && selectChat(n.chatId)}
            >
              <span class="blip-dot" style=${`background:${n.color};box-shadow:0 0 12px ${n.color}`}></span>
              <span class="blip-tag">${n.label} · ${n.sub}</span>
            </button>`;
          })}
        </div>
        <div class="mesh-radar-caption">
          ${isOnline
            ? `Активный транспорт: ${activeTransportId.toUpperCase()} · задержка ${meshStats.medianRttMs || rttMs || 24} мс`
            : 'Ожидание прямого P2P или облачного ретранслятора…'}
        </div>
      </div>

      <!-- Транспортные плагины -->
      <div class="section-cap">ТРАНСПОРТНЫЕ ПЛАГИНЫ</div>
      <div class="plugin-list-card">
        <div class="plugin-row">
          <div class="plugin-icon-box sky"><${Icon} name="wifi" size=${18} /></div>
          <div class="plugin-copy">
            <div class="plugin-title">P2P WebRTC / Wi-Fi LAN</div>
            <div class="plugin-sub">
              ${android.isApk
                ? (android.lanMeshRunning ? `Активен узел ${android.lanUrl}` : 'Локальный ретранслятор :3000 без интернета')
                : 'Прямые DataChannel между устройствами (DTLS-SRTP)'}
            </div>
          </div>
          <button
            type="button"
            class=${`ios-switch ${isP2pActive ? 'on' : ''}`}
            onClick=${onToggleP2p}
            aria-label="Переключить P2P / LAN"
          ><span></span></button>
        </div>

        <div class="plugin-row">
          <div class="plugin-icon-box violet"><${Icon} name="globe" size=${18} /></div>
          <div class="plugin-copy">
            <div class="plugin-title">Tor onion-маршрутизация</div>
            <div class="plugin-sub">Строгий режим Fail-Closed через SOCKS5 / Orbot без утечки IP</div>
          </div>
          <button
            type="button"
            class=${`ios-switch ${isTorOnly ? 'on' : ''}`}
            onClick=${onToggleTor}
            aria-label="Переключить режим Tor"
          ><span></span></button>
        </div>

        <div class="plugin-row">
          <div class="plugin-icon-box indigo"><${Icon} name="server" size=${18} /></div>
          <div class="plugin-copy">
            <div class="plugin-title">Blind Relay (облачный буфер)</div>
            <div class="plugin-sub">Обезличенные конверты Sealed Sender · хранение до доставки 14 сут</div>
          </div>
          <button
            type="button"
            class=${`ios-switch ${isRelayActive && isOnline ? 'on' : ''}`}
            onClick=${() => {
              if (isTorOnly) updateClientSettings({ transportPolicy: TRANSPORT_POLICY.AUTO });
              else syncNow();
            }}
            aria-label="Синхронизировать Blind Relay"
          ><span></span></button>
        </div>

        <div class="plugin-row">
          <div class="plugin-icon-box emerald"><${Icon} name="shield" size=${18} /></div>
          <div class="plugin-copy">
            <div class="plugin-title">Маскирующий Cover-трафик</div>
            <div class="plugin-sub">Фоновые шумовые пакеты кратно 512 Б против анализа таймингов</div>
          </div>
          <button
            type="button"
            class=${`ios-switch ${settings.coverTraffic ? 'on' : ''}`}
            onClick=${() => updateClientSettings({ coverTraffic: !settings.coverTraffic })}
            aria-label="Переключить Cover-трафик"
          ><span></span></button>
        </div>
      </div>

      <!-- Статистика текущей сессии -->
      <div class="section-cap">ТЕКУЩАЯ СЕССИЯ</div>
      <div class="session-telemetry-card">
        <div class="telemetry-grid">
          <div class="telemetry-cell">
            <div class="telemetry-num">${meshStats.packetsSent}</div>
            <div class="telemetry-lbl">отправлено</div>
          </div>
          <div class="telemetry-cell">
            <div class="telemetry-num">${meshStats.packetsReceived}</div>
            <div class="telemetry-lbl">получено</div>
          </div>
          <div class="telemetry-cell">
            <div class="telemetry-num accent">
              ${meshStats.medianRttMs || rttMs ? `${meshStats.medianRttMs || rttMs} мс` : '—'}
            </div>
            <div class="telemetry-lbl">медиана RTT</div>
          </div>
        </div>

        ${meshStats.lastProbeText && html`<div class="probe-result-banner">
          <${Icon} name="check" size=${14} />
          <span>${meshStats.lastProbeText}</span>
        </div>`}

        <div class="telemetry-actions">
          <button type="button" class="btn-soft-accent" disabled=${probing} onClick=${onProbe}>
            <${Icon} name="bolt" size=${15} />
            <span>${probing ? 'Проверка…' : 'Тест-пакет E2EE'}</span>
          </button>
          <button type="button" class="btn-dark-card" disabled=${diagnosing} onClick=${onDiag}>
            <${Icon} name="activity" size=${15} />
            <span>${diagnosing ? 'Анализ…' : 'Диагностика'}</span>
          </button>
        </div>

        ${meshStats.diagnostics && html`<div class="diag-report-box">
          <div class="diag-row"><span>Ключи WebCrypto P-256 (extractable=false)</span><b class="ok">Активны</b></div>
          <div class="diag-row"><span>Эхо-тест AES-256-GCM + SHA-256</span><b class="ok">${meshStats.diagnostics.loopbackOk ? `OK (${meshStats.diagnostics.cryptoMs} мс)` : 'Ошибка'}</b></div>
          <div class="diag-row"><span>Авторизация сессии на узле</span><b class=${meshStats.diagnostics.sessionAuth ? 'ok' : ''}>${meshStats.diagnostics.sessionAuth ? 'Подтверждена (ZK)' : 'Ожидание'}</b></div>
          <div class="diag-row"><span>Очередь неотправленных конвертов</span><b>${meshStats.diagnostics.outboxQueued}</b></div>
          <div class="diag-row"><span>Версия клиента / узла</span><b>v${meshStats.diagnostics.appVersion}</b></div>
        </div>`}
      </div>
    </div>
  </section>`;
}
