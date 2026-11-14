// Специализированные разделы центра «Настройки» MeshChat v1.9:
// метаданные 11 категорий с пастельными иконками, глобальный поисковый индекс параметров
// и экраны подразделов «Аккаунт», «Стикеры и эмодзи», «Папки с чатами»,
// «Энергосбережение», «Язык и форматы», «Обновления и диагностика».

import { html, useState, useRef } from '../../vendor/preact.mjs';
import {
  store,
  notifyStore,
  APP_VERSION,
  APP_VERSION_CODE,
  BANNER_PRESETS,
  REACTION_PACKS,
  COMPOSER_QUICK_EMOJIS,
  uiText,
  isPowerSavingActive,
  updateMyProfile,
  updateClientSettings,
  rotateBlindMailbox,
  copyWithPrivacy,
  toggleSystemChatFolder,
  createCustomChatFolder,
  deleteCustomChatFolder,
  toggleChatInFolder,
  checkForUpdates,
  applyAppUpdate,
  runMeshDiagnostics,
  sendMeshTestPacket,
  resetAllSettingsToDefaults,
  logoutAndWipeDevice,
  setNavTab,
  showToast,
} from '../store/app-store.mjs';
import {
  Icon,
  AvatarBox,
  ProfileBadgeIcon,
  compressAvatarImageFile,
} from './boss-screen.mjs';

// ─────────────────────── Каталог 11 разделов главного экрана «Настройки» ───────────────────────

export const SETTINGS_SECTIONS_META = [
  {
    id: 'account',
    icon: 'user',
    circleBg: '#8ec5fc',
    circleFg: '#0e2844',
    titleRu: 'Аккаунт',
    titleEn: 'Account',
    sub: 'Имя пользователя, «О себе», статус и ключи',
  },
  {
    id: 'chats',
    icon: 'chat',
    circleBg: '#efc07b',
    circleFg: '#3a2409',
    titleRu: 'Настройки чатов',
    titleEn: 'Chat Settings',
    sub: 'Обои, новогодние темы, градиенты и анимации',
  },
  {
    id: 'reactions',
    icon: 'smile',
    circleBg: '#f3a97e',
    circleFg: '#3d1c0c',
    titleRu: 'Стикеры и эмодзи',
    titleEn: 'Stickers & Emoji',
    sub: 'Настройки стикеров, эмодзи и быстрых реакций',
  },
  {
    id: 'privacy',
    icon: 'key',
    circleBg: '#8fe09b',
    circleFg: '#10351a',
    titleRu: 'Конфиденциальность',
    titleEn: 'Privacy & Security',
    sub: 'PIN-код, защита от скриншотов, ключи доступа',
  },
  {
    id: 'notifications',
    icon: 'volume',
    circleBg: '#f48fa4',
    circleFg: '#3f111d',
    titleRu: 'Уведомления',
    titleEn: 'Notifications',
    sub: 'Звуки, звонки, счётчик сообщений и тихий час',
  },
  {
    id: 'storage',
    icon: 'pie',
    circleBg: '#8fa6f9',
    circleFg: '#141f49',
    titleRu: 'Данные и память',
    titleEn: 'Data & Storage',
    sub: 'Настройки загрузки медиафайлов и резерв E2EE',
  },
  {
    id: 'folders',
    icon: 'folder',
    circleBg: '#88ccf2',
    circleFg: '#0f2e42',
    titleRu: 'Папки с чатами',
    titleEn: 'Chat Folders',
    sub: 'Сортировка чатов по папкам и свои вкладки',
  },
  {
    id: 'devices',
    icon: 'laptop',
    circleBg: '#8ee0d4',
    circleFg: '#0e3530',
    titleRu: 'Устройства',
    titleEn: 'Devices & Mesh',
    sub: 'Управление активными сеансами и сетью Mesh',
  },
  {
    id: 'power',
    icon: 'battery',
    circleBg: '#f3c083',
    circleFg: '#3d250a',
    titleRu: 'Энергосбережение',
    titleEn: 'Power Saving',
    sub: 'Экономия энергии при низком заряде батареи',
  },
  {
    id: 'language',
    icon: 'globe',
    circleBg: '#c49bf8',
    circleFg: '#2a1346',
    titleRu: 'Язык',
    titleEn: 'Language',
    sub: '',
    rightValue: () => uiText('langName'),
  },
  {
    id: 'updates',
    icon: 'download',
    circleBg: '#7fd4fb',
    circleFg: '#0d2e42',
    titleRu: 'Обновления и диагностика',
    titleEn: 'Updates & Diagnostics',
    sub: 'Релизы GitHub, проверка целостности APK и криптоядра',
    rightValue: () => (store.update?.available ? `v${store.update.remoteVersion}` : `v${APP_VERSION}`),
  },
];

