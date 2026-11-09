'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, STATUS_LABEL } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';

interface DayInfo {
  meetings: Array<{ id: string; title: string; startsAt: string; meetUrl: string; team: { name: string } | null }>;
  tasks: Array<{ id: string; title: string; status: string; priority: string; dueDate: string; owner: { id: string; displayName: string } }>;
  leaves: Array<{ user: string; fromDate: string; toDate: string }>;
  isHoliday: boolean;
  isWorkingDay: boolean;
}

export default function CalendarPage() {
  const { user, loading } = useRequireAuth();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [days, setDays] = useState<Record<string, DayInfo>>({});
  const [sel, setSel] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [sTitle, setSTitle] = useState('');
  const [sTime, setSTime] = useState('10:00');
  const [sUrl, setSUrl] = useState('');
  const [sDaily, setSDaily] = useState(false);

  const reload = () => {
    if (!user || !month) return;
    api<{ days: Record<string, DayInfo> }>(`/calendar?month=${month}`)
      .then((r) => {
        const normalized: Record<string, DayInfo> = {};
        for (const [key, val] of Object.entries(r.days ?? {})) {
          normalized[key] = {
            ...val,
            meetings: val.meetings ?? [],
            tasks: val.tasks ?? [],
            leaves: val.leaves ?? [],
          };
        }
        setDays(normalized);
        setErr('');
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Load failed'));
  };

  useEffect(() => {
    if (!user || !month) return;
    setSel('');
    reload();
  }, [user, month]); // eslint-disable-line react-hooks/exhaustive-deps

  async function schedule(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      await api('/meetings', { method: 'POST', body: {
        title: sTitle, meetUrl: sUrl, startsAt: new Date(`${sel}T${sTime}`).toISOString(),
        teamId: user?.role === 'ADMIN' ? null : (user?.teamId ?? null),
        recurrence: sDaily ? 'DAILY' : 'NONE',
      } });
      setMsg(`Scheduled on ${sel}${sDaily ? ' (repeats daily)' : ''}.`);
      setSTitle(''); setSUrl(''); setSDaily(false);
      reload();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Schedule failed'); }
  }

  if (loading || !user) return <p className="text-sm text-slate-600">Loading…</p>;

  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const dates = Object.keys(days).sort();
  const firstDow = dates.length ? (new Date(dates[0] + 'T00:00:00Z').getUTCDay() + 6) % 7 : 0; // Monday-first
  const detail = sel ? days[sel] : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold">📅 Team calendar</h1>
        <div className="ml-auto flex gap-2">
          <button className="btn-secondary" onClick={() => shift(-1)}>←</button>
          <input className="input max-w-[150px]" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="btn-secondary" onClick={() => shift(1)}>→</button>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      {msg && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}
      <div className="card">
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: firstDow }).map((_, i) => <span key={`e${i}`} />)}
          {dates.map((d) => {
            const info = days[d];
            const busy = (info.meetings?.length ?? 0) + (info.tasks?.length ?? 0) + (info.leaves?.length ?? 0) > 0;
            return (
              <button
                key={d}
                onClick={() => setSel(d)}
                className={`rounded-lg border p-1 text-left text-xs ${sel === d ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'} ${!info.isWorkingDay ? 'bg-slate-100 text-slate-400' : ''}`}
              >
                <span className="font-semibold">{Number(d.slice(8))}</span>
                <span className="block truncate">
                  {info.isHoliday ? '🎉 ' : ''}{info.meetings.length > 0 ? `📹${info.meetings.length} ` : ''}{info.leaves.length > 0 ? `🏖️${info.leaves.length}` : ''}{!busy && !info.isWorkingDay ? '·' : ''}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">📹 meetings · ·2t = tasks due · 🏖️ on leave · 🎉 holiday · grey = day off</p>
      </div>
      {detail && sel && (
        <div className="card text-sm">
          <h2 className="mb-2 font-semibold">{sel}{days[sel].isHoliday ? ' — holiday 🎉' : ''}</h2>
          {(detail.tasks ?? []).map((t) => (
            <p key={t.id} className="py-1">
              <span className="mr-2 rounded bg-slate-100 px-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">task</span>
              <Link href={`/tasks/${t.id}`} className="font-semibold text-ink-900 hover:text-brand-600">{t.title}</Link>
              <span className="ml-2 text-xs text-slate-500">{t.owner.displayName} · {STATUS_LABEL[t.status] ?? t.status}</span>
            </p>
          ))}
          {(detail.meetings ?? []).map((m) => (
            <p key={m.id} className="py-1">📹 <b>{m.title}</b> {new Date(m.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {m.team ? `· ${m.team.name}` : '· Company'} <a className="text-brand-600 hover:underline" href={m.meetUrl} target="_blank" rel="noreferrer">Join →</a></p>
          ))}
          {(detail.leaves ?? []).map((l, i) => <p key={i} className="py-1">🏖️ {l.user} on leave</p>)}
          {(detail.meetings?.length ?? 0) === 0 && (detail.tasks?.length ?? 0) === 0 && (detail.leaves?.length ?? 0) === 0 && <p className="text-slate-500">Nothing scheduled.</p>}
          {(user.role === 'ADMIN' || user.role === 'TEAM_LEAD') && (
            <form onSubmit={schedule} className="mt-3 grid gap-2 rounded-xl border border-dashed border-slate-300 p-2 sm:grid-cols-5">
              <input className="input" required value={sTitle} onChange={(e) => setSTitle(e.target.value)} placeholder="Schedule: title" maxLength={200} />
              <input className="input" required type="time" value={sTime} onChange={(e) => setSTime(e.target.value)} />
              <input className="input" required value={sUrl} onChange={(e) => setSUrl(e.target.value)} placeholder="Meet link https://…" />
              <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={sDaily} onChange={(e) => setSDaily(e.target.checked)} /> Daily</label>
              <button className="btn">Add</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
