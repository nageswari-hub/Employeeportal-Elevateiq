'use client';
import { useEffect, useState } from 'react';
import { api, ApiError, ROLE_LABEL } from '../../lib/api';
import { Loading, PageHeader } from '../../components/ui';
import { useRequireAuth } from '../../lib/auth-context';

const DAYS = [
  { n: 1, l: 'Mon' }, { n: 2, l: 'Tue' }, { n: 3, l: 'Wed' }, { n: 4, l: 'Thu' }, { n: 5, l: 'Fri' }, { n: 6, l: 'Sat' }, { n: 0, l: 'Sun' },
];

export default function SettingsPage() {
  const { user, loading } = useRequireAuth(['ADMIN']);
  const [time, setTime] = useState('18:00');
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState('');
  const [att, setAtt] = useState({ shiftStart: '09:30', shiftEnd: '18:30', autoCheckout: '23:30', graceMinutes: 15, halfDayMinutes: 240, maxBreakMinutes: 60, maxSingleBreakMinutes: 45 });
  const [photo, setPhoto] = useState(true);
  const [gate, setGate] = useState<{ enabled: boolean; roles: string[] }>({ enabled: true, roles: ['EMPLOYEE', 'COORDINATOR', 'TEAM_LEAD'] });
  const [sys, setSys] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<{ key: string; value: any }[]>('/settings').then((rows) => {
      const g = (k: string) => rows.find((r) => r.key === k)?.value;
      if (g('reportDeadline')?.time) setTime(String(g('reportDeadline').time));
      if (Array.isArray(g('workDays'))) setWorkDays(g('workDays'));
      if (Array.isArray(g('holidays'))) setHolidays([...g('holidays')].sort());
      if (g('attendance') && typeof g('attendance') === 'object') setAtt((c) => ({ ...c, ...g('attendance') }));
      if (g('requireProfilePhoto') === false) setPhoto(false);
      if (g('reportGate') && typeof g('reportGate') === 'object') setGate((c) => ({ ...c, enabled: g('reportGate').enabled !== false, roles: Array.isArray(g('reportGate').roles) ? g('reportGate').roles : c.roles }));
    }).catch((e) => setErr(e.message));
    api('/admin/system').then(setSys).catch(() => {});
  }, [user]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(''); setMsg('');
    try {
      await api('/settings/reportDeadline', { method: 'PUT', body: { value: { time } } });
      await api('/settings/workDays', { method: 'PUT', body: { value: workDays } });
      await api('/settings/holidays', { method: 'PUT', body: { value: holidays } });
      await api('/settings/attendance', { method: 'PUT', body: { value: { ...att, graceMinutes: Number(att.graceMinutes), halfDayMinutes: Number(att.halfDayMinutes), maxBreakMinutes: Number(att.maxBreakMinutes), maxSingleBreakMinutes: Number(att.maxSingleBreakMinutes) } } });
      await api('/settings/requireProfilePhoto', { method: 'PUT', body: { value: photo } });
      await api('/settings/reportGate', { method: 'PUT', body: { value: gate } });
      setMsg('Saved. New rules apply immediately.');
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <Loading />;
  const toggleDay = (n: number) => setWorkDays((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]));
  const addHoliday = () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(newHoliday) && !holidays.includes(newHoliday)) setHolidays([...holidays, newHoliday].sort());
    setNewHoliday('');
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" sub="Company rules. Changes apply to reminders, late flags, streaks and “missing” lists." />
      {err && <p className="err mb-4" role="alert">{err}</p>}
      {msg && <p className="ok mb-4" role="status">{msg}</p>}
      <form onSubmit={save} className="space-y-5">
        <section className="card">
          <h2 className="h2">Daily report deadline</h2>
          <p className="mb-3 text-sm text-slate-500">Reports after this time are marked late. A reminder goes out 30 minutes before, and team leads get a missing-reports summary shortly after.</p>
          <input className="input !w-40" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
        </section>
        <section className="card">
          <h2 className="h2">Attendance & breaks</h2>
          <p className="mb-3 text-sm text-slate-500">People are “late” after shift start + grace. Under the half-day minimum when they check out counts as a half day. Forgotten check-outs are closed automatically and flagged for review.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label">Shift starts</label><input className="input" type="time" value={att.shiftStart} onChange={(e) => setAtt({ ...att, shiftStart: e.target.value })} /></div>
            <div><label className="label">Shift ends</label><input className="input" type="time" value={att.shiftEnd} onChange={(e) => setAtt({ ...att, shiftEnd: e.target.value })} /></div>
            <div><label className="label">Auto check-out at</label><input className="input" type="time" value={att.autoCheckout} onChange={(e) => setAtt({ ...att, autoCheckout: e.target.value })} /></div>
            <div><label className="label">Grace (minutes)</label><input className="input" type="number" min={0} max={240} value={att.graceMinutes} onChange={(e) => setAtt({ ...att, graceMinutes: Number(e.target.value) })} /></div>
            <div><label className="label">Half-day below (minutes worked)</label><input className="input" type="number" min={0} max={1440} value={att.halfDayMinutes} onChange={(e) => setAtt({ ...att, halfDayMinutes: Number(e.target.value) })} /></div>
            <div><label className="label">Total break allowed / day (min)</label><input className="input" type="number" min={0} max={600} value={att.maxBreakMinutes} onChange={(e) => setAtt({ ...att, maxBreakMinutes: Number(e.target.value) })} /></div>
            <div><label className="label">Alert lead if one break exceeds (min)</label><input className="input" type="number" min={5} max={600} value={att.maxSingleBreakMinutes} onChange={(e) => setAtt({ ...att, maxSingleBreakMinutes: Number(e.target.value) })} /></div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} /> Require every person to upload a profile photo before using the app</label>
        </section>
        <section className="card">
          <h2 className="h2">Report before checkout / logout</h2>
          <p className="mb-3 text-sm text-slate-500">When on, the selected roles cannot check out or log out until they submit today’s daily report. People who never checked in can always log out.</p>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={gate.enabled} onChange={(e) => setGate({ ...gate, enabled: e.target.checked })} /> Enforce the daily report gate</label>
          <div className="mt-3 flex flex-wrap gap-2">
            {['EMPLOYEE', 'COORDINATOR', 'TEAM_LEAD', 'ADMIN'].map((r) => (
              <button type="button" key={r} aria-pressed={gate.roles.includes(r)}
                onClick={() => setGate({ ...gate, roles: gate.roles.includes(r) ? gate.roles.filter((x) => x !== r) : [...gate.roles, r] })}
                className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${gate.roles.includes(r) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}>
                {ROLE_LABEL[r] ?? r}
              </button>
            ))}
          </div>
        </section>
        <section className="card">
          <h2 className="h2">Working days</h2>
          <p className="mb-3 text-sm text-slate-500">On non-working days nobody is marked missing and streaks are not broken.</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <button type="button" key={d.n} aria-pressed={workDays.includes(d.n)} onClick={() => toggleDay(d.n)}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${workDays.includes(d.n) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}>{d.l}</button>
            ))}
          </div>
        </section>
        <section className="card">
          <h2 className="h2">Holidays</h2>
          <div className="mb-3 flex gap-2">
            <input className="input !w-48" type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} aria-label="Holiday date" />
            <button type="button" className="btn-secondary" onClick={addHoliday}>Add holiday</button>
          </div>
          {holidays.length === 0 ? <p className="text-sm text-slate-400">No holidays added.</p> : (
            <ul className="flex flex-wrap gap-2">
              {holidays.map((h) => (
                <li key={h} className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm">
                  {new Date(h + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
                  <button type="button" className="text-slate-400 hover:text-red-600" aria-label={`Remove ${h}`} onClick={() => setHolidays(holidays.filter((x) => x !== h))}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <button className="btn !px-8" disabled={busy || workDays.length === 0}>{busy ? 'Saving…' : 'Save settings'}</button>
      </form>

      {sys && (
        <section className="card mt-8">
          <h2 className="h2">System health</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
            {[['Online now', sys.onlineUsers], ['Database', `${sys.dbSizeMb} MB`], ['API memory', `${sys.memoryMb} MB`], ['Uptime', `${Math.floor(sys.uptimeSec / 3600)}h ${Math.floor((sys.uptimeSec % 3600) / 60)}m`],
              ['Files stored', sys.storage?.files ?? 0], ['Storage used', `${sys.storage?.usedMb ?? 0} MB`], ['Disk free', sys.storage?.diskFreeMb != null ? `${sys.storage.diskFreeMb} MB` : '—'], ['People', sys.counts.users], ['Tasks', sys.counts.tasks], ['Reports', sys.counts.reports], ['Audit entries', sys.counts.auditLogs]].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-lg font-bold text-ink-900">{v}</dd></div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
