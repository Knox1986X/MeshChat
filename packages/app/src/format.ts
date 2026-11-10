export function clock(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function dayLabel(ts: number, lang: 'ru' | 'en', t: (k: string) => string): string {
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return t('chat.today');
  if (same(date, yesterday)) return t('chat.yesterday');
  return date.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: '2-digit', month: 'short' });
}

export function shortClock(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return clock(ts);
  return new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function ttlLabel(ms: number | undefined, t: (k: string) => string): string {
  if (!ms) return t('chat.ttlOff');
  if (ms >= 7 * 86400_000) return t('chat.ttl7d');
  if (ms >= 86400_000) return t('chat.ttl1d');
  return t('chat.ttl1h');
}

export const TTL_OPTIONS = [0, 3600_000, 86400_000, 7 * 86400_000];

export function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return '?';
  return clean.slice(0, 2).toUpperCase();
}

export function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
