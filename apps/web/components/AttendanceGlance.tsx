'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { getSocket } from '../lib/realtime';

/** Dashboard card for admin / lead / coordinator: today's attendance at a glance, live. */
export function AttendanceGlance() {
  const [s, setS] = useState<Record<string, number> | null>(null);
  const [working, setWorking] = useState(true);
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => api<{ summary: Record<string, number>; workingDay: boolean }>('/attendance/board').then((b) => { if (alive) { setS(b.summary); setWorking(b.workingDay); } }).catch(() => {});
    load();
    const bump = () => { clearTimeout(timer); timer = setTimeout(load, 1500); };
    const sock = getSocket(); sock.on('attendance:changed', bump);
    const poll = setInterval(() => { if (!document.hidden) load(); }, 90_000);
    return () => { alive = false; clearTimeout(timer); clearInterval(poll); sock.off('attendance:changed', bump); };
  }, []);
  if (!s) return null;
  const cells: [string, number, string][] = [
    ['Present', s.present, 'text-green-600'], ['On break', s.onBreak, 'text-amber-600'], ['Late', s.late, 'text-amber-600'],
    ['On leave', s.leave, 'text-sky-600'], ['Not in / absent', (s.absent ?? 0) + (s.notIn ?? 0), 'text-red-600'], ['Checked out', s.checkedOut, 'text-slate-600'],
  ];
  return (
    <Link href="/attendance?board=1" className="card block transition hover:shadow-md" aria-label="Open the attendance board">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-semibold text-ink-900">Attendance today</h2>
        {working ? <span className="flex items-center gap-1.5 text-xs text-green-600"><span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />live</span> : <span className="text-xs text-slate-400">day off</span>}
        <span className="ml-auto text-xs font-semibold text-accent-600">Open board →</span>
      </div>
      <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {cells.map(([k, v, c]) => <div key={k} className="rounded-xl bg-slate-50 px-3 py-2 text-center"><dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{k}</dt><dd className={`text-2xl font-extrabold ${c}`}>{v ?? 0}</dd></div>)}
      </dl>
    </Link>
  );
}
