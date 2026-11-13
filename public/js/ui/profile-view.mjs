// Экраны «Профиль» (в стиле кастомных профилей с частицами, фото, бейджами и баннером),
// «Контакты» и «Настройки» (кастомизация цветов приложения, тем, форм аватаров и обновлений GitHub).

import { html, useState, useRef } from '../../vendor/preact.mjs';
import {
  store,
  APP_VERSION,
  APP_VERSION_CODE,
  THEME_PRESETS,
  BANNER_PRESETS,
  DEFAULT_CLOUD_URL,
  updateMyProfile,
  updateThemeSettings,
  updateClientSettings,
  checkForUpdates,
  applyAppUpdate,
  rotateBlindMailbox,
  logoutAndWipeDevice,
  startChatWithUsername,
  selectChat,
  showToast,
  notifyStore,
} from '../store/app-store.mjs';
import { TRANSPORT_POLICY } from '../transport/transport-interface.mjs';
import {
  Icon,
  AvatarBox,
  ProfileBadgeIcon,
  AmbientParticles,
  compressAvatarImageFile,
} from './boss-screen.mjs';

const BADGE_OPTIONS = [
  { id: 'verified', label: 'Щит E2E' },
  { id: 'star', label: 'Звезда' },
  { id: 'bolt', label: 'Импульс' },
  { id: 'diamond', label: 'Кристалл' },
  { id: 'shield', label: 'Контур' },
  { id: 'none', label: 'Без значка' },
];

const PARTICLE_OPTIONS = [
  { id: 'stars', label: 'Звёздная пыль' },
  { id: 'snow', label: 'Мягкий снег' },
  { id: 'constellation', label: 'Узлы Mesh' },
  { id: 'pulse', label: 'Неон-импульс' },
  { id: 'none', label: 'Выключено' },
];

export function resolveBannerStyle(profileObj) {
  if (!profileObj) return BANNER_PRESETS.amoled;
  if (profileObj.bannerPreset === 'custom' && profileObj.bannerCustomColor) {
    return `radial-gradient(circle at 50% 22%, ${profileObj.bannerCustomColor} 0%, #07080d 82%)`;
  }
  return BANNER_PRESETS[profileObj.bannerPreset] || BANNER_PRESETS.amoled;
}

// ─────────────────────── Вкладка «Профиль» (Screenshot 4 + Studio) ───────────────────────