// Глобальный поисковый справочник по всем параметрам для быстрого перехода
export const SETTINGS_SEARCH_INDEX = [
  { section: 'account', title: 'Отображаемое имя, статус и биография «О себе»', kw: 'аккаунт имя статус о себе био аватар фото баннер значок username' },
  { section: 'account', title: 'Слепой почтовый ящик и внешний шлюз /q/', kw: 'ящик ротация токен ключи отпечаток qr визитка выход' },
  { section: 'chats', title: 'Новогодние сцены, градиенты и 18 цветовых тем', kw: 'тема цвета градиент новый год зима полярное сияние рубин хвоя золото amoled' },
  { section: 'chats', title: 'Снежинки, метель и светящаяся новогодняя гирлянда', kw: 'снег снежинки снегопад метель гирлянда искры мороз стекло шапки' },
  { section: 'chats', title: 'Обои чата, размер шрифта, скругление пузырей и плотность', kw: 'обои фон узор шрифт размер плотность компактно хвостики аватары' },
  { section: 'chats', title: 'Клавиша Enter, орфография, черновики и скорость голосовых', kw: 'ввод enter орфография черновик скорость голосовые аудио ссылки ttl таймер' },
  { section: 'reactions', title: 'Быстрая реакция по двойному нажатию и наборы эмодзи', kw: 'стикеры эмодзи реакции двойной клик нажатие лайк снежинка елка панель' },
  { section: 'reactions', title: 'Крупные одиночные эмодзи и быстрая панель над вводом', kw: 'крупные эмодзи стикер анимация полоса панель ввода' },
  { section: 'privacy', title: 'Локальный PIN-код, автоблокировка и блокировка при сворачивании', kw: 'пин pin пароль блокировка автоблокировка сворачивание фон' },
  { section: 'privacy', title: 'Защита от скриншотов (FLAG_SECURE) и приватная клавиатура', kw: 'скриншоты запись экрана flag_secure инкогнито клавиатура размытие фото' },
  { section: 'privacy', title: 'Отчёты о прочтении ✓✓, статус «онлайн» и экран маскировки Esc×2', kw: 'прочитано печатает онлайн превью буфер обмена маскировка таблица терминал' },
  { section: 'notifications', title: 'Звуки сообщений, мелодия звонка, счётчик и тихие часы', kw: 'уведомления звук мелодия звонок рингтон вибрация счётчик бейдж тихий час ночью' },
  { section: 'storage', title: 'Автозагрузка медиа, качество фото, кеш ОЗУ и бэкап AES-256-GCM', kw: 'данные память медиа фото сжатие качество кеш озу очистка резервная копия бэкап экспорт импорт' },
  { section: 'folders', title: 'Папки с чатами: системные фильтры и создание собственных папок', kw: 'папки чаты сортировка вкладки непрочитанные личные работа семья создать' },
  { section: 'devices', title: 'Активный сеанс устройства, сервер ретрансляции, Tor / I2P и WebRTC', kw: 'устройства сеанс сеть сервер relay tor onion i2p прокси socks5 stun паддинг выравнивание cover' },
  { section: 'power', title: 'Энергосбережение при низком заряде батареи и лимит 30 FPS', kw: 'энергосбережение батарея заряд экономия 30 fps анимации размытие снег' },
  { section: 'language', title: 'Язык интерфейса (Русский / English) и региональные форматы', kw: 'язык русский english время 24 12 неделя байты мб миб' },
  { section: 'updates', title: 'Автообновление APK через GitHub Releases и диагностика E2EE', kw: 'обновление apk github версия сборка тест диагностика самопроверка' },
];

export function getSectionTitle(meta) {
  if (!meta) return uiText('settings');
  return store.settings?.appLanguage === 'en' ? meta.titleEn : meta.titleRu;
}

