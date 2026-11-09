// Same-origin client: all calls go to /backend/* (Next rewrite -> NestJS).
// Cookies (httpOnly) are sent automatically. Never store tokens in JS.
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function performRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/backend/auth/refresh', { method: 'POST', credentials: 'include' });
    return res.ok;
  } catch {
    return false;
  }
}

// One refresh at a time: if 10 requests hit an expired access token together, they share a single /auth/refresh call.
// The Web Locks API extends that to every tab of the browser: two tabs rotating the
// same refresh cookie used to trip the server's reuse detection and sign the whole
// account out (which looked like the portal reloading on its own).
let refreshing: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
    const run = locks?.request
      ? () => locks.request('tf-refresh', performRefresh) as Promise<boolean>
      : performRefresh;
    refreshing = Promise.resolve()
      .then(run)
      .catch(() => false)
      .finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  }
  return refreshing;
}

const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/forgot-password'];

async function once(path: string, opts?: { method?: string; body?: unknown }) {
  let res: Response;
  try {
    res = await fetch(`/backend${path}`, {
      method: opts?.method ?? 'GET',
      credentials: 'include',
      headers: opts?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your internet connection.');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { res, data };
}

export async function api<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  let { res, data } = await once(path, opts);

  // Access token lasts 15 minutes. Quietly renew it with the refresh cookie and replay the request,
  // so people are not thrown out in the middle of writing a report.
  if (res.status === 401 && !NO_REFRESH.some((p) => path.startsWith(p))) {
    let ok = await refreshSession();
    if (!ok) {
      // Another tab may have rotated the refresh cookie a moment ago: try once more before giving up.
      await new Promise((r) => setTimeout(r, 400));
      ({ res, data } = await once(path, opts));
      ok = res.ok;
      if (!ok && res.status === 401) throw new ApiError(401, 'Your session has ended. Please sign in again.');
    } else {
      ({ res, data } = await once(path, opts));
    }
  }

  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? `Request failed (${res.status})`);
    const code = typeof data?.code === 'string' ? data.code : undefined;
    if (res.status === 403 && msg === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') {
      window.location.assign('/change-password');
    }
    if (res.status === 429) throw new ApiError(429, msg === `Request failed (429)` ? 'Too many requests. Please wait a moment.' : msg);
    throw new ApiError(res.status, msg, code);
  }
  return data as T;
}

/** Downloads a server-generated file (Excel/CSV) through the authenticated API, with silent session renewal. */
export async function downloadFile(path: string, fallbackName: string) {
  const go = () => fetch(`/backend${path}`, { credentials: 'include' });
  let res = await go();
  if (res.status === 401 && (await refreshSession())) res = await go();
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try { const j = await res.json(); msg = Array.isArray(j.message) ? j.message.join(', ') : j.message ?? msg; } catch { /* not json */ }
    throw new ApiError(res.status, msg);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename="([^"]+)"/i.exec(cd);
  const name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Downloads a text file generated in the browser (used for one-time credential lists). */
export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'TEAM_LEAD' | 'COORDINATOR' | 'EMPLOYEE';
  teamId: string | null;
  batchId: string | null;
  mustChangePassword: boolean;
  avatarFileId?: string | null;
}

export const STATUS_COLORS: Record<string, string> = {
  TODO: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
  IN_PROGRESS: 'bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-100',
  IN_REVIEW: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  DONE: 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200',
  BLOCKED: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
};

export const STATUS_LABEL: Record<string, string> = {
  TODO: 'To do', IN_PROGRESS: 'In progress', IN_REVIEW: 'In review', DONE: 'Done', BLOCKED: 'Blocked',
};

export const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-slate-100 text-slate-600',
  MEDIUM: 'bg-accent-50 text-accent-700',
  HIGH: 'bg-orange-50 text-orange-700',
  URGENT: 'bg-red-50 text-red-700',
};

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin', TEAM_LEAD: 'Team Lead', COORDINATOR: 'Coordinator', EMPLOYEE: 'Employee',
};

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}
