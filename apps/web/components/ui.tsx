'use client';
import { useState, useEffect as useFx } from 'react';
import { useAvatars } from './AvatarProvider';
import { ReactNode, useEffect } from 'react';
import { initials, PRIORITY_COLORS, STATUS_COLORS, STATUS_LABEL } from '../lib/api';

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-700'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${PRIORITY_COLORS[priority] ?? 'bg-slate-100'}`}>{priority}</span>;
}

export function Avatar({ name, size = 32, userId, ring }: { name: string; size?: number; userId?: string; ring?: 'online' | 'break' | 'out' }) {
  const photos = useAvatars();
  const fileId = userId ? photos.map[userId] : undefined;
  const [failed, setFailed] = useState<string | null>(null);
  const showImg = fileId && failed !== fileId;
  const ringCls = ring === 'online' ? 'ring-2 ring-green-500' : ring === 'break' ? 'ring-2 ring-amber-400' : ring === 'out' ? 'ring-2 ring-slate-300' : '';
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-accent-600 to-ink-800 font-semibold text-white ${ringCls}`} style={{ width: size, height: size, fontSize: size * 0.38 }} title={name}>
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/backend/avatars/${userId}?v=${fileId}`} alt={name} width={size} height={size} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(fileId!)} />
      ) : initials(name)}
    </span>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useFx(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(to); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / 700); setN(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n}</>;
}

export function Stat({ label, value, tone = 'default', hint }: { label: string; value: ReactNode; tone?: 'default' | 'danger' | 'success' | 'warn' | 'brand'; hint?: string }) {
  const bar = { default: 'bg-accent-600', danger: 'bg-red-500', success: 'bg-green-500', warn: 'bg-amber-500', brand: 'bg-brand-600' }[tone];
  return (
    <div className="card relative overflow-hidden !p-4">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <span className={`pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-10 ${bar}`} />
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-ink-900">{typeof value === 'number' ? <CountUp to={value} /> : value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function ProgressBar({ pct, tone = 'brand' }: { pct: number; tone?: 'brand' | 'accent' | 'green' }) {
  const c = { brand: 'bg-brand-600', accent: 'bg-accent-600', green: 'bg-green-500' }[tone];
  const [w, setW] = useState(0);
  useFx(() => { const id = requestAnimationFrame(() => setW(Math.min(100, Math.max(0, pct)))); return () => cancelAnimationFrame(id); }, [pct]);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`bar-fill h-full rounded-full ${c}`} style={{ width: `${w}%` }} />
    </div>
  );
}

export function Empty({ icon = '📭', text }: { icon?: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
      <span className="text-3xl">{icon}</span>
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

export function Loading() {
  return (
    <div className="space-y-3 py-6" role="status" aria-label="Loading">
      <div className="skeleton h-6 w-1/3" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-20" />)}</div>
      <div className="skeleton h-40 w-full" />
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-0 backdrop-blur-sm animate-fade sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className="animate-pop max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:max-w-lg sm:rounded-3xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center">
          <h2 className="text-lg font-bold text-ink-900">{title}</h2>
          <button className="btn-ghost ml-auto" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Donut({ data, size = 150 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  const r = 52, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label="Chart">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#F1F5F9" strokeWidth="16" />
      {total > 0 && data.map((d) => {
        const len = (d.value / total) * c;
        const el = <circle key={d.label} cx="70" cy="70" r={r} fill="none" stroke={d.color} strokeWidth="16" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" style={{ animation: `sweep .9s ${0.12 * data.indexOf(d)}s ease-out both` }} />;
        off += len;
        return el;
      })}
      <text x="70" y="68" textAnchor="middle" className="fill-ink-900" style={{ fontSize: 26, fontWeight: 700 }}>{total}</text>
      <text x="70" y="86" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 10 }}>TASKS</text>
    </svg>
  );
}