// ─────────────────────── 1. Раздел «Аккаунт» ───────────────────────

export function AccountSectionView() {
  const { me, profile, settings } = store;
  const [displayName, setDisplayName] = useState(profile.displayName || me?.username || '');
  const [statusText, setStatusText] = useState(profile.statusText || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [wipeConfirm, setWipeConfirm] = useState(false);
  const fileRef = useRef(null);

  const onSaveAccount = async () => {
    await updateMyProfile({
      displayName: displayName.trim(),
      statusText: statusText.trim(),
      bio: bio.trim(),
    });
    showToast('Данные аккаунта сохранены и синхронизированы по E2EE');
  };

  const onAvatarPicked = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const dataUrl = await compressAvatarImageFile(f, 176, 0.84);
      await updateMyProfile({ avatarDataUrl: dataUrl });
      showToast('Фотография аккаунта обновлена');
    } catch (err) {
      showToast(err.message, 'err');
    }
  };

  const gatewayUrl = `${(settings.serverUrl || (typeof location !== 'undefined' ? location.origin : '')).replace(/\/+$/, '')}/q/${me?.username || ''}`;

  return html`<div class="settings-sub-stack">
    <div class="studio-card">
      <div class="account-hero-banner" style=${`background:${BANNER_PRESETS[profile.bannerPreset] || BANNER_PRESETS.ny_aurora}`}>
        <div class="account-hero-row">
          <div class="account-avatar-Trigger" onClick=${() => fileRef.current?.click()}>
            <${AvatarBox}
              title=${profile.displayName || me?.username}
              username=${me?.username}
              avatarDataUrl=${profile.avatarDataUrl}
              color="#4338CA"
              size=${64}
              online=${!settings.hideOnlinePresence}
            />
          </div>
          <div class="account-hero-meta">
            <div class="account-hero-name">
              <span>${profile.displayName || me?.username}</span>
              <${ProfileBadgeIcon} badge=${profile.badge || 'verified'} size=${15} />
            </div>
            <div class="account-hero-handle">@${me?.username || 'local'} · ZK-сессия активна</div>
            <div class="account-hero-status">${profile.statusText || 'На связи · E2EE'}</div>
          </div>
        </div>
      </div>

      <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${onAvatarPicked} />
      <div class="studio-actions" style="justify-content:flex-start;margin-top:4px">
        <button type="button" class="btn-ghost compact" onClick=${() => fileRef.current?.click()}>
          <${Icon} name="camera" size=${14} /> Сменить фото
        </button>
        ${profile.avatarDataUrl && html`<button
          type="button"
          class="btn-ghost compact"
          onClick=${() => updateMyProfile({ avatarDataUrl: '' })}
        >Удалить фото</button>`}
        <button
          type="button"
          class="btn-ghost compact"
          onClick=${() => { store.ui.modal = 'qr'; notifyStore(); }}
        ><${Icon} name="qr" size=${14} /> Моя QR-визитка</button>
        <button type="button" class="btn-ghost compact" onClick=${() => setNavTab('profile')}>
          Полный редактор профиля
        </button>
      </div>

      <label class="field-label">Отображаемое имя</label>
      <input
        class="field-input"
        type="text"
        maxLength="40"
        placeholder="Как вас видят контакты"
        value=${displayName}
        onInput=${(e) => setDisplayName(e.target.value)}
      />

      <label class="field-label">Краткий статус</label>
      <input
        class="field-input"
        type="text"
        maxLength="60"
        placeholder="На связи · Signal Double Ratchet"
        value=${statusText}
        onInput=${(e) => setStatusText(e.target.value)}
      />

      <label class="field-label">О себе (передаётся только контактам внутри E2EE)</label>
      <textarea
        class="field-input"
        rows="2"
        maxLength="180"
        placeholder="Краткая информация о себе…"
        value=${bio}
        onInput=${(e) => setBio(e.target.value)}
      ></textarea>

      <label class="field-label">Значок рядом с именем</label>
      <div class="chip-grid">
        ${[
          ['verified', 'Щит E2EE'],
          ['snowflake', 'Снежинка'],
          ['tree', 'Ель'],
          ['sparkle', 'Сияние'],
          ['bolt', 'Импульс'],
          ['star', 'Звезда'],
          ['diamond', 'Кристалл'],
          ['none', 'Без значка'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(profile.badge || 'verified') === id ? 'active' : ''}`}
          onClick=${() => updateMyProfile({ badge: id })}
        >${lbl}</button>`)}
      </div>

      <div class="studio-actions">
        <button type="button" class="btn-primary compact" onClick=${onSaveAccount}>
          Сохранить данные аккаунта
        </button>
      </div>
    </div>

    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="key" size=${16} /> Криптографические реквизиты аккаунта</h3>
      </div>

      <div class="kv-info-list">
        <div class="kv-info-row">
          <span>Имя пользователя</span>
          <code>@${me?.username || '—'}</code>
        </div>
        <div class="kv-info-row">
          <span>ID слепого почтового ящика</span>
          <code>${(me?.mailboxId || '').slice(0, 18)}…</code>
        </div>
        <div class="kv-info-row">
          <span>Внешний приёмный шлюз E2E</span>
          <code>/q/${me?.username || ''}</code>
        </div>
      </div>

      <div class="studio-actions" style="justify-content:flex-start">
        <button
          type="button"
          class="btn-ghost compact"
          onClick=${() => copyWithPrivacy(`@${me?.username || ''}`, 'Имя @username скопировано')}
        ><${Icon} name="copy" size=${13} /> Копировать @username</button>
        <button
          type="button"
          class="btn-ghost compact"
          onClick=${() => copyWithPrivacy(gatewayUrl, 'Ссылка E2E-шлюза скопирована')}
        ><${Icon} name="copy" size=${13} /> Ссылка /q/${me?.username}</button>
        <button type="button" class="btn-ghost compact" onClick=${rotateBlindMailbox}>
          <${Icon} name="refresh" size=${13} /> Сменить адрес ящика
        </button>
      </div>
    </div>

    <div class="studio-card danger-zone">
      <div class="studio-card-head">
        <h3><${Icon} name="trash" size=${16} /> Управление ключами на устройстве</h3>
      </div>
      <p class="modal-desc">
        Сброс настроек возвращает стандартное оформление без выхода из аккаунта. Полный выход стирает приватные ключи
        X25519/Ed25519 из локального хранилища этого устройства.
      </p>
      <div class="studio-actions" style="justify-content:space-between">
        <button type="button" class="btn-ghost compact" onClick=${resetAllSettingsToDefaults}>
          Сбросить только настройки
        </button>
        ${!wipeConfirm
          ? html`<button type="button" class="btn-danger compact" onClick=${() => setWipeConfirm(true)}>
              Стереть ключи и выйти…
            </button>`
          : html`<div class="wipe-confirm-row">
              <button type="button" class="btn-ghost compact" onClick=${() => setWipeConfirm(false)}>Отмена</button>
              <button type="button" class="btn-danger compact" onClick=${logoutAndWipeDevice}>
                Подтвердить выход
              </button>
            </div>`}
      </div>
    </div>
  </div>`;
}

