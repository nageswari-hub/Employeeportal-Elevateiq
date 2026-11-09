'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { canPreview, FileInfo, fileEmoji, fileUrl, fmtSize, isImage, isRisky, MAX_FILES, MAX_MB, prepareImage, UploadContext, uploadFile } from '../lib/files';

export interface UploadItem {
  key: string; name: string; size: number; pct: number; status: 'uploading' | 'done' | 'error'; error?: string; file?: FileInfo; src?: Blob; ctrl?: AbortController; preview?: string;
}

/**
 * Upload manager shared by chat, comments, reports and announcements.
 * Up to 3 uploads run in parallel, each with progress and cancel; failed ones can be retried without losing the rest.
 */
export function useUploads(context: UploadContext, scopeId?: string) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;
  const patch = useCallback((key: string, p: Partial<UploadItem>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i))), []);

  const run = useCallback(async (key: string, raw: File | Blob, name: string, dims: { w?: number; h?: number }) => {
    const ctrl = new AbortController();
    patch(key, { status: 'uploading', pct: 0, error: undefined, ctrl });
    try {
      const f = await uploadFile(raw, { name, context, scopeId, w: dims.w, h: dims.h, signal: ctrl.signal, onProgress: (pct) => patch(key, { pct }) });
      patch(key, { status: 'done', pct: 100, file: f, src: undefined });
    } catch (e) {
      patch(key, { status: 'error', error: e instanceof ApiError ? e.message : 'Upload failed', ctrl: undefined });
    }
  }, [context, scopeId, patch]);

  const add = useCallback(async (list: FileList | File[]) => {
    const files = Array.from(list);
    const room = MAX_FILES - itemsRef.current.length;
    const take = files.slice(0, Math.max(0, room));
    for (const f of take) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (f.size > MAX_MB * 1048576) {
        setItems((c) => [...c, { key, name: f.name, size: f.size, pct: 0, status: 'error', error: `Larger than ${MAX_MB} MB` }]);
        continue;
      }
      const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
      setItems((c) => [...c, { key, name: f.name, size: f.size, pct: 0, status: 'uploading', preview }]);
      void prepareImage(f).then((p) => {
        setItems((c) => c.map((i) => (i.key === key ? { ...i, src: p.blob, size: p.blob.size, name: p.name } : i)));
        return run(key, p.blob, p.name, { w: p.w, h: p.h });
      });
    }
    return files.length > take.length ? `Only ${MAX_FILES} files can be attached at once.` : null;
  }, [run]);

  const retry = useCallback((key: string) => {
    const it = itemsRef.current.find((i) => i.key === key);
    if (it?.src) void run(key, it.src, it.name, {});
  }, [run]);

  const remove = useCallback((key: string) => {
    const it = itemsRef.current.find((i) => i.key === key);
    it?.ctrl?.abort();
    if (it?.preview) URL.revokeObjectURL(it.preview);
    setItems((c) => c.filter((i) => i.key !== key));
  }, []);

  const reset = useCallback(() => {
    itemsRef.current.forEach((i) => { i.ctrl?.abort(); if (i.preview) URL.revokeObjectURL(i.preview); });
    setItems([]);
  }, []);

  useEffect(() => () => itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);

  return {
    items, add, retry, remove, reset,
    busy: items.some((i) => i.status === 'uploading'),
    hasError: items.some((i) => i.status === 'error'),
    fileIds: items.filter((i) => i.status === 'done' && i.file).map((i) => i.file!.id),
    done: items.filter((i) => i.status === 'done' && i.file).map((i) => i.file!),
  };
}

export function PaperclipIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 115.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5" />
    </svg>
  );
}

/** Button that opens the file picker (any file type, multiple). */
export function AttachButton({ onFiles, disabled, label = 'Attach files' }: { onFiles: (f: FileList) => void; disabled?: boolean; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ''; }} />
      <button type="button" className="btn-ghost !px-2.5" onClick={() => ref.current?.click()} disabled={disabled} aria-label={label} title={label}>
        <PaperclipIcon />
      </button>
    </>
  );
}

