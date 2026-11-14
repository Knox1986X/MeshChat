// Меню вложений по нажатию на скрепку в стиле Telegram:
//   1. Галерея (Фото / Видео прямо из приложения + встроенная живая камера фото/видео)
//   2. Файл (документы без сжатия; в «Избранном» — прямые Zero-Copy ссылки без создания копии)
//   3. Статья (встроенный редактор публикаций Telegraph-стиля + просмотрщик Instant View)

import { html, useState, useEffect, useRef } from '../../vendor/preact.mjs';
import {
  FAVORITES_CHAT_ID,
  sendSmartAttachment,
  addZeroCopyItemsToFavorites,
  sendArticleMessage,
  saveMessageToFavorites,
  showToast,
} from '../store/app-store.mjs';
import {
  hasAndroidGallerySupport,
  hasAndroidGalleryPermission,
  requestAndroidGalleryPermission,
  listRecentAndroidMedia,
  pickZeroCopyItems,
  resolveZeroCopyUrl,
  getCachedZeroCopyUrl,
} from '../store/local-ref-store.mjs';
import { Icon, formatBytes, formatTime } from './boss-screen.mjs';

/** Сжимает обложку статьи в пропорции 16:9 без геометрического растяжения */
function compressArticleCover(file, maxW = 960, maxH = 540, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Выберите изображение для обложки'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл обложки'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Повреждённое изображение'));
      img.onload = () => {
        const targetRatio = maxW / maxH;
        const srcRatio = img.width / img.height;
        let sx = 0;
        let sy = 0;
        let sw = img.width;
        let sh = img.height;
        if (srcRatio > targetRatio) {
          sw = Math.round(img.height * targetRatio);
          sx = Math.floor((img.width - sw) / 2);
        } else {
          sh = Math.round(img.width / targetRatio);
          sy = Math.floor((img.height - sh) / 2);
        }
        const canvas = document.createElement('canvas');
        canvas.width = maxW;
        canvas.height = maxH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, maxW, maxH);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function formatDurationMs(ms) {
  const totalSec = Math.max(1, Math.round((Number(ms) || 0) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/** Безопасный строчный парсер форматирования внутри абзацев статьи (0 XSS) */
function renderInlineTokens(line) {
  if (!line) return null;
  const parts = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      parts.push(html`<code key=${m.index} class="art-inline-code">${tok.slice(1, -1)}</code>`);
    } else if (tok.startsWith('**')) {
      parts.push(html`<strong key=${m.index}>${tok.slice(2, -2)}</strong>`);
    } else if (tok.startsWith('*')) {
      parts.push(html`<em key=${m.index}>${tok.slice(1, -1)}</em>`);
    }
    last = re.lastIndex;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

/** Безопасный блочный рендерер текста статьи (заголовки, цитаты, списки, блоки кода) */
export function ArticleBodyRenderer({ body = '' }) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(html`<pre key=${`code_${i}`} class="art-code-block"><code>${codeLines.join('\n')}</code></pre>`);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push(html`<hr key=${`hr_${i}`} class="art-divider" />`);
      i++;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      blocks.push(html`<h4 key=${`h3_${i}`} class="art-h3">${renderInlineTokens(trimmed.slice(4))}</h4>`);
      i++;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      blocks.push(html`<h3 key=${`h2_${i}`} class="art-h2">${renderInlineTokens(trimmed.slice(3))}</h3>`);
      i++;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push(
        html`<blockquote key=${`q_${i}`} class="art-quote">
          ${quoteLines.map((ql, qi) => html`<p key=${qi}>${renderInlineTokens(ql)}</p>`)}
        </blockquote>`
      );
      continue;
    }

    if (/^[-•]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-•]\s+/, ''));
        i++;
      }
      blocks.push(
        html`<ul key=${`ul_${i}`} class="art-list">
          ${items.map((li, idx) => html`<li key=${idx}>${renderInlineTokens(li)}</li>`)}
        </ul>`
      );
      continue;
    }

    blocks.push(html`<p key=${`p_${i}`} class="art-p">${renderInlineTokens(raw)}</p>`);
    i++;
  }

  return html`<div class="art-body-flow">${blocks}</div>`;
}