// ─────────────────────── 3. Раздел «Стикеры и эмодзи» ───────────────────────

export function ReactionsSectionView() {
  const { settings } = store;

  return html`<div class="settings-sub-stack">
    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="smile" size=${16} /> Быстрые реакции, эмодзи и стикер-режим</h3>
      </div>

      <label class="field-label">Основная быстрая реакция (по двойному нажатию на сообщение)</label>
      <div class="emoji-choice-grid">
        ${['❄️', '🎄', '✨', '🎉', '❤️', '🔥', '👍', '⚡', '🛡️', '🤝', '👏', '👀'].map((em) => html`<button
          key=${em}
          type="button"
          class=${`emoji-pick-btn ${(settings.quickReactionEmoji || '❄️') === em ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ quickReactionEmoji: em })}
        >${em}</button>`)}
      </div>

      <label class="field-label">Набор реакций при нажатии на сообщение</label>
      <div class="policy-stack">
        ${Object.values(REACTION_PACKS).map((pack) => html`<div
          key=${pack.id}
          class=${`policy-card ${(settings.reactionPack || 'winter') === pack.id ? 'selected' : ''}`}
          onClick=${() => updateClientSettings({ reactionPack: pack.id })}
        >
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%">
            <div>
              <div class="policy-title">${pack.label}</div>
              <div class="policy-desc">Доступен в контекстной панели каждого сообщения E2EE</div>
            </div>
            <div style="font-size:17px;letter-spacing:3px;flex-shrink:0">${pack.emojis.join(' ')}</div>
          </div>
        </div>`)}
      </div>

      <label class="field-label">Действие по двойному нажатию на пузырь сообщения</label>
      <div class="chip-grid">
        ${[
          ['react', `Поставить ${settings.quickReactionEmoji || '❄️'}`],
          ['reply', 'Цитировать сообщение'],
          ['copy', 'Скопировать текст'],
          ['none', 'Отключено'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.doubleTapAction || 'react') === id ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ doubleTapAction: id })}
        >${lbl}</button>`)}
      </div>

      <div class="settings-rows-list">
        <div class="settings-switch-row" onClick=${() => updateClientSettings({ largeSingleEmoji: settings.largeSingleEmoji === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Крупные одиночные эмодзи (стикер-режим)</div>
            <div class="plugin-sub">Сообщения из 1–3 эмодзи без текста отображаются в увеличенном размере</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.largeSingleEmoji !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ composerEmojiBar: !settings.composerEmojiBar })}>
          <div class="plugin-copy">
            <div class="plugin-title">Панель быстрых эмодзи и зимних символов над полем ввода</div>
            <div class="plugin-sub">Полоса мгновенной вставки ${COMPOSER_QUICK_EMOJIS.slice(0, 6).join(' ')} в один тап</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.composerEmojiBar ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ animateReactions: settings.animateReactions === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Анимация счётчиков реакций</div>
            <div class="plugin-sub">Плавный отклик пилюли реакции при нажатии собеседником или вами</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.animateReactions !== false ? 'on' : ''}`}><span></span></button>
        </div>
      </div>
    </div>
  </div>`;
}

// ─────────────────────── 7. Раздел «Папки с чатами» ───────────────────────

export function FoldersSectionView() {
  const { settings, chats } = store;
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedChats, setSelectedChats] = useState({});
  const [expandedFolderId, setExpandedFolderId] = useState(null);

  const enabledSys = Array.isArray(settings.enabledSystemFolders)
    ? settings.enabledSystemFolders
    : ['unread', 'dm', 'verified', 'pinned', 'ask'];
  const customFolders = Array.isArray(settings.customFolders) ? settings.customFolders : [];
  const allChats = Object.values(chats);

  const onCreateFolder = async (e) => {
    e?.preventDefault();
    const chosen = Object.entries(selectedChats)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const created = await createCustomChatFolder(newFolderName, chosen);
    if (created) {
      setNewFolderName('');
      setSelectedChats({});
    }
  };

  return html`<div class="settings-sub-stack">
    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="folder" size=${16} /> Системные вкладки-папки на экране «Чаты»</h3>
      </div>

      <div class="settings-rows-list">
        ${[
          ['unread', 'Непрочитанные', 'Диалоги с новыми непрочитанными сообщениями'],
          ['dm', 'Личные диалоги', 'Все прямые контакты X3DH + Double Ratchet'],
          ['verified', 'Проверенные ключи', 'Собеседники со сверенным кодом безопасности Safety Number'],
          ['pinned', 'Закреплённые', 'Важные диалоги, отмеченные булавкой'],
          ['ask', 'Входящий шлюз E2E', 'Анонимные зашифрованные обращения через /q/'],
        ].map(([id, title, sub]) => html`<div
          key=${id}
          class="settings-switch-row"
          onClick=${() => toggleSystemChatFolder(id)}
        >
          <div class="plugin-copy">
            <div class="plugin-title">${title}</div>
            <div class="plugin-sub">${sub}</div>
          </div>
          <button type="button" class=${`ios-switch ${enabledSys.includes(id) ? 'on' : ''}`}><span></span></button>
        </div>`)}
      </div>

      <div class="settings-rows-list" style="margin-top:6px">
        <div class="settings-switch-row" onClick=${() => updateClientSettings({ showFolderCounts: settings.showFolderCounts === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Показывать счётчик непрочитанных на вкладках папок</div>
            <div class="plugin-sub">Отображает число активных чатов рядом с названием каждой папки</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.showFolderCounts !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ compactFolderTabs: !settings.compactFolderTabs })}>
          <div class="plugin-copy">
            <div class="plugin-title">Компактная панель папок</div>
            <div class="plugin-sub">Уменьшает отступы вкладок, чтобы помещалось больше папок без прокрутки</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.compactFolderTabs ? 'on' : ''}`}><span></span></button>
        </div>
      </div>
    </div>

    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="plus" size=${16} /> Создать собственную папку чатов</h3>
      </div>

      <form onSubmit=${onCreateFolder} style="display:flex;flex-direction:column;gap:10px">
        <div class="inline-form-row">
          <input
            class="field-input"
            type="text"
            maxLength="24"
            placeholder="Название папки (Работа, Семья, Узлы…)"
            value=${newFolderName}
            onInput=${(e) => setNewFolderName(e.target.value)}
          />
          <button type="submit" class="btn-primary compact">Создать</button>
        </div>

        <div class="chip-grid">
          ${[
            'Работа',
            'Личное',
            'Команда',
            'Избранное',
          ].map((presetName) => html`<button
            key=${presetName}
            type="button"
            class="choice-chip"
            onClick=${() => setNewFolderName(presetName)}
          >+ ${presetName}</button>`)}
        </div>

        <label class="field-label">Включить диалоги в новую папку (${allChats.length})</label>
        <div class="folder-chats-pick-list">
          ${allChats.map((c) => {
            const title = c.peerProfile?.displayName || c.title;
            const checked = Boolean(selectedChats[c.id]);
            return html`<div
              key=${c.id}
              class=${`folder-chat-pick-item ${checked ? 'selected' : ''}`}
              onClick=${() => setSelectedChats((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
            >
              <span>${title}</span>
              <span class="folder-check-mark">${checked ? '✓' : '+'}</span>
            </div>`;
          })}
        </div>
      </form>
    </div>

    ${customFolders.length > 0 && html`<div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="folder" size=${16} /> Мои папки (${customFolders.length})</h3>
      </div>
      <div class="settings-rows-list">
        ${customFolders.map((fld) => html`<div key=${fld.id} class="custom-folder-manage-card">
          <div class="custom-folder-manage-top">
            <div>
              <div class="plugin-title">${fld.title}</div>
              <div class="plugin-sub">Диалогов в папке: ${(fld.chatIds || []).length}</div>
            </div>
            <div style="display:flex;gap:6px">
              <button
                type="button"
                class="btn-ghost compact"
                onClick=${() => setExpandedFolderId(expandedFolderId === fld.id ? null : fld.id)}
              >${expandedFolderId === fld.id ? 'Готово' : 'Состав'}</button>
              <button
                type="button"
                class="btn-danger compact"
                onClick=${() => deleteCustomChatFolder(fld.id)}
              ><${Icon} name="trash" size=${13} /></button>
            </div>
          </div>

          ${expandedFolderId === fld.id && html`<div class="folder-chats-pick-list" style="margin-top:8px">
            ${allChats.map((c) => {
              const inFld = (fld.chatIds || []).includes(c.id);
              return html`<div
                key=${c.id}
                class=${`folder-chat-pick-item ${inFld ? 'selected' : ''}`}
                onClick=${() => toggleChatInFolder(fld.id, c.id)}
              >
                <span>${c.peerProfile?.displayName || c.title}</span>
                <span class="folder-check-mark">${inFld ? '✓' : '+'}</span>
              </div>`;
            })}
          </div>`}
        </div>`)}
      </div>
    </div>`}
  </div>`;
}

// ─────────────────────── 9. Раздел «Энергосбережение» ───────────────────────

export function PowerSavingSectionView() {
  const { settings, battery } = store;
  const activeNow = isPowerSavingActive();
  const batPct = Math.round((battery?.level ?? 1) * 100);

  return html`<div class="settings-sub-stack">
    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="battery" size=${16} /> Режим экономии энергии и ресурсов GPU</h3>
      </div>

      <div class="power-status-banner">
        <div>
          <b>${activeNow ? 'Энергосбережение сейчас активно' : 'Полная графическая производительность (60 FPS)'}</b>
          <span>
            ${battery?.supported
              ? `Заряд аккумулятора: ${batPct}% · ${battery.charging ? 'Подключено питание' : 'Работа от батареи'}`
              : 'Ручное или автоматическое управление фоновыми эффектами'}
          </span>
        </div>
        <span class=${`hero-status-pill ${activeNow ? 'warn' : 'online'}`}>
          ${activeNow ? 'ЭКОНОМ' : '60 FPS'}
        </span>
      </div>

      <label class="field-label">Порог включения энергосбережения</label>
      <div class="chip-grid">
        ${[
          ['off', 'Всегда выключено'],
          ['auto20', 'Авто при ≤ 20%'],
          ['auto35', 'Авто при ≤ 35%'],
          ['always', 'Включено постоянно'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.powerSaveMode || 'auto20') === id ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ powerSaveMode: id })}
        >${lbl}</button>`)}
      </div>

      <label class="field-label">Что отключать в режиме энергосбережения</label>
      <div class="settings-rows-list">
        <div class="settings-switch-row" onClick=${() => updateClientSettings({ powerPauseSnow: settings.powerPauseSnow === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Приостанавливать снежинки, метель и полярное сияние</div>
            <div class="plugin-sub">Полностью освобождает Canvas-поток отрисовки фоновых частиц</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.powerPauseSnow !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ powerPauseGarland: settings.powerPauseGarland === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Отключать свечение новогодней гирлянды</div>
            <div class="plugin-sub">Убирает CSS-тени и плавное мерцание ламп вдоль верхнего края</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.powerPauseGarland !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ powerDisableBlur: settings.powerDisableBlur === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Отключать размытие морозного стекла (backdrop-filter)</div>
            <div class="plugin-sub">Переводит карточки в непрозрачный OLED-режим для ускорения прокрутки</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.powerDisableBlur !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ powerReduceFps: settings.powerReduceFps === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Ограничивать частоту анимаций до 30 кадр/с</div>
            <div class="plugin-sub">Снижает нагрев и потребление экрана 120 Гц вдвое без полного отключения эффектов</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.powerReduceFps !== false ? 'on' : ''}`}><span></span></button>
        </div>

        <div class="settings-switch-row" onClick=${() => updateClientSettings({ powerSlowSync: settings.powerSlowSync === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Бережный фоновый опрос сети</div>
            <div class="plugin-sub">Удваивает интервал резервной синхронизации ящика при работе от батареи</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.powerSlowSync !== false ? 'on' : ''}`}><span></span></button>
        </div>
      </div>
    </div>
  </div>`;
}

// ─────────────────────── 10. Раздел «Язык и форматы» ───────────────────────

export function LanguageSectionView() {
  const { settings } = store;

  return html`<div class="settings-sub-stack">
    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="globe" size=${16} /> Язык интерфейса и региональные единицы</h3>
      </div>

      <label class="field-label">Язык навигации и заголовков приложения</label>
      <div class="policy-stack">
        ${[
          ['ru', 'Русский', 'Основной язык интерфейса MeshChat (по умолчанию)'],
          ['en', 'English', 'English navigation & section headers'],
        ].map(([code, title, desc]) => html`<div
          key=${code}
          class=${`policy-card ${(settings.appLanguage || 'ru') === code ? 'selected' : ''}`}
          onClick=${() => updateClientSettings({ appLanguage: code })}
        >
          <div>
            <div class="policy-title">${title}</div>
            <div class="policy-desc">${desc}</div>
          </div>
        </div>`)}
      </div>

      <label class="field-label">Формат времени сообщений</label>
      <div class="chip-grid">
        ${[
          ['24h', '24 часа (14:30)'],
          ['24h_sec', '24 часа с секундами (14:30:09)'],
          ['12h', '12 часов (2:30 PM)'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.timeFormat || '24h') === id ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ timeFormat: id })}
        >${lbl}</button>`)}
      </div>

      <label class="field-label">Единицы измерения объёма файлов и памяти</label>
      <div class="chip-grid">
        ${[
          ['si', 'МБ / КБ (десятичные 1000)'],
          ['iec', 'МиБ / КиБ (двоичные 1024)'],
        ].map(([id, lbl]) => html`<button
          key=${id}
          type="button"
          class=${`choice-chip ${(settings.byteUnits || 'si') === id ? 'active' : ''}`}
          onClick=${() => updateClientSettings({ byteUnits: id })}
        >${lbl}</button>`)}
      </div>
    </div>
  </div>`;
}