/** Progress chips for files being uploaded (and ones ready to send). */
export function UploadChips({ items, onRemove, onRetry }: { items: UploadItem[]; onRemove: (k: string) => void; onRetry: (k: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Files to send">
      {items.map((i) => (
        <li key={i.key} className={`relative flex max-w-[16rem] items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-1.5 text-xs ${i.status === 'error' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
          {i.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={i.preview} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
          ) : <span className="text-lg">{fileEmoji({ mime: '', name: i.name })}</span>}
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink-900">{i.name}</span>
            <span className={i.status === 'error' ? 'text-red-600' : 'text-slate-500'}>
              {i.status === 'uploading' ? `Uploading ${i.pct}%` : i.status === 'error' ? i.error : fmtSize(i.size)}
            </span>
          </span>
          {i.status === 'error' && i.src && <button type="button" className="font-semibold text-accent-600" onClick={() => onRetry(i.key)}>Retry</button>}
          <button type="button" className="ml-auto text-slate-400 hover:text-red-600" onClick={() => onRemove(i.key)} aria-label={`Remove ${i.name}`}>✕</button>
          {i.status === 'uploading' && <span className="absolute bottom-0 left-0 h-0.5 bg-accent-600 transition-all" style={{ width: `${i.pct}%` }} />}
        </li>
      ))}
    </ul>
  );
}

/** Drag & drop + paste (screenshots!) support. Wrap a composer; `onFiles` receives anything dropped or pasted. */
export function useDropPaste(onFiles: (f: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  return {
    dragging,
    bind: {
      onDragEnter: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { depth.current++; setDragging(true); } },
      onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
      onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); },
      onDrop: (e: React.DragEvent) => { e.preventDefault(); depth.current = 0; setDragging(false); if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files)); },
      onPaste: (e: React.ClipboardEvent) => {
        const fs = Array.from(e.clipboardData.files);
        if (fs.length) { e.preventDefault(); onFiles(fs); }
      },
    },
  };
}

/** Read-only list of files attached to something. Images show as stable-size thumbnails; others as compact cards. */
export function AttachmentList({ files, onDelete, compact }: { files: FileInfo[] | undefined; onDelete?: (f: FileInfo) => void; compact?: boolean }) {
  const [lightbox, setLightbox] = useState<FileInfo | null>(null);
  useEffect(() => {
    if (!lightbox) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setLightbox(null);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [lightbox]);
  if (!files?.length) return null;
  const images = files.filter(isImage);
  const others = files.filter((f) => !isImage(f));
  return (
    <div className={compact ? 'mt-1.5 space-y-1.5' : 'mt-2 space-y-2'}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((f) => {
            const w = f.width && f.height ? Math.min(f.width, compact ? 260 : 320) : 240;
            const ratio = f.width && f.height ? f.width / f.height : 4 / 3;
            return (
              <div key={f.id} className="group relative">
                <button type="button" onClick={() => setLightbox(f)} className="block overflow-hidden rounded-xl border border-slate-200 bg-slate-100" style={{ width: w, aspectRatio: String(ratio), maxWidth: '100%' }} aria-label={`Open ${f.name}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(f.id, true)} alt={f.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                </button>
                {onDelete && <button type="button" className="absolute right-1 top-1 hidden rounded-full bg-black/60 px-2 py-0.5 text-xs text-white group-hover:block" onClick={() => onDelete(f)} aria-label={`Remove ${f.name}`}>✕</button>}
              </div>
            );
          })}
        </div>
      )}
      {others.map((f) => (
        <div key={f.id} className="flex max-w-md items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <span className="text-2xl" aria-hidden="true">{fileEmoji(f)}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink-900" title={f.name}>{f.name}</p>
            <p className="text-xs text-slate-500">{fmtSize(f.size)}{isRisky(f.name) && <span className="ml-2 font-semibold text-amber-600" title="Program files can be harmful. Only open them if you trust the sender.">⚠ program file</span>}</p>
          </div>
          {canPreview(f) && <a href={fileUrl(f.id, true)} target="_blank" rel="noopener noreferrer" className="btn-ghost !px-2 !py-1 text-xs">Open</a>}
          <a href={fileUrl(f.id)} className="btn-secondary !px-3 !py-1 text-xs" download={f.name}>Download</a>
          {onDelete && <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => onDelete(f)} aria-label={`Remove ${f.name}`}>✕</button>}
        </div>
      ))}
      {lightbox && (
        <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/85 p-4" onClick={() => setLightbox(null)} role="dialog" aria-modal="true" aria-label={lightbox.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileUrl(lightbox.id, true)} alt={lightbox.name} className="max-h-[85vh] max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          <div className="mt-3 flex items-center gap-3 text-sm text-white" onClick={(e) => e.stopPropagation()}>
            <span className="max-w-[60vw] truncate">{lightbox.name}</span>
            <a className="rounded-lg bg-white/15 px-3 py-1 hover:bg-white/25" href={fileUrl(lightbox.id)} download={lightbox.name}>Download</a>
            <button className="rounded-lg bg-white/15 px-3 py-1 hover:bg-white/25" onClick={() => setLightbox(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
