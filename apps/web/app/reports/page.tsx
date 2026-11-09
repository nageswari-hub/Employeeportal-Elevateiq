'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Avatar, Empty, Loading, PageHeader } from '../../components/ui';
import { useAuth, useRequireAuth } from '../../lib/auth-context';
import { AttachButton, AttachmentList, UploadChips, useUploads } from '../../components/Attachments';
import type { FileInfo } from '../../lib/files';

interface Mine {
  id: string; reportDate: string; hoursWorked: string | number; isLate: boolean;
  didToday: string; blockers: string | null; planTomorrow: string;
  taskLinks?: { task: { id: string; title: string; status: string } }[];
  files?: FileInfo[];
}
interface MyTask { id: string; title: string; status: string }

const localDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA').format(d); // YYYY-MM-DD in the browser's timezone
const dayOnly = (iso: string) => iso.slice(0, 10);

export default function ReportsPage() {
  const { user, loading } = useRequireAuth();
  const { logout } = useAuth();
  const today = localDay();
  const [day, setDay] = useState(today);
  const [did, setDid] = useState('');
  const [blockers, setBlockers] = useState('');
  const [plan, setPlan] = useState('');
  const [hours, setHours] = useState('8');
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [myTasks, setMyTasks] = useState<MyTask[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Mine[]>([]);
  const [deadline, setDeadline] = useState('18:00');
  const [statusDate, setStatusDate] = useState(today);
  const [status, setStatus] = useState<{ submitted: any[]; missing: any[]; workingDay: boolean } | null>(null);
  const draftKey = user ? `tf-report-draft:${user.id}:${day}` : '';
  const hydrated = useRef('');
  const up = useUploads('REPORT');

  const canSeeStatus = !!user && ['ADMIN', 'TEAM_LEAD', 'COORDINATOR'].includes(user.role);
  const teamFilter = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('team') : null;
  const gateBlocked = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('gate') === '1';

  const loadMine = useCallback(async () => {
    try { setMine(await api<Mine[]>('/daily-reports/mine')); } catch { /* ignore */ }
  }, []);

  const loadStatus = useCallback(async (d: string) => {
    setStatusDate(d);
    if (!canSeeStatus) return;
    try {
      const s = await api<{ submitted: any[]; missing: any[]; workingDay: boolean }>(`/daily-reports/status?date=${d}${teamFilter ? `&teamId=${teamFilter}` : ''}`);
      setStatus(s);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Status failed'); }
  }, [canSeeStatus, teamFilter]);

  useEffect(() => {
    if (!user) return;
    loadMine();
    loadStatus(today);
    api<{ data: MyTask[] }>('/tasks?limit=100&status=IN_PROGRESS').then((r) => setMyTasks(r.data)).catch(() => {});
    api<{ key: string; value: any }[]>('/settings').then((rows) => {
      const t = rows.find((r) => r.key === 'reportDeadline')?.value?.time;
      if (t) setDeadline(String(t));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Fill the form: saved report for that day wins, else a local draft (survives refresh / lost connection).
  useEffect(() => {
    if (!user || !draftKey || hydrated.current === draftKey) return;
    const existing = mine.find((r) => dayOnly(r.reportDate) === day);
    if (existing) {
      setDid(existing.didToday); setBlockers(existing.blockers ?? ''); setPlan(existing.planTomorrow);
      setHours(String(existing.hoursWorked)); setTaskIds(existing.taskLinks?.map((l) => l.task.id) ?? []);
      hydrated.current = draftKey; return;
    }
    if (mine.length === 0 && hydrated.current === '') { /* wait for first load */ }
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) { const d = JSON.parse(raw); setDid(d.did ?? ''); setBlockers(d.blockers ?? ''); setPlan(d.plan ?? ''); setHours(d.hours ?? '8'); setTaskIds(d.taskIds ?? []); }
      else { setDid(''); setBlockers(''); setPlan(''); setHours('8'); setTaskIds([]); }
    } catch { /* storage blocked: ignore */ }
    hydrated.current = draftKey;
  }, [user, draftKey, mine, day]);

  useEffect(() => {
    if (!draftKey || hydrated.current !== draftKey) return;
    const t = setTimeout(() => {
      try {
        if (did || blockers || plan) localStorage.setItem(draftKey, JSON.stringify({ did, blockers, plan, hours, taskIds }));
      } catch { /* ignore */ }
    }, 600);
    return () => clearTimeout(t);
  }, [did, blockers, plan, hours, taskIds, draftKey]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    try {
      const r = await api<any>('/daily-reports', {
        method: 'POST',
        body: { reportDate: day, didToday: did.trim(), blockers: blockers.trim() || undefined, planTomorrow: plan.trim(), hoursWorked: Number(hours), taskIds, fileIds: up.fileIds },
      });
      up.reset();
      setMsg(r.isLate ? 'Saved. This report is marked late.' : 'Saved. Thank you!');
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      hydrated.current = '';
      await loadMine();
      if (canSeeStatus) loadStatus(statusDate);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Save failed. Your text is kept; try again.');
    } finally { setBusy(false); }
  }

  const toggleTask = (id: string) => setTaskIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  if (loading || !user) return <Loading />;
  const total = (status?.submitted.length ?? 0) + (status?.missing.length ?? 0);
  const editing = mine.some((r) => dayOnly(r.reportDate) === day);
  const submittedToday = mine.some((r) => dayOnly(r.reportDate) === today);
  const minDay = localDay(new Date(Date.now() - 14 * 86_400_000));

  return (
    <div>
      <PageHeader title="Daily reports" sub={`File your report before ${deadline}. After that it counts as late.`} />
      {gateBlocked && (submittedToday ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800" role="status">
          <span className="font-semibold">Today’s report is submitted — you can log out now.</span>
          <button type="button" className="btn !py-1.5" onClick={() => void logout()}>Log out</button>
        </div>
      ) : (
        <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800" role="alert">
          <b>Logout blocked.</b> You must write today’s daily report first. Fill the form below and press <b>Submit report</b> — you can log out right after.
        </div>
      ))}
      {err && <p className="err mb-4" role="alert">{err}</p>}
      {msg && <p className="ok mb-4" role="status">{msg}</p>}
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="card lg:col-span-3">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="h2 !mb-0">{day === today ? 'Today’s report' : `Report for ${day}`}</h2>
            {editing && <span className="rounded-full bg-accent-50 px-2.5 py-0.5 text-xs font-semibold text-accent-700">Already submitted · editing</span>}
            <input className="input ml-auto !w-40" type="date" min={minDay} max={today} value={day} onChange={(e) => { setDay(e.target.value || today); hydrated.current = ''; setMsg(''); }} aria-label="Report date" />
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div><label className="label">What I did</label><textarea className="input" required rows={4} maxLength={5000} value={did} onChange={(e) => setDid(e.target.value)} placeholder="Tasks finished, things learned…" /></div>
            {myTasks.length > 0 && (
              <div>
                <label className="label">Tasks I worked on (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {myTasks.map((t) => (
                    <button type="button" key={t.id} onClick={() => toggleTask(t.id)} aria-pressed={taskIds.includes(t.id)}
                      className={`max-w-full truncate rounded-full border px-3 py-1 text-xs font-medium transition ${taskIds.includes(t.id) ? 'border-accent-600 bg-accent-50 text-accent-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                      {taskIds.includes(t.id) ? '✓ ' : ''}{t.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div><label className="label">Blockers (optional)</label><input className="input" maxLength={2000} value={blockers} onChange={(e) => setBlockers(e.target.value)} placeholder="Anything stopping you?" /></div>
            <div><label className="label">Plan for tomorrow</label><textarea className="input" required rows={3} maxLength={5000} value={plan} onChange={(e) => setPlan(e.target.value)} /></div>
            <div>
              <div className="flex items-center gap-2"><label className="label !mb-0">Files (optional)</label><AttachButton onFiles={(f) => { void up.add(f); }} label="Attach files to this report" /></div>
              <div className="mt-2"><UploadChips items={up.items} onRemove={up.remove} onRetry={up.retry} /></div>
              {editing && (mine.find((r) => dayOnly(r.reportDate) === day)?.files?.length ?? 0) > 0 && <div className="mt-1"><p className="text-xs text-slate-500">Already attached:</p><AttachmentList files={mine.find((r) => dayOnly(r.reportDate) === day)?.files} compact /></div>}
            </div>
            <div className="flex items-end gap-4">
              <div className="w-40"><label className="label">Hours worked</label><input className="input" required type="number" min={0} max={24} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} /></div>
              <p className="hidden text-xs text-slate-400 sm:block">Draft saves automatically on this device.</p>
              <button className="btn ml-auto !px-6" disabled={busy || up.busy}>{up.busy ? 'Uploading…' : busy ? 'Saving…' : editing ? 'Update report' : 'Submit report'}</button>
            </div>
          </form>
        </div>
        <div className="card lg:col-span-2">
          <h2 className="h2">My recent reports</h2>
          {mine.length === 0 ? <Empty icon="📝" text="No reports yet." /> : (
            <ul className="divide-y divide-slate-100">
              {mine.slice(0, 10).map((r) => (
                <li key={r.id}>
                  <button type="button" className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:bg-slate-50" onClick={() => { setDay(dayOnly(r.reportDate)); hydrated.current = ''; }}>
                    <span className="font-medium text-ink-900">{new Date(r.reportDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
                    <span className="text-slate-500">{String(r.hoursWorked)}h</span>
                    <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${r.isLate ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{r.isLate ? 'Late' : 'On time'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {canSeeStatus && status && (
        <div className="card mt-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="font-semibold text-ink-900">Team status</h2>
            <span className="rounded-full bg-slate-100 px-3 py-0.5 text-xs font-semibold text-slate-600">{status.submitted.length}/{total} submitted</span>
            {!status.workingDay && <span className="rounded-full bg-amber-50 px-3 py-0.5 text-xs font-semibold text-amber-700">Day off. Nobody is marked missing.</span>}
            <input className="input ml-auto !w-44" type="date" value={statusDate} max={today} onChange={(e) => e.target.value && loadStatus(e.target.value)} aria-label="Status date" />
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-green-200 bg-green-50/40 p-4">
              <p className="mb-2 text-sm font-semibold text-green-700">✅ Submitted ({status.submitted.length})</p>
              <ul className="space-y-2">{status.submitted.map((x: any) => <li key={x.id} className="flex items-center gap-2 text-sm"><Avatar userId={x.id} name={x.displayName} size={26} />{x.displayName}{x.report?.isLate && <span className="text-xs text-red-600">late</span>}</li>)}</ul>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50/40 p-4">
              <p className="mb-2 text-sm font-semibold text-red-700">❌ Missing ({status.missing.length})</p>
              <ul className="space-y-2">{status.missing.map((m: any) => <li key={m.id} className="flex items-center gap-2 text-sm"><Avatar userId={m.id} name={m.displayName} size={26} /><span>{m.displayName}</span><span className="truncate text-xs text-slate-400">{m.email}</span></li>)}</ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