// ─────────────────────── 11. Раздел «Обновления и диагностика» ───────────────────────

export function UpdatesDiagnosticsSectionView() {
  const { settings, update, android, meshStats } = store;
  const [runningDiag, setRunningDiag] = useState(false);

  const onRunDiag = async () => {
    setRunningDiag(true);
    await runMeshDiagnostics();
    setRunningDiag(false);
  };

  const diag = meshStats?.diagnostics;

  return html`<div class="settings-sub-stack">
    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="download" size=${16} /> Автообновление через GitHub Releases</h3>
      </div>

      <div class="kv-info-list">
        <div class="kv-info-row">
          <span>Текущая версия клиента</span>
          <code>v${APP_VERSION} (build ${APP_VERSION_CODE})</code>
        </div>
        <div class="kv-info-row">
          <span>Идентификатор пакета Android</span>
          <code>${android.packageName}</code>
        </div>
        <div class="kv-info-row">
          <span>Статус обновлений</span>
          <code>${update.available ? `Доступна v${update.remoteVersion}` : 'Установлена актуальная версия'}</code>
        </div>
      </div>

      <div class="settings-rows-list">
        <div class="settings-switch-row" onClick=${() => updateClientSettings({ autoUpdateCheck: settings.autoUpdateCheck === false })}>
          <div class="plugin-copy">
            <div class="plugin-title">Фоновая проверка новых релизов GitHub</div>
            <div class="plugin-sub">Автоматически отключается в строгих анонимных режимах Tor-Only и I2P-Only</div>
          </div>
          <button type="button" class=${`ios-switch ${settings.autoUpdateCheck !== false ? 'on' : ''}`}><span></span></button>
        </div>
      </div>

      <div class="studio-actions">
        <button
          type="button"
          class="btn-ghost compact"
          disabled=${update.checking}
          onClick=${() => checkForUpdates({ silent: false })}
        >
          <${Icon} name="refresh" size=${14} /> ${update.checking ? 'Проверка…' : 'Проверить релизы'}
        </button>
        <button type="button" class="btn-primary compact" onClick=${applyAppUpdate}>
          <${Icon} name="download" size=${14} /> ${update.available ? `Установить v${update.remoteVersion}` : 'Скачать актуальный APK'}
        </button>
      </div>
    </div>

    <div class="studio-card">
      <div class="studio-card-head">
        <h3><${Icon} name="activity" size=${16} /> Самопроверка криптоядра E2EE и транспорта</h3>
      </div>

      <p class="modal-desc">
        Проверяет изолированный CryptoWorker (AES-256-GCM + X3DH + Double Ratchet), целостность хранилища IndexedDB
        и замеряет реальный RTT до активного ретранслятора.
      </p>

      ${diag && html`<div class="kv-info-list">
        <div class="kv-info-row">
          <span>Ключи идентификации в CryptoWorker</span>
          <code>${diag.hasIdentity ? 'Активны (OK)' : 'Не загружены'}</code>
        </div>
        <div class="kv-info-row">
          <span>Контур AES-256-GCM Loopback</span>
          <code>${diag.loopbackOk ? `OK · ${diag.cryptoMs} мс` : 'Ошибка'}</code>
        </div>
        <div class="kv-info-row">
          <span>Транспорт и узел ретрансляции</span>
          <code>${diag.transport} · ${diag.serverOk ? 'Онлайн' : 'Автономно'}</code>
        </div>
      </div>`}

      ${meshStats.lastProbeText && html`<div class="probe-result-pill">${meshStats.lastProbeText}</div>`}

      <div class="studio-actions">
        <button type="button" class="btn-ghost compact" disabled=${runningDiag} onClick=${onRunDiag}>
          ${runningDiag ? 'Выполняется аудит…' : 'Запустить полную диагностику'}
        </button>
        <button type="button" class="btn-primary compact" onClick=${sendMeshTestPacket}>
          Отправить тест-пакет (${settings.paddingBlockBytes || 512} Б)
        </button>
      </div>
    </div>
  </div>`;
}