/** Карточка статьи внутри пузыря сообщения (Instant View превью) */
export function ArticleMessageCard({ msg, onOpenArticle }) {
  const art = msg?.article;
  const [zeroCoverUrl, setZeroCoverUrl] = useState(() =>
    art?.coverZeroCopyRef ? getCachedZeroCopyUrl(art.coverZeroCopyRef) : ''
  );

  useEffect(() => {
    let cancelled = false;
    if (art?.coverZeroCopyRef && !zeroCoverUrl) {
      resolveZeroCopyUrl(art.coverZeroCopyRef).then((u) => {
        if (!cancelled && u) setZeroCoverUrl(u);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [art?.coverZeroCopyRef]);

  if (!art) return null;
  const coverSrc = art.coverDataUrl || zeroCoverUrl || '';
  const excerpt = art.subtitle || String(art.body || '').replace(/[#>*`-]/g, '').trim().slice(0, 150);

  return html`<div class="article-bubble-card" onClick=${() => onOpenArticle && onOpenArticle(msg)}>
    ${coverSrc && html`<div class="article-card-cover-wrap">
      <img src=${coverSrc} alt="" class="article-card-cover-img" loading="lazy" />
    </div>`}
    <div class="article-card-body">
      <div class="article-card-kicker">
        <${Icon} name="article" size=${13} />
        <span>СТАТЬЯ · ${art.readingMinutes || 1} МИН ЧТЕНИЯ</span>
      </div>
      <div class="article-card-title">${art.title}</div>
      ${excerpt && html`<div class="article-card-excerpt">${excerpt}${excerpt.length >= 150 ? '…' : ''}</div>`}
      <div class="article-card-footer">
        <span class="article-card-author">${art.authorName || 'Автор'}</span>
        <button
          type="button"
          class="article-instant-btn"
          onClick=${(e) => {
            e.stopPropagation();
            if (onOpenArticle) onOpenArticle(msg);
          }}
        >
          <${Icon} name="bolt" size=${14} />
          <span>Читать статью</span>
        </button>
      </div>
    </div>
  </div>`;
}

/** Полноэкранное чтение статьи прямо внутри приложения (Instant View Reader) */
export function ArticleReaderModal({ msg, onClose }) {
  const art = msg?.article;
  const [zeroCoverUrl, setZeroCoverUrl] = useState(() =>
    art?.coverZeroCopyRef ? getCachedZeroCopyUrl(art.coverZeroCopyRef) : ''
  );

  useEffect(() => {
    let cancelled = false;
    if (art?.coverZeroCopyRef && !zeroCoverUrl) {
      resolveZeroCopyUrl(art.coverZeroCopyRef).then((u) => {
        if (!cancelled && u) setZeroCoverUrl(u);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [art?.coverZeroCopyRef]);

  if (!art) return null;
  const coverSrc = art.coverDataUrl || zeroCoverUrl || '';
  const canSaveToFav = msg.chatId !== FAVORITES_CHAT_ID;

  return html`<div class="modal-backdrop article-reader-backdrop" onClick=${onClose}>
    <article class="article-reader-sheet" onClick=${(e) => e.stopPropagation()}>
      <header class="article-reader-topbar">
        <button type="button" class="icon-btn" title="Закрыть статью" onClick=${onClose}>
          <${Icon} name="back" size=${20} />
        </button>
        <div class="article-reader-top-meta">
          <strong>Статья</strong>
          <span>${art.readingMinutes || 1} мин чтения · ${art.wordCount || 0} слов</span>
        </div>
        <div class="article-reader-actions">
          ${canSaveToFav && html`<button
            type="button"
            class="icon-btn"
            title="Сохранить статью в Избранное"
            onClick=${() => saveMessageToFavorites(msg.chatId, msg.id)}
          >
            <${Icon} name="bookmark" size=${17} />
          </button>`}
          <button
            type="button"
            class="icon-btn"
            title="Скопировать текст статьи"
            onClick=${async () => {
              await navigator.clipboard?.writeText?.(`${art.title}\n\n${art.body}`).catch(() => {});
              showToast('Текст статьи скопирован');
            }}
          >
            <${Icon} name="copy" size=${17} />
          </button>
        </div>
      </header>

      <div class="article-reader-scroll">
        ${coverSrc && html`<div class="article-reader-hero">
          <img src=${coverSrc} alt="" />
        </div>`}
        <div class="article-reader-content">
          <h1 class="article-reader-h1">${art.title}</h1>
          ${art.subtitle && html`<p class="article-reader-lead">${art.subtitle}</p>`}
          <div class="article-reader-byline">
            <span>${art.authorName || 'Автор'}</span>
            <span>·</span>
            <span>${formatTime(art.publishedAt || msg.ts)}</span>
          </div>
          <${ArticleBodyRenderer} body=${art.body} />
        </div>
      </div>
    </article>
  </div>`;
}

/** Встроенная в приложение камера (Фото + Видео со звуком) */
function InAppCameraModal({ onCaptured, onClose }) {
  const [camMode, setCamMode] = useState('photo'); // 'photo' | 'video'
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' | 'user'
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [previewItem, setPreviewItem] = useState(null); // { file, url, isVideo }
  const [caption, setCaption] = useState('');
  const [camError, setCamError] = useState('');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const fallbackInputRef = useRef(null);

  const stopStream = () => {
    clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (previewItem) return undefined;
    let active = true;

    const startCam = async () => {
      setCamError('');
      stopStream();
      try {
        globalThis.MeshChatAndroid?.ensureCameraPermission?.();
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Прямой видеопоток камеры недоступен в этом окружении');
        }
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: camMode === 'video',
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: camMode === 'video',
          });
        }
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play?.().catch(() => {});
        }
      } catch (err) {
        if (active) {
          setCamError(err?.message || 'Нет доступа к камере устройства');
        }
      }
    };

    startCam();
    return () => {
      active = false;
      stopStream();
    };
  }, [facingMode, camMode, Boolean(previewItem)]);

  useEffect(() => () => {
    stopStream();
    if (previewItem?.url) URL.revokeObjectURL(previewItem.url);
  }, []);

  const takePhoto = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const maxSide = 1440;
    const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
        const url = URL.createObjectURL(file);
        stopStream();
        setPreviewItem({ file, url, isVideo: false });
      },
      'image/jpeg',
      0.88
    );
  };

  const toggleVideoRecording = () => {
    if (recording) {
      clearInterval(timerRef.current);
      setRecording(false);
      try {
        recorderRef.current?.stop();
      } catch { /* ignore */ }
      return;
    }
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      showToast('Запись видео недоступна — выберите системную камеру', 'err');
      return;
    }
    const mime = MediaRecorder.isTypeSupported?.('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : MediaRecorder.isTypeSupported?.('video/mp4')
        ? 'video/mp4'
        : '';
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onstop = () => {
      const outMime = rec.mimeType || 'video/webm';
      const ext = outMime.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunksRef.current, { type: outMime });
      if (blob.size < 128) return;
      const file = new File([blob], `video_${Date.now()}.${ext}`, { type: outMime });
      const url = URL.createObjectURL(file);
      stopStream();
      setPreviewItem({ file, url, isVideo: true });
    };
    recorderRef.current = rec;
    setRecSec(0);
    setRecording(true);
    rec.start(250);
    timerRef.current = setInterval(() => setRecSec((s) => s + 1), 1000);
  };

  return html`<div class="camera-modal-overlay" onClick=${onClose}>
    <div class="camera-modal-box" onClick=${(e) => e.stopPropagation()}>
      <div class="camera-topbar">
        <button type="button" class="icon-btn" onClick=${onClose} title="Закрыть камеру">
          <${Icon} name="close" size=${19} />
        </button>
        <div class="camera-topbar-title">
          ${recording
            ? html`<span class="cam-rec-pill">● ${Math.floor(recSec / 60)}:${String(recSec % 60).padStart(2, '0')}</span>`
            : html`<span>Камера MeshChat</span>`}
        </div>
        ${!previewItem
          ? html`<button
              type="button"
              class="icon-btn"
              title="Переключить фронтальную / основную камеру"
              onClick=${() => setFacingMode((f) => (f === 'environment' ? 'user' : 'environment'))}
            >
              <${Icon} name="refresh" size=${18} />
            </button>`
          : html`<span style="width:36px"></span>`}
      </div>

      <div class="camera-stage">
        ${previewItem
          ? previewItem.isVideo
            ? html`<video src=${previewItem.url} controls playsInline class="camera-preview-el"></video>`
            : html`<img src=${previewItem.url} alt="" class="camera-preview-el" />`
          : camError
            ? html`<div class="camera-fallback-box">
                <${Icon} name="camera" size=${32} />
                <p>${camError}</p>
                <button
                  type="button"
                  class="btn btn-primary"
                  onClick=${() => fallbackInputRef.current?.click()}
                >Открыть системную камеру</button>
                <input
                  ref=${fallbackInputRef}
                  type="file"
                  accept=${camMode === 'video' ? 'video/*' : 'image/*'}
                  capture="environment"
                  hidden
                  onChange=${(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setPreviewItem({
                        file: f,
                        url: URL.createObjectURL(f),
                        isVideo: f.type.startsWith('video/'),
                      });
                    }
                  }}
                />
              </div>`
            : html`<video ref=${videoRef} autoplay playsInline muted class="camera-live-video"></video>`}
      </div>

      ${previewItem
        ? html`<div class="camera-confirm-bar">
            <input
              class="input"
              placeholder="Добавить подпись…"
              value=${caption}
              onInput=${(e) => setCaption(e.target.value)}
            />
            <div class="camera-confirm-btns">
              <button
                type="button"
                class="btn btn-ghost"
                onClick=${() => {
                  URL.revokeObjectURL(previewItem.url);
                  setPreviewItem(null);
                }}
              >Переснять</button>
              <button
                type="button"
                class="btn btn-primary"
                onClick=${() => onCaptured(previewItem.file, caption)}
              >Отправить</button>
            </div>
          </div>`
        : html`<div class="camera-controls-bar">
            <div class="camera-mode-switch">
              <button
                type="button"
                class=${camMode === 'photo' ? 'active' : ''}
                disabled=${recording}
                onClick=${() => setCamMode('photo')}
              >Фото</button>
              <button
                type="button"
                class=${camMode === 'video' ? 'active' : ''}
                disabled=${recording}
                onClick=${() => setCamMode('video')}
              >Видео</button>
            </div>
            <button
              type="button"
              class=${`camera-shutter-btn ${camMode === 'video' ? 'video' : ''} ${recording ? 'recording' : ''}`}
              disabled=${Boolean(camError)}
              onClick=${() => (camMode === 'photo' ? takePhoto() : toggleVideoRecording())}
              title=${camMode === 'photo' ? 'Сделать снимок' : recording ? 'Остановить запись' : 'Начать видеозапись'}
            >
              <span class="shutter-inner"></span>
            </button>
          </div>`}
    </div>
  </div>`;
}

