'use client';
import { ApiError, refreshSession } from './api';

export interface FileInfo {
  id: string; name: string; mime: string; size: number; width?: number | null; height?: number | null; createdAt?: string; uploaderId?: string;
}
export type UploadContext = 'TASK' | 'COMMENT' | 'CHANNEL' | 'REPORT' | 'ANNOUNCEMENT';

export const MAX_FILES = 10;
export const MAX_MB = 100;

export const fileUrl = (id: string, inline = false) => `/backend/files/${id}${inline ? '?inline=1' : ''}`;

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
  return `${(n / 1073741824).toFixed(1)} GB`;
}

const RISKY = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'jar', 'apk', 'sh', 'dll', 'lnk', 'iso']);
export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
export const isRisky = (name: string) => RISKY.has(extOf(name));
export const isImage = (f: Pick<FileInfo, 'mime'>) => /^image\/(png|jpe?g|gif|webp)$/.test(f.mime);
export const canPreview = (f: Pick<FileInfo, 'mime'>) => isImage(f) || /^(application\/pdf|video\/(mp4|webm)|audio\/(mpeg|ogg|wav|mp4)|text\/plain)$/.test(f.mime);

export function fileEmoji(f: Pick<FileInfo, 'mime' | 'name'>): string {
  const e = extOf(f.name);
  if (f.mime.startsWith('image/')) return '🖼️';
  if (f.mime.startsWith('video/')) return '🎬';
  if (f.mime.startsWith('audio/')) return '🎧';
  if (f.mime === 'application/pdf') return '📕';
  if (['doc', 'docx', 'odt', 'rtf'].includes(e)) return '📘';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(e)) return '📗';
  if (['ppt', 'pptx', 'odp'].includes(e)) return '📙';
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(e)) return '🗜️';
  if (['js', 'ts', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json', 'sql', 'sh'].includes(e)) return '💻';
  if (['txt', 'md'].includes(e)) return '📝';
  return '📄';
}

/**
 * Shrinks big photos in the browser before upload (phone photos are often 5-12 MB). The chat and task pages then
 * load fast for everyone, and the upload finishes in a second. GIFs, tiny images and non-images pass through untouched.
 * Also reads width/height so the page can reserve the right space and never "jump" while images load.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; name: string; w?: number; h?: number }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file, name: file.name };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const { width: w, height: h } = bmp;
    const MAX = 2000;
    if (file.size <= 1_200_000 && w <= MAX && h <= MAX) { bmp.close?.(); return { blob: file, name: file.name, w, h }; }
    const scale = Math.min(1, MAX / Math.max(w, h));
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(bmp, 0, 0, cw, ch);
    bmp.close?.();
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return { blob: file, name: file.name, w, h };
    return { blob, name: file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', w: cw, h: ch };
  } catch {
    return { blob: file, name: file.name }; // HEIC etc.: upload as is
  }
}

/** Square-crops and resizes a profile photo to 384×384 JPEG. Re-encoding also removes camera EXIF data such as GPS location. */
export async function prepareAvatar(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions).catch(() => null);
  if (!bmp) throw new ApiError(400, 'That image format is not supported. Please choose a JPG, PNG or WebP photo.');
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 384;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 384, 384);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 384, 384);
  bmp.close?.();
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
  if (!blob) throw new ApiError(400, 'Could not process that image');
  return blob;
}

function xhrPost(url: string, method: string, body: Blob, onProgress?: (pct: number) => void, signal?: AbortSignal) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed: connection lost. Check your internet and try again.'));
    xhr.ontimeout = () => reject(new ApiError(0, 'Upload timed out. Try again on a better connection.'));
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
}

async function send(url: string, method: string, body: Blob, onProgress?: (n: number) => void, signal?: AbortSignal) {
  let r = await xhrPost(url, method, body, onProgress, signal);
  if (r.status === 401 && (await refreshSession())) r = await xhrPost(url, method, body, onProgress, signal);
  let data: any = null;
  try { data = r.text ? JSON.parse(r.text) : null; } catch { /* html error page */ }
  if (r.status < 200 || r.status >= 300) {
    const msg = r.status === 413 ? `That file is too large (limit ${MAX_MB} MB).` : r.status === 429 ? 'Too many uploads. Wait a moment and try again.'
      : Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? `Upload failed (${r.status})`;
    throw new ApiError(r.status, msg);
  }
  return data;
}

export async function uploadFile(
  blob: Blob,
  o: { name: string; context: UploadContext; scopeId?: string; w?: number; h?: number; onProgress?: (pct: number) => void; signal?: AbortSignal },
): Promise<FileInfo> {
  const qs = new URLSearchParams({ context: o.context, name: o.name });
  if (o.scopeId) qs.set('scopeId', o.scopeId);
  if (o.w) qs.set('w', String(o.w));
  if (o.h) qs.set('h', String(o.h));
  return send(`/backend/files?${qs}`, 'POST', blob, o.onProgress, o.signal);
}

export async function uploadAvatar(file: File): Promise<void> {
  const blob = await prepareAvatar(file);
  await send('/backend/avatars/me', 'PUT', blob);
}
