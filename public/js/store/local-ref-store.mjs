// Хранилище прямых ссылок Zero-Copy для локального «Избранного» и встроенной медиагалереи.
// На Android использует постоянные URI content:// (FLAG_GRANT_PERSISTABLE_URI_PERMISSION + ContentResolver)
// и потоковую раздачу /local-ref без копирования фото, видео и файлов во внутреннюю память приложения.
// В браузерах с File System Access API сохраняет только дескриптор FileSystemFileHandle (0 байт дублирования).

import { utf8ToBytes, toBase64Url, randomBytes } from '../../../shared/crypto/primitives.mjs';

const HANDLE_DB_NAME = 'meshchat_zero_copy_v1';
const HANDLE_STORE = 'handles';
const runtimeUrlCache = new Map();

function openHandleIdb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(HANDLE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE)) {
          db.createObjectStore(HANDLE_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveZeroCopyHandle(handleId, handleOrBlob) {
  const db = await openHandleIdb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(handleOrBlob, handleId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function loadZeroCopyHandle(handleId) {
  const db = await openHandleIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const req = tx.objectStore(HANDLE_STORE).get(handleId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Формирует потоковый URL к исходному файлу на телефоне Android без создания копии */
export function buildAndroidLocalRefUrl(contentUri, { thumb = false, mime = '' } = {}) {
  if (!contentUri || !globalThis.MeshChatAndroid?.getLocalRefBaseUrl) return '';
  const base = globalThis.MeshChatAndroid.getLocalRefBaseUrl();
  if (!base) return '';
  const uriB64 = toBase64Url(utf8ToBytes(String(contentUri)));
  let url = `${base}&uri=${encodeURIComponent(uriB64)}`;
  if (thumb) url += '&thumb=1';
  if (mime) url += `&mime=${encodeURIComponent(mime)}`;
  return url;
}

/** Проверяет доступность встроенной медиагалереи Android */
export function hasAndroidGallerySupport() {
  return Boolean(globalThis.MeshChatAndroid?.listRecentDeviceMediaJson);
}

export function hasAndroidGalleryPermission() {
  try {
    return Boolean(globalThis.MeshChatAndroid?.hasMediaGalleryPermission?.());
  } catch {
    return false;
  }
}

export async function requestAndroidGalleryPermission() {
  if (!globalThis.MeshChatAndroid?.ensureMediaGalleryPermission) return false;
  if (hasAndroidGalleryPermission()) return true;
  return new Promise((resolve) => {
    let done = false;
    const finish = (ev) => {
      if (done) return;
      done = true;
      globalThis.window?.removeEventListener?.('meshchat:gallery-perm', finish);
      resolve(Boolean(ev?.detail?.granted ?? hasAndroidGalleryPermission()));
    };
    globalThis.window?.addEventListener?.('meshchat:gallery-perm', finish, { once: true });
    globalThis.MeshChatAndroid.ensureMediaGalleryPermission();
    const t = setTimeout(() => finish({ detail: { granted: hasAndroidGalleryPermission() } }), 12000);
    t.unref?.();
  });
}

/** Возвращает список недавних фото и видео с телефона без чтения самих файлов */
export function listRecentAndroidMedia(limit = 30) {
  if (!globalThis.MeshChatAndroid?.listRecentDeviceMediaJson) return [];
  try {
    const raw = globalThis.MeshChatAndroid.listRecentDeviceMediaJson(limit);
    const arr = JSON.parse(raw || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.map((it) => ({
      uri: it.uri,
      name: it.name || (it.isVideo ? 'video.mp4' : 'photo.jpg'),
      mime: it.mime || (it.isVideo ? 'video/mp4' : 'image/jpeg'),
      size: Number(it.size) || 0,
      durationMs: Number(it.durationMs) || 0,
      isVideo: Boolean(it.isVideo || String(it.mime || '').startsWith('video/')),
      thumbUrl: buildAndroidLocalRefUrl(it.uri, { thumb: true, mime: it.mime }),
      streamUrl: buildAndroidLocalRefUrl(it.uri, { thumb: false, mime: it.mime }),
    }));
  } catch {
    return [];
  }
}

/** Преобразует элемент галереи Android в объект File (только для отправки собеседнику по E2EE) */
export async function readAndroidUriAsFile(item) {
  const url = buildAndroidLocalRefUrl(item.uri, { thumb: false, mime: item.mime });
  if (!url) throw new Error('Не удалось открыть локальный ресурс устройства');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Исходный файл на устройстве недоступен');
  const blob = await res.blob();
  return new File([blob], item.name || 'attachment', {
    type: item.mime || blob.type || 'application/octet-stream',
  });
}

/**
 * Выбирает файлы/фото/видео для локального «Избранного» БЕЗ создания копии (Zero-Copy),
 * сохраняя только постоянную ссылку на то место на устройстве, откуда файл был выбран.
 * @param {'media'|'image'|'file'} mode
 */
export async function pickZeroCopyItems(mode = 'file') {
  // 1. Android APK: нативный системный выбор с FLAG_GRANT_PERSISTABLE_URI_PERMISSION (0 байт копирования!)
  if (globalThis.MeshChatAndroid?.pickZeroCopyLocalFiles) {
    return new Promise((resolve) => {
      let settled = false;
      const onPicked = (ev) => {
        if (settled) return;
        settled = true;
        globalThis.window?.removeEventListener?.('meshchat:zero-copy-picked', onPicked);
        const list = Array.isArray(ev?.detail) ? ev.detail : [];
        resolve(
          list
            .filter((x) => x && x.uri)
            .map((x) => ({
              zeroCopy: true,
              refKind: 'android-uri',
              localRefUri: x.uri,
              name: x.name || 'file',
              mime: x.mime || 'application/octet-stream',
              size: Number(x.size) || 0,
            }))
        );
      };
      globalThis.window?.addEventListener?.('meshchat:zero-copy-picked', onPicked, { once: true });
      globalThis.MeshChatAndroid.pickZeroCopyLocalFiles(mode);
    });
  }

  // 2. Браузеры с File System Access API: сохраняем только FileSystemFileHandle (0 байт копирования!)
  if (typeof globalThis.showOpenFilePicker === 'function') {
    try {
      const pickerOpts = { multiple: true };
      if (mode === 'media') {
        pickerOpts.types = [
          {
            description: 'Изображения и видео',
            accept: {
              'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'],
              'video/*': ['.mp4', '.webm', '.mov', '.mkv'],
            },
          },
        ];
      } else if (mode === 'image') {
        pickerOpts.types = [
          {
            description: 'Изображения',
            accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'] },
          },
        ];
      }
      const handles = await globalThis.showOpenFilePicker(pickerOpts);
      const out = [];
      for (const h of handles) {
        const file = await h.getFile();
        const fsHandleId = `fsh_${toBase64Url(randomBytes(9))}`;
        await saveZeroCopyHandle(fsHandleId, h);
        const objUrl = URL.createObjectURL(file);
        runtimeUrlCache.set(fsHandleId, objUrl);
        out.push({
          zeroCopy: true,
          refKind: 'fs-handle',
          fsHandleId,
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
        });
      }
      return out;
    } catch (err) {
      if (err?.name === 'AbortError') return [];
    }
  }

  // 3. Запасной вариант для сред без прямого файлового дескриптора
  if (typeof document !== 'undefined') {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = mode !== 'image';
      if (mode === 'media') inp.accept = 'image/*,video/*';
      else if (mode === 'image') inp.accept = 'image/*';
      inp.onchange = async () => {
        const files = [...(inp.files || [])];
        const out = [];
        for (const f of files) {
          const blobRefId = `fblob_${toBase64Url(randomBytes(9))}`;
          await saveZeroCopyHandle(blobRefId, f);
          runtimeUrlCache.set(blobRefId, URL.createObjectURL(f));
          out.push({
            zeroCopy: true,
            refKind: 'local-blob',
            fsHandleId: blobRefId,
            name: f.name,
            mime: f.type || 'application/octet-stream',
            size: f.size,
          });
        }
        resolve(out);
      };
      inp.click();
    });
  }
  return [];
}

/** Сохраняет новый снимок или видеозапись со встроенной камеры приложения только локально */
export async function saveLocalCapturedBlob(file) {
  const blobRefId = `cam_${toBase64Url(randomBytes(9))}`;
  await saveZeroCopyHandle(blobRefId, file);
  runtimeUrlCache.set(blobRefId, URL.createObjectURL(file));
  return {
    zeroCopy: false,
    localOnly: true,
    refKind: 'local-blob',
    fsHandleId: blobRefId,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
  };
}

/** Синхронно или асинхронно разрешает URL воспроизведения/просмотра для элемента «Избранного» */
export function getCachedZeroCopyUrl(mediaObj) {
  if (!mediaObj) return '';
  if (mediaObj.refKind === 'android-uri' && mediaObj.localRefUri) {
    return buildAndroidLocalRefUrl(mediaObj.localRefUri, { thumb: false, mime: mediaObj.mime });
  }
  if (mediaObj.fsHandleId && runtimeUrlCache.has(mediaObj.fsHandleId)) {
    return runtimeUrlCache.get(mediaObj.fsHandleId);
  }
  return '';
}

export async function resolveZeroCopyUrl(mediaObj) {
  const syncUrl = getCachedZeroCopyUrl(mediaObj);
  if (syncUrl) return syncUrl;
  if (!mediaObj?.fsHandleId) return '';

  const stored = await loadZeroCopyHandle(mediaObj.fsHandleId);
  if (!stored) return '';

  try {
    if (typeof stored.getFile === 'function') {
      if (typeof stored.queryPermission === 'function') {
        let perm = await stored.queryPermission({ mode: 'read' });
        if (perm !== 'granted' && typeof stored.requestPermission === 'function') {
          perm = await stored.requestPermission({ mode: 'read' });
        }
        if (perm !== 'granted') return '';
      }
      const file = await stored.getFile();
      const url = URL.createObjectURL(file);
      runtimeUrlCache.set(mediaObj.fsHandleId, url);
      return url;
    }
    if (stored instanceof Blob) {
      const url = URL.createObjectURL(stored);
      runtimeUrlCache.set(mediaObj.fsHandleId, url);
      return url;
    }
  } catch {
    return '';
  }
  return '';
}

/** Открывает локальный файл из «Избранного» напрямую в системном просмотрщике или скачивает */
export async function openZeroCopyFile(mediaObj) {
  if (!mediaObj) return false;
  if (mediaObj.refKind === 'android-uri' && mediaObj.localRefUri && globalThis.MeshChatAndroid?.openLocalUriExternally) {
    const ok = globalThis.MeshChatAndroid.openLocalUriExternally(mediaObj.localRefUri, mediaObj.mime || '');
    if (ok) return true;
  }
  const url = await resolveZeroCopyUrl(mediaObj);
  if (!url) return false;
  if (typeof document !== 'undefined') {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.download = mediaObj.name || 'file';
    a.click();
    return true;
  }
  return false;
}