/** Главное выдвижное меню скрепки в стиле Telegram (Галерея / Файл / Статья) */
export function AttachmentSheetModal({ chat, onClose }) {
  const isFavorites = chat?.kind === 'favorites';
  const [tab, setTab] = useState('gallery'); // 'gallery' | 'file' | 'article'
  const [cameraOpen, setCameraOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [onceFlag, setOnceFlag] = useState(false);
  const [busy, setBusy] = useState(false);

  // Состояние встроенной Android-галереи
  const androidSupported = hasAndroidGallerySupport();
  const [galleryPerm, setGalleryPerm] = useState(() => hasAndroidGalleryPermission());
  const [recentMedia, setRecentMedia] = useState(() =>
    hasAndroidGalleryPermission() ? listRecentAndroidMedia(30) : []
  );
  const [selectedUris, setSelectedUris] = useState([]);
  const [stagedFiles, setStagedFiles] = useState([]);

  // Состояние редактора статей
  const [artTitle, setArtTitle] = useState('');
  const [artSubtitle, setArtSubtitle] = useState('');
  const [artBody, setArtBody] = useState('');
  const [artCoverDataUrl, setArtCoverDataUrl] = useState('');
  const [artCoverZeroCopyRef, setArtCoverZeroCopyRef] = useState(null);
  const [artCoverPreview, setArtCoverPreview] = useState('');
  const [artPreviewMode, setArtPreviewMode] = useState(false);

  const mediaInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const coverInputRef = useRef(null);
  const artBodyRef = useRef(null);

  const toggleUriSelect = (uri) => {
    setSelectedUris((prev) =>
      prev.includes(uri) ? prev.filter((u) => u !== uri) : [...prev, uri]
    );
  };

  const insertArticleSyntax = (prefix, suffix = '') => {
    const el = artBodyRef.current;
    if (!el) {
      setArtBody((b) => `${b}${prefix}${suffix}`);
      return;
    }
    const start = el.selectionStart ?? artBody.length;
    const end = el.selectionEnd ?? artBody.length;
    const selected = artBody.slice(start, end) || 'текст';
    const next = `${artBody.slice(0, start)}${prefix}${selected}${suffix}${artBody.slice(end)}`;
    setArtBody(next);
  };

  const handleZeroCopyPick = async (mode) => {
    setBusy(true);
    try {
      const items = await pickZeroCopyItems(mode);
      if (items.length) {
        await addZeroCopyItemsToFavorites(items, { caption });
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSendSelectedGallery = async () => {
    if (!selectedUris.length && !stagedFiles.length) return;
    setBusy(true);
    try {
      const pickedAndroid = recentMedia.filter((m) => selectedUris.includes(m.uri));
      if (isFavorites && pickedAndroid.length) {
        await addZeroCopyItemsToFavorites(pickedAndroid, { caption });
      } else {
        for (let i = 0; i < pickedAndroid.length; i++) {
          await sendSmartAttachment(chat.id, pickedAndroid[i], {
            caption: i === 0 ? caption : '',
            once: onceFlag,
          });
        }
      }
      for (let j = 0; j < stagedFiles.length; j++) {
        await sendSmartAttachment(chat.id, stagedFiles[j], {
          caption: j === 0 && !pickedAndroid.length ? caption : '',
          once: onceFlag,
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handlePublishArticle = async () => {
    try {
      setBusy(true);
      await sendArticleMessage(chat.id, {
        title: artTitle,
        subtitle: artSubtitle,
        body: artBody,
        coverDataUrl: artCoverDataUrl,
        coverZeroCopyRef: artCoverZeroCopyRef,
      });
      onClose();
    } catch (err) {
      showToast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  if (cameraOpen) {
    return html`<${InAppCameraModal}
      onClose=${() => setCameraOpen(false)}
      onCaptured=${async (file, camCaption) => {
        setBusy(true);
        try {
          await sendSmartAttachment(chat.id, file, { caption: camCaption, once: onceFlag });
          onClose();
        } finally {
          setBusy(false);
        }
      }}
    />`;
  }

  const artWords = artBody.trim() ? artBody.trim().split(/\s+/).length : 0;
  const artMin = Math.max(1, Math.ceil(artWords / 180));
  const totalSelectedCount = selectedUris.length + stagedFiles.length;

  return html`<div class="modal-backdrop attach-sheet-backdrop" onClick=${onClose}>
    <div class="attach-sheet-card" onClick=${(e) => e.stopPropagation()}>
      <div class="attach-sheet-handle"></div>

      <div class="attach-sheet-header">
        <div class="attach-sheet-title-wrap">
          <strong>${tab === 'gallery' ? 'Фото и видео' : tab === 'file' ? 'Отправка файла' : 'Новая статья'}</strong>
          <span class=${isFavorites ? 'attach-sub-badge fav' : 'attach-sub-badge'}>
            ${isFavorites
              ? 'Избранное · файлы с телефона без копий (экономия места)'
              : `${chat.title} · шифрование AES-256-GCM`}
          </span>
        </div>
        <button type="button" class="icon-btn" onClick=${onClose} title="Закрыть">
          <${Icon} name="close" size=${18} />
        </button>
      </div>

      <div class="attach-sheet-body">
        ${tab === 'gallery' && html`<div class="attach-pane-gallery">
          <div class="attach-media-grid">
            <button
              type="button"
              class="attach-camera-tile"
              onClick=${() => setCameraOpen(true)}
            >
              <span class="attach-cam-icon"><${Icon} name="camera" size=${24} /></span>
              <strong>Камера</strong>
              <small>Фото / Видео</small>
            </button>

            ${isFavorites
              ? html`<button
                  type="button"
                  class="attach-picker-tile fav"
                  disabled=${busy}
                  onClick=${() => handleZeroCopyPick('media')}
                >
                  <span class="attach-cam-icon"><${Icon} name="link" size=${22} /></span>
                  <strong>Галерея</strong>
                  <small>Без копии (0 Б)</small>
                </button>`
              : html`<button
                  type="button"
                  class="attach-picker-tile"
                  disabled=${busy}
                  onClick=${() => mediaInputRef.current?.click()}
                >
                  <span class="attach-cam-icon"><${Icon} name="image" size=${22} /></span>
                  <strong>Галерея</strong>
                  <small>Фото и видео</small>
                </button>`}

            ${recentMedia.map((item) => {
              const selIdx = selectedUris.indexOf(item.uri);
              const isSel = selIdx >= 0;
              return html`<button
                key=${item.uri}
                type="button"
                class=${isSel ? 'attach-thumb-tile selected' : 'attach-thumb-tile'}
                onClick=${() => toggleUriSelect(item.uri)}
              >
                <img src=${item.thumbUrl || item.streamUrl} alt="" loading="lazy" />
                ${item.isVideo && html`<span class="attach-video-badge">
                  ▶ ${item.durationMs ? formatDurationMs(item.durationMs) : 'Видео'}
                </span>`}
                <span class=${isSel ? 'attach-check-circle on' : 'attach-check-circle'}>
                  ${isSel ? selIdx + 1 : ''}
                </span>
              </button>`;
            })}
          </div>

          ${androidSupported && !galleryPerm && html`<div class="attach-perm-banner">
            <div>
              <strong>Быстрая лента фото и видео прямо в меню</strong>
              <span>Разрешите чтение медиатеки для мгновенного предпросмотра снимков</span>
            </div>
            <button
              type="button"
              class="btn btn-ghost"
              onClick=${async () => {
                const ok = await requestAndroidGalleryPermission();
                setGalleryPerm(ok);
                if (ok) setRecentMedia(listRecentAndroidMedia(30));
              }}
            >Показать</button>
          </div>`}

          ${stagedFiles.length > 0 && html`<div class="attach-staged-list">
            ${stagedFiles.map((f, idx) => html`<div key=${idx} class="attach-staged-row">
              <${Icon} name=${f.type.startsWith('video/') ? 'video' : 'image'} size=${16} />
              <span class="attach-staged-name">${f.name}</span>
              <span class="attach-staged-size">${formatBytes(f.size)}</span>
              <button
                type="button"
                class="icon-btn"
                onClick=${() => setStagedFiles((arr) => arr.filter((_, i) => i !== idx))}
              ><${Icon} name="close" size=${14} /></button>
            </div>`)}
          </div>`}

          <input
            ref=${mediaInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange=${(e) => {
              const list = [...(e.target.files || [])];
              if (list.length) setStagedFiles((prev) => [...prev, ...list]);
              e.target.value = '';
            }}
          />

          <div class="attach-caption-block">
            <input
              class="input"
              placeholder="Подпись к изображению или видео…"
              value=${caption}
              onInput=${(e) => setCaption(e.target.value)}
            />
            ${!isFavorites && html`<label class="attach-once-row">
              <input
                type="checkbox"
                checked=${onceFlag}
                onChange=${(e) => setOnceFlag(e.target.checked)}
              />
              <span>Одноразовый просмотр (удалить с узла после открытия)</span>
            </label>`}
            ${totalSelectedCount > 0 && html`<button
              type="button"
              class="btn btn-primary btn-block"
              disabled=${busy}
              onClick=${handleSendSelectedGallery}
            >
              ${busy
                ? 'Обработка…'
                : isFavorites
                  ? `Добавить в Избранное без копии (${totalSelectedCount})`
                  : `Отправить выбранные (${totalSelectedCount})`}
            </button>`}
          </div>
        </div>`}

        ${tab === 'file' && html`<div class="attach-pane-file">
          <div class="attach-file-hero">
            <div class="attach-file-hero-icon">
              <${Icon} name=${isFavorites ? 'bookmark' : 'fileDoc'} size=${26} />
            </div>
            <div>
              <strong>${isFavorites ? 'Прямая ссылка на файл без создания копии' : 'Документ или медиа без сжатия'}</strong>
              <p>
                ${isFavorites
                  ? 'Файл остаётся в том месте телефона, откуда вы его добавили. MeshChat не дублирует его в свою память и открывает напрямую.'
                  : 'Любые PDF, архивы, APK, исходный код, фото и видео в оригинальном качестве под защитой AES-256-GCM.'}
              </p>
            </div>
          </div>

          <input
            class="input"
            placeholder="Комментарий к файлу (необязательно)…"
            value=${caption}
            onInput=${(e) => setCaption(e.target.value)}
          />

          ${isFavorites
            ? html`<button
                type="button"
                class="btn btn-primary btn-block"
                disabled=${busy}
                onClick=${() => handleZeroCopyPick('file')}
              >
                <${Icon} name="link" size=${16} />
                <span>Выбрать файл с телефона без копии</span>
              </button>`
            : html`<div class="attach-dm-file-zone">
                <input
                  ref=${fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange=${(e) => {
                    const list = [...(e.target.files || [])];
                    if (list.length) setStagedFiles((prev) => [...prev, ...list]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  class="btn btn-ghost btn-block"
                  onClick=${() => fileInputRef.current?.click()}
                >
                  <${Icon} name="upload" size=${16} />
                  <span>Выбрать файлы с устройства</span>
                </button>

                ${stagedFiles.length > 0 && html`<div class="attach-staged-list">
                  ${stagedFiles.map((f, idx) => html`<div key=${idx} class="attach-staged-row">
                    <${Icon} name="fileDoc" size=${16} />
                    <span class="attach-staged-name">${f.name}</span>
                    <span class="attach-staged-size">${formatBytes(f.size)}</span>
                    <button
                      type="button"
                      class="icon-btn"
                      onClick=${() => setStagedFiles((arr) => arr.filter((_, i) => i !== idx))}
                    ><${Icon} name="close" size=${14} /></button>
                  </div>`)}
                </div>`}

                <label class="attach-once-row">
                  <input
                    type="checkbox"
                    checked=${onceFlag}
                    onChange=${(e) => setOnceFlag(e.target.checked)}
                  />
                  <span>Одноразовый файл (сжечь на узле после скачивания)</span>
                </label>

                ${stagedFiles.length > 0 && html`<button
                  type="button"
                  class="btn btn-primary btn-block"
                  disabled=${busy}
                  onClick=${handleSendSelectedGallery}
                >${busy ? 'Шифрование…' : `Зашифровать и отправить (${stagedFiles.length})`}</button>`}
              </div>`}
        </div>`}

        ${tab === 'article' && html`<div class="attach-pane-article">
          <div class="article-cover-picker-row">
            ${artCoverPreview
              ? html`<div class="article-cover-thumb">
                  <img src=${artCoverPreview} alt="" />
                  <button
                    type="button"
                    class="article-cover-remove"
                    onClick=${() => {
                      setArtCoverDataUrl('');
                      setArtCoverZeroCopyRef(null);
                      setArtCoverPreview('');
                    }}
                  >Убрать обложку</button>
                </div>`
              : isFavorites
                ? html`<button
                    type="button"
                    class="btn btn-ghost btn-block"
                    onClick=${async () => {
                      const picked = await pickZeroCopyItems('image');
                      if (picked[0]) {
                        setArtCoverZeroCopyRef(picked[0]);
                        const u = await resolveZeroCopyUrl(picked[0]);
                        setArtCoverPreview(u);
                      }
                    }}
                  >
                    <${Icon} name="image" size=${16} />
                    <span>Обложка статьи с телефона (без копии)</span>
                  </button>`
                : html`<button
                    type="button"
                    class="btn btn-ghost btn-block"
                    onClick=${() => coverInputRef.current?.click()}
                  >
                    <${Icon} name="image" size=${16} />
                    <span>Добавить обложку статьи (необязательно)</span>
                  </button>`}
            <input
              ref=${coverInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange=${async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const dataUrl = await compressArticleCover(f);
                  setArtCoverDataUrl(dataUrl);
                  setArtCoverPreview(dataUrl);
                } catch (err) {
                  showToast(err.message, 'err');
                }
                e.target.value = '';
              }}
            />
          </div>

          <input
            class="input art-title-input"
            placeholder="Заголовок статьи…"
            maxLength=${180}
            value=${artTitle}
            onInput=${(e) => setArtTitle(e.target.value)}
          />
          <input
            class="input"
            placeholder="Подзаголовок или краткое вступление…"
            maxLength=${280}
            value=${artSubtitle}
            onInput=${(e) => setArtSubtitle(e.target.value)}
          />

          <div class="art-format-toolbar">
            <button type="button" class="art-fmt-btn" onClick=${() => insertArticleSyntax('\n## ', '\n')}>H2</button>
            <button type="button" class="art-fmt-btn" onClick=${() => insertArticleSyntax('**', '**')}>Жирный</button>
            <button type="button" class="art-fmt-btn" onClick=${() => insertArticleSyntax('*', '*')}>Курсив</button>
            <button type="button" class="art-fmt-btn" onClick=${() => insertArticleSyntax('\n> ', '\n')}>Цитата</button>
            <button type="button" class="art-fmt-btn" onClick=${() => insertArticleSyntax('\n```\n', '\n```\n')}>Код</button>
            <button type="button" class="art-fmt-btn" onClick=${() => insertArticleSyntax('\n- ', '')}>Список</button>
            <button
              type="button"
              class=${artPreviewMode ? 'art-fmt-btn active' : 'art-fmt-btn'}
              onClick=${() => setArtPreviewMode((v) => !v)}
            >${artPreviewMode ? 'Редактор' : 'Предпросмотр'}</button>
          </div>

          ${artPreviewMode
            ? html`<div class="art-live-preview-box">
                <h3>${artTitle || 'Без заголовка'}</h3>
                ${artSubtitle && html`<p class="article-reader-lead">${artSubtitle}</p>`}
                <${ArticleBodyRenderer} body=${artBody || 'Текст статьи пока пуст…'} />
              </div>`
            : html`<textarea
                ref=${artBodyRef}
                class="input art-body-textarea"
                rows=${6}
                placeholder="Напишите статью… Поддерживаются подзаголовки (##), списки (-), цитаты (>), **жирный** текст и блоки кода."
                value=${artBody}
                onInput=${(e) => setArtBody(e.target.value)}
              ></textarea>`}

          <div class="art-editor-footer">
            <span>Слов: ${artWords} · ~${artMin} мин чтения</span>
            <button
              type="button"
              class="btn btn-primary"
              disabled=${busy || !artTitle.trim() || !artBody.trim()}
              onClick=${handlePublishArticle}
            >
              <${Icon} name="send" size=${15} />
              <span>${isFavorites ? 'В Избранное' : 'Опубликовать'}</span>
            </button>
          </div>
        </div>`}
      </div>

      <nav class="attach-bottom-tabs" role="tablist">
        <button
          type="button"
          class=${tab === 'gallery' ? 'attach-tab-btn active' : 'attach-tab-btn'}
          onClick=${() => setTab('gallery')}
        >
          <${Icon} name="image" size=${18} />
          <span>Галерея</span>
        </button>
        <button
          type="button"
          class=${tab === 'file' ? 'attach-tab-btn active' : 'attach-tab-btn'}
          onClick=${() => setTab('file')}
        >
          <${Icon} name="fileDoc" size=${18} />
          <span>Файл</span>
        </button>
        <button
          type="button"
          class=${tab === 'article' ? 'attach-tab-btn active' : 'attach-tab-btn'}
          onClick=${() => setTab('article')}
        >
          <${Icon} name="article" size=${18} />
          <span>Статья</span>
        </button>
      </nav>
    </div>
  </div>`;
}