export function ProfileView() {
  const { me, profile, theme, update } = store;
  const [editOpen, setEditOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  const [displayName, setDisplayName] = useState(profile.displayName || me?.username || '');
  const [statusText, setStatusText] = useState(profile.statusText || '');
  const [bio, setBio] = useState(profile.bio || '');
  const fileRef = useRef(null);

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressAvatarImageFile(file, 184, 0.84);
      await updateMyProfile({ avatarDataUrl: dataUrl });
      showToast('Фото профиля обновлено и синхронизировано по E2EE');
    } catch (err) {
      showToast(err.message, 'err');
    }
  };

  const onSaveTextFields = async (e) => {
    e?.preventDefault();
    await updateMyProfile({
      displayName: displayName.trim() || me?.username || '',
      statusText: statusText.trim(),
      bio: bio.trim(),
    });
    setEditOpen(false);
    showToast('Профиль сохранён и отправлен контактам в зашифрованном виде');
  };

  const copyUsername = () => {
    navigator.clipboard?.writeText(`@${me?.username || ''}`).catch(() => {});
    showToast(`Скопировано: @${me?.username}`);
  };

  const copyAskUrl = () => {
    const base = store.settings.serverUrl ? store.settings.serverUrl.replace(/\/+$/, '') : location.origin;
    const url = `${base}/q/${me?.username}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    showToast(`Ссылка шлюза скопирована: ${url}`);
  };

  return html`<section class="tab-screen profile-screen">
    <div class="profile-scroll-body">
      <!-- Кастомный баннер профиля с живыми частицами и плавающим статусом -->
      <div class="custom-profile-hero" style=${`background:${resolveBannerStyle(profile)}`}>
        <${AmbientParticles} effect=${profile.particles} />

        <div class="profile-hero-top-actions">
          <span class="hero-tag-chip">E2EE ПРОФИЛЬ</span>
          <button
            type="button"
            class="hero-icon-pill"
            title="Настроить цвета и тему приложения"
            onClick=${() => setThemeOpen(!themeOpen)}
          >
            <${Icon} name="palette" size=${15} />
            <span>Тема</span>
          </button>
        </div>

        <div class="profile-avatar-stage">
          ${profile.statusText && html`<div class="profile-thought-bubble">
            <span>${profile.statusText}</span>
          </div>`}

          <div class="profile-avatar-ring" onClick=${() => fileRef.current?.click()}>
            <${AvatarBox}
              title=${profile.displayName || me?.username}
              username=${me?.username}
              avatarDataUrl=${profile.avatarDataUrl}
              color="#4338CA"
              size=${96}
            />
            <span class="avatar-cam-badge" title="Сменить фото"><${Icon} name="camera" size=${13} /></span>
          </div>
          <input
            ref=${fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange=${onPickPhoto}
          />
        </div>

        <div class="profile-identity-center">
          <div class="profile-display-name-row">
            <h2>${profile.displayName || me?.username || 'Оператор'}</h2>
            <${ProfileBadgeIcon} badge=${profile.badge} size=${15} />
          </div>
          <div class="profile-sub-status">
            @${me?.username} · сессия защищена (без повторного входа)
          </div>
        </div>

        <!-- 3 плитки действий как на референсном скриншоте профиля -->
        <div class="profile-quick-tiles">
          <button type="button" class="profile-tile-btn" onClick=${() => fileRef.current?.click()}>
            <${Icon} name="camera" size=${20} />
            <span>Выбрать фото</span>
          </button>
          <button type="button" class="profile-tile-btn" onClick=${() => setEditOpen(!editOpen)}>
            <${Icon} name="edit" size=${20} />
            <span>Изменить</span>
          </button>
          <button type="button" class="profile-tile-btn" onClick=${() => setThemeOpen(!themeOpen)}>
            <${Icon} name="palette" size=${20} />
            <span>Цвета и стиль</span>
          </button>
        </div>
      </div>

      <!-- Редактор кастомного профиля (плагин-стиль) -->
      ${editOpen && html`<form class="studio-card" onSubmit=${onSaveTextFields}>
        <div class="studio-card-head">
          <h3>Редактор кастомного профиля</h3>
          <button type="button" class="icon-btn small" onClick=${() => setEditOpen(false)}>
            <${Icon} name="close" size=${15} />
          </button>
        </div>

        <label class="field-label">Отображаемое имя</label>
        <input
          class="field-input"
          type="text"
          maxLength="40"
          placeholder="Ваше имя или позывной"
          value=${displayName}
          onInput=${(e) => setDisplayName(e.target.value)}
        />

        <label class="field-label">Статус-облачко над аватаром</label>
        <input
          class="field-input"
          type="text"
          maxLength="56"
          placeholder="Например: На связи · E2EE"
          value=${statusText}
          onInput=${(e) => setStatusText(e.target.value)}
        />

        <label class="field-label">О себе (шифруется E2EE для контактов)</label>
        <input
          class="field-input"
          type="text"
          maxLength="160"
          placeholder="Краткая подпись или специализация"
          value=${bio}
          onInput=${(e) => setBio(e.target.value)}
        />

        <label class="field-label">Значок рядом с именем</label>
        <div class="chip-grid">
          ${BADGE_OPTIONS.map((b) => html`<button
            key=${b.id}
            type="button"
            class=${`choice-chip ${profile.badge === b.id ? 'active' : ''}`}
            onClick=${() => updateMyProfile({ badge: b.id })}
          >${b.label}</button>`)}
        </div>

        <label class="field-label">Эффект частиц в шапке профиля</label>
        <div class="chip-grid">
          ${PARTICLE_OPTIONS.map((p) => html`<button
            key=${p.id}
            type="button"
            class=${`choice-chip ${profile.particles === p.id ? 'active' : ''}`}
            onClick=${() => updateMyProfile({ particles: p.id })}
          >${p.label}</button>`)}
        </div>

        <label class="field-label">Фон шапки профиля</label>
        <div class="swatch-row">
          ${Object.keys(BANNER_PRESETS).map((k) => html`<button
            key=${k}
            type="button"
            class=${`banner-swatch ${profile.bannerPreset === k ? 'active' : ''}`}
            style=${`background:${BANNER_PRESETS[k]}`}
            onClick=${() => updateMyProfile({ bannerPreset: k })}
            title=${k}
          ></button>`)}
          <label class="color-picker-pill" title="Свой цвет шапки">
            <input
              type="color"
              value=${profile.bannerCustomColor || '#1b2242'}
              onInput=${(e) => updateMyProfile({ bannerPreset: 'custom', bannerCustomColor: e.target.value })}
            />
            <span>HEX</span>
          </label>
        </div>

        <div class="studio-actions">
          ${profile.avatarDataUrl && html`<button
            type="button"
            class="btn-ghost compact"
            onClick=${() => updateMyProfile({ avatarDataUrl: '' })}
          >Сбросить фото</button>`}
          <button type="submit" class="btn-primary">Сохранить профиль</button>
        </div>
      </form>`}

      <!-- Студия кастомных цветов и визуала самого приложения -->
      ${themeOpen && html`<${ThemeStudioCard} onClose=${() => setThemeOpen(false)} />`}

      <!-- Информационные карточки профиля -->
      <div class="profile-info-group">
        <div class="profile-info-item" onClick=${copyUsername}>
          <div class="info-item-main">
            <div class="info-item-val">@${me?.username}</div>
            <div class="info-item-lbl">Имя пользователя (нажмите, чтобы скопировать)</div>
          </div>
          <${Icon} name="qr" size=${20} />
        </div>

        <div class="profile-info-item" onClick=${() => setEditOpen(true)}>
          <div class="info-item-main">
            <div class="info-item-val">${profile.bio || 'Сквозное шифрование Signal Protocol'}</div>
            <div class="info-item-lbl">О себе · синхронизируется по Double Ratchet</div>
          </div>
          <${Icon} name="edit" size=${17} />
        </div>

        <div class="profile-info-item" onClick=${copyAskUrl}>
          <div class="info-item-main">
            <div class="info-item-val">/q/${me?.username}</div>
            <div class="info-item-lbl">Анонимный E2EE-шлюз приёма обращений</div>
          </div>
          <${Icon} name="copy" size=${17} />
        </div>

        <div class="profile-info-item">
          <div class="info-item-main">
            <div class="info-item-val mono">${me?.publicKeyShort || me?.userId || 'P-256'}…</div>
            <div class="info-item-lbl">Публичный ключ личности NIST P-256 · extractable=false</div>
          </div>
          <${Icon} name="shield" size=${18} />
        </div>
      </div>

      <!-- Карточка автообновления GitHub Releases -->
      <div class="profile-info-group">
        <div class="profile-update-row">
          <div>
            <div class="info-item-val">
              MeshChat v${APP_VERSION} <span class="ver-build-tag">build ${APP_VERSION_CODE}</span>
            </div>
            <div class="info-item-lbl">
              ${update.available
                ? `Доступен релиз v${update.remoteVersion} на GitHub (проверка SHA-256)`
                : 'Автообновление через GitHub Releases без конфликта пакетов'}
            </div>
          </div>
          ${update.available
            ? html`<button type="button" class="btn-primary compact" onClick=${applyAppUpdate}>
                Обновить
              </button>`
            : html`<button
                type="button"
                class="btn-ghost compact"
                disabled=${update.checking}
                onClick=${() => checkForUpdates({ silent: false })}
              >${update.checking ? 'Проверка…' : 'Проверить'}</button>`}
        </div>
      </div>
    </div>
  </section>`;
}

// ─────────────────────── Студия кастомных тем и цветов приложения ───────────────────────

export function ThemeStudioCard({ onClose = null }) {
  const { theme } = store;

  return html`<div class="studio-card">
    <div class="studio-card-head">
      <h3>Кастомизация приложения и цветов</h3>
      ${onClose && html`<button type="button" class="icon-btn small" onClick=${onClose}>
        <${Icon} name="close" size=${15} />
      </button>`}
    </div>

    <label class="field-label">Цветовая палитра интерфейса</label>
    <div class="theme-presets-grid">
      ${Object.values(THEME_PRESETS).map((p) => html`<button
        key=${p.id}
        type="button"
        class=${`theme-preset-tile ${theme.preset === p.id ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ preset: p.id, customAccent: p.accent })}
      >
        <span class="preset-preview" style=${`background:${p.bg0};border-color:${p.accent}`}>
          <i style=${`background:${p.accent}`}></i>
        </span>
        <span>${p.label}</span>
      </button>`)}
    </div>

    <div class="custom-color-row">
      <div class="color-field-box">
        <span class="field-label">Свой цвет акцента</span>
        <label class="hex-color-control">
          <input
            type="color"
            value=${theme.customAccent || '#6d7cff'}
            onInput=${(e) => updateThemeSettings({ preset: 'custom', customAccent: e.target.value })}
          />
          <code>${(theme.customAccent || '#6d7cff').toUpperCase()}</code>
        </label>
      </div>

      <div class="color-field-box">
        <span class="field-label">Цвет моих сообщений</span>
        <label class="hex-color-control">
          <input
            type="color"
            value=${theme.customBubble || '#263159'}
            onInput=${(e) => updateThemeSettings({ customBubble: e.target.value })}
          />
          <button
            type="button"
            class="link-btn"
            onClick=${() => updateThemeSettings({ customBubble: '' })}
          >Авто</button>
        </label>
      </div>
    </div>

    <label class="field-label">Форма аватаров</label>
    <div class="chip-grid">
      <button
        type="button"
        class=${`choice-chip ${theme.avatarShape === 'squircle' ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ avatarShape: 'squircle' })}
      >Сквиркл (Mesh)</button>
      <button
        type="button"
        class=${`choice-chip ${theme.avatarShape === 'circle' ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ avatarShape: 'circle' })}
      >Круг (Классика)</button>
    </div>

    <label class="field-label">Скругление сообщений и узор фона чата</label>
    <div class="chip-grid">
      ${[[10, 'Строгое 10px'], [16, 'Стандарт 16px'], [22, 'Мягкое 22px']].map(([r, lbl]) => html`<button
        key=${r}
        type="button"
        class=${`choice-chip ${Number(theme.bubbleRadius) === r ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ bubbleRadius: r })}
      >${lbl}</button>`)}
      ${[['dots', 'Точки'], ['grid', 'Сетка'], ['none', 'Чистый OLED']].map(([bg, lbl]) => html`<button
        key=${bg}
        type="button"
        class=${`choice-chip ${theme.chatBackdrop === bg ? 'active' : ''}`}
        onClick=${() => updateThemeSettings({ chatBackdrop: bg })}
      >${lbl}</button>`)}
    </div>
  </div>`;
}

// ─────────────────────── Вкладка «Контакты» ───────────────────────

export function ContactsView() {
  const { chats, me } = store;
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const dmList = Object.values(chats)
    .filter((c) => c.kind === 'dm')
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

  const onAdd = async (e) => {
    e.preventDefault();
    if (!query.trim() || adding) return;
    setAdding(true);
    try {
      await startChatWithUsername(query);
      setQuery('');
    } catch (err) {
      showToast(err.message, 'err');
    } finally {
      setAdding(false);
    }
  };

  return html`<section class="tab-screen contacts-screen">
    <header class="screen-hero-head">
      <div>
        <h1 class="screen-big-title">Контакты</h1>
        <div class="screen-pills-row">
          <span class="hero-status-pill online">
            <span class="status-dot"></span>
            ${dmList.length} проверенных узлов
          </span>
          <span class="hero-status-pill neutral">@${me?.username}</span>
        </div>
      </div>
    </header>

    <div class="mesh-scroll-body">
      <form class="add-contact-bar" onSubmit=${onAdd}>
        <input
          class="field-input"
          type="text"
          placeholder="Добавить по @username (обмен ключами X3DH)…"
          value=${query}
          onInput=${(e) => setQuery(e.target.value)}
        />
        <button type="submit" class="btn-primary compact" disabled=${adding}>
          <${Icon} name="plus" size=${16} />
          <span>${adding ? 'Поиск…' : 'Добавить'}</span>
        </button>
      </form>

      <div class="section-cap">ДОВЕРЕННЫЕ СОБЕСЕДНИКИ</div>
      <div class="plugin-list-card">
        ${dmList.length === 0 && html`<div class="empty-list-hint">
          Список контактов пуст. Введите <code>@username</code> собеседника выше, чтобы загрузить его PreKeyBundle.
        </div>`}
        ${dmList.map((c) => html`<div
          key=${c.id}
          class="contact-row-item"
          onClick=${() => selectChat(c.id)}
        >
          <${AvatarBox}
            title=${c.peerProfile?.displayName || c.title}
            username=${c.username}
            avatarDataUrl=${c.peerProfile?.avatarDataUrl || ''}
            color=${c.avatarColor}
            size=${46}
          />
          <div class="plugin-copy">
            <div class="plugin-title">
              ${c.peerProfile?.displayName || c.title}
              <${ProfileBadgeIcon} badge=${c.peerProfile?.badge || (c.verified ? 'verified' : 'none')} size=${13} />
            </div>
            <div class="plugin-sub">
              @${c.username} · ${c.peerProfile?.statusText || (c.verified ? 'Ключ подтверждён' : 'Double Ratchet E2EE')}
            </div>
          </div>
          <${Icon} name="chat" size=${18} />
        </div>`)}
      </div>
    </div>
  </section>`;
}

// ─────────────────────── Вкладка «Настройки» (полноэкранная студия) ───────────────────────

const POLICY_LIST = [
  [TRANSPORT_POLICY.AUTO, 'Автоматический мультитранспорт', 'WSS -> P2P WebRTC -> Tor -> I2P'],
  [TRANSPORT_POLICY.TOR_ONLY, 'Только Tor (.onion) · Fail-Closed', 'Строгая блокировка прямых соединений'],
  [TRANSPORT_POLICY.P2P_FIRST, 'Приоритет P2P WebRTC', 'Прямые каналы между пирами'],
  [TRANSPORT_POLICY.DIRECT_ONLY, 'Прямой WSS ретранслятор', 'Минимальная задержка доставки'],
];

export function SettingsScreen() {
  const { settings, update } = store;
  const [serverUrl, setServerUrl] = useState(settings.serverUrl || '');
  const [onionUrl, setOnionUrl] = useState(settings.onionUrl || '');

  const onSaveNetwork = async () => {
    await updateClientSettings({
      serverUrl: serverUrl.trim(),
      onionUrl: onionUrl.trim(),
    });
    showToast('Сетевая конфигурация сохранена');
  };

  return html`<section class="tab-screen settings-screen">
    <header class="screen-hero-head">
      <div>
        <h1 class="screen-big-title">Настройки</h1>
        <div class="screen-pills-row">
          <span class="hero-status-pill online">v${APP_VERSION} · build ${APP_VERSION_CODE}</span>
          <span class="hero-status-pill neutral">GitHub Auto-Update</span>
        </div>
      </div>
    </header>

    <div class="mesh-scroll-body">
      <${ThemeStudioCard} />

      <div class="studio-card">
        <div class="studio-card-head">
          <h3>Автообновление через GitHub Releases</h3>
        </div>
        <p class="modal-desc">
          Пакет подписан постоянным сертификатом релиза (<code>io.meshchat.app</code>), поэтому новые версии
          устанавливаются поверх текущей без конфликта пакетов и с полным сохранением аккаунта и переписки.
        </p>
        <div class="studio-actions">
          <button
            type="button"
            class="btn-ghost compact"
            disabled=${update.checking}
            onClick=${() => checkForUpdates({ silent: false })}
          >
            <${Icon} name="refresh" size=${14} /> ${update.checking ? 'Проверка…' : 'Проверить релизы GitHub'}
          </button>
          <button type="button" class="btn-primary compact" onClick=${applyAppUpdate}>
            <${Icon} name="download" size=${14} /> ${update.available ? `Установить v${update.remoteVersion}` : 'Переустановить с GitHub'}
          </button>
        </div>
      </div>

      <div class="studio-card">
        <div class="studio-card-head">
          <h3>Узел ретрансляции и политика маршрутизации</h3>
        </div>
        <div class="chip-grid" style="margin-bottom:10px">
          <button
            type="button"
            class="choice-chip"
            onClick=${() => { setServerUrl(DEFAULT_CLOUD_URL); updateClientSettings({ serverUrl: DEFAULT_CLOUD_URL }); }}
          >Облачный узел EU</button>
          <button
            type="button"
            class="choice-chip"
            onClick=${() => { setServerUrl(''); updateClientSettings({ serverUrl: '' }); }}
          >Локальный узел</button>
        </div>

        <label class="field-label">URL сервера ретрансляции</label>
        <input
          class="field-input"
          type="text"
          placeholder="https://meshchat-6a11.onrender.com"
          value=${serverUrl}
          onInput=${(e) => setServerUrl(e.target.value)}
        />

        <label class="field-label">Адрес скрытого сервиса Tor (.onion)</label>
        <input
          class="field-input"
          type="text"
          placeholder="ws://xxxx.onion/ws"
          value=${onionUrl}
          onInput=${(e) => setOnionUrl(e.target.value)}
        />

        <label class="field-label">Режим транспорта</label>
        <div class="policy-stack">
          ${POLICY_LIST.map(([id, title, sub]) => html`<label
            key=${id}
            class=${`policy-card ${settings.transportPolicy === id ? 'selected' : ''}`}
            onClick=${() => updateClientSettings({ transportPolicy: id })}
          >
            <div>
              <div class="policy-title">${title}</div>
              <div class="policy-desc">${sub}</div>
            </div>
          </label>`)}
        </div>

        <div class="studio-actions">
          <button type="button" class="btn-ghost compact" onClick=${rotateBlindMailbox}>
            Ротировать слепой ящик
          </button>
          <button type="button" class="btn-primary compact" onClick=${onSaveNetwork}>
            Применить сеть
          </button>
        </div>
      </div>

      <div class="studio-card danger-zone">
        <div class="studio-card-head">
          <h3>Управление ключами устройства</h3>
        </div>
        <p class="modal-desc">
          Сессия сохраняется навсегда между перезапусками и обновлениями APK. Кнопка ниже полностью уничтожает
          локальные ключи и историю на этом устройстве.
        </p>
        <button type="button" class="btn-danger" onClick=${logoutAndWipeDevice}>
          Завершить сеанс и стереть ключи на устройстве
        </button>
      </div>
    </div>
  </section>`;
}
