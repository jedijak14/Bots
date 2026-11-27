/** Keep each base64 request comfortably below Vercel's 4.5 MB body limit. */
export const MEDIA_CHUNK_BYTES = 768 * 1024; // divisible by three, so chunks concatenate as base64
export const MEDIA_LIMITS = { audio: 24 * 1024 * 1024, image: 3 * 1024 * 1024, video: 32 * 1024 * 1024 } as const;
const TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};
const ALIASES: Record<string, string> = { 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/x-m4a': 'audio/mp4' };
export function mediaType(kind: 'audio' | 'image' | 'video', name: string, browserType: string): string | null {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  const fallback = TYPES[extension];
  const normalized = ALIASES[browserType.toLowerCase()] ?? browserType.toLowerCase();
  // Browsers and file pickers often return an empty or generic MIME type.
  const type = !normalized || normalized === 'application/octet-stream' ? fallback : normalized;
  return type && Object.values(TYPES).includes(type) && type.startsWith(`${kind}/`) ? type : null;
}
export function validMediaChunk(base64: string, index: number, totalBytes: number): boolean {
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(totalBytes) || totalBytes <= 0) return false;
  const count = Math.ceil(totalBytes / MEDIA_CHUNK_BYTES);
  if (index >= count) return false;
  const bytes = Math.min(MEDIA_CHUNK_BYTES, totalBytes - index * MEDIA_CHUNK_BYTES);
  const padding = (3 - bytes % 3) % 3;
  return base64.length === 4 * Math.ceil(bytes / 3) && /^[A-Za-z0-9+/]*={0,2}$/.test(base64) && (padding === 0 ? !base64.endsWith('=') : base64.endsWith('='.repeat(padding)) && !base64.endsWith('='.repeat(padding + 1)));
}

/** Limit responses as well as requests to fit serverless payload limits. */
export function mediaRange(header: string | null, length: number): { start: number; end: number; partial: boolean } | null {
  if (!Number.isSafeInteger(length) || length < 1) return null;
  const cap = 3 * 1024 * 1024;
  if (!header) return { start: 0, end: Math.min(length - 1, cap - 1), partial: length > cap };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number, end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return null; start = Math.max(0, length - suffix); end = length - 1; }
  else { start = Number(match[1]); end = match[2] ? Number(match[2]) : length - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= length || start > end) return null;
  return { start, end: Math.min(end, length - 1, start + cap - 1), partial: true };
}
