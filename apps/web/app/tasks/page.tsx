'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, fmtDate, STATUS_LABEL } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';
import { Avatar, Empty, Loading, Modal, PageHeader, PriorityBadge, StatusBadge } from '../../components/ui';
import { getSocket } from '../../lib/realtime';

interface Task {
  id: string; title: string; status: string; priority: string; dueDate: string | null; teamId: string;
  recurrence?: string; seriesId?: string | null;
  project?: { id: string; name: string } | null;
  owner: { id: string; displayName: string };
}
interface UserRow { id: string; displayName: string; role: string; teamId: string | null; isActive: boolean }
interface TeamRow { id: string; name: string }

const COLS = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'];
const COL_TONE: Record<string, string> = { TODO: 'bg-slate-400', IN_PROGRESS: 'bg-accent-600', IN_REVIEW: 'bg-amber-500', BLOCKED: 'bg-red-500', DONE: 'bg-green-500' };

function isOverdue(t: Task) { return !!t.dueDate && t.status !== 'DONE' && new Date(t.dueDate) < new Date(new Date().toDateString()); }

function TaskCard({ t }: { t: Task }) {
  return (
    <Link href={`/tasks/${t.id}`} className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-accent-600/40 hover:shadow-md">
      <p className="text-sm font-semibold leading-snug text-ink-900">{t.title}</p>
      <div className="mt-2.5 flex items-center gap-2">
        <PriorityBadge priority={t.priority} />
        {t.dueDate && <span className={`text-xs ${isOverdue(t) ? 'font-semibold text-red-600' : 'text-slate-400'}`}>{isOverdue(t) ? '⚠ ' : ''}{fmtDate(t.dueDate)}</span>}
        {t.recurrence && t.recurrence !== 'NONE' && <span className="text-[10px] font-semibold uppercase text-brand-600">repeats</span>}
        {t.project && <span className="truncate text-[10px] font-semibold uppercase text-slate-400">{t.project.name}</span>}
        <span className="ml-auto"><Avatar userId={t.owner.id} name={t.owner.displayName} size={24} /></span>
      </div>
    </Link>
  );
}

export default function TasksPage() {
  const { user, loading } = useRequireAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [fetching, setFetching] = useState(true);
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string; teamId: string | null }[]>([]);
  const [form, setForm] = useState({ title: '', description: '', ownerId: '', teamId: '', projectId: '', priority: 'MEDIUM', dueDate: '', estimatedHours: '', recurrence: 'NONE', recurrenceUntil: '' });
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [more, setMore] = useState(false);

  // Server-side search + paging: works for thousands of tasks, not just the first 100.
  const load = useCallback(async (pageNo: number, append: boolean) => {
    setErr('');
    try {
      const p = new URLSearchParams({ limit: '60', page: String(pageNo) });
      if (status) p.set('status', status);
      if (search.trim()) p.set('search', search.trim());
      if (overdueOnly) p.set('overdue', 'true');
      const r = await api<{ data: Task[]; meta: { total: number; totalPages: number } }>(`/tasks?${p}`);
      setTasks((cur) => (append ? [...cur, ...r.data.filter((n) => !cur.some((c) => c.id === n.id))] : r.data));
      setTotal(r.meta.total); setPage(pageNo); setMore(pageNo < r.meta.totalPages);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Load failed');
    } finally {
      setFetching(false); setMore((m) => m);
    }
  }, [status, search, overdueOnly]);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => load(1, false), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [user, load, search]);

  // Live board: when anyone changes a task I can see, reload page 1 quietly.
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => load(1, false), 700); };
    const s = getSocket();
    s.on('task:changed', bump); s.on('task:updated', bump); s.on('task:created', bump);
    return () => { clearTimeout(timer); s.off('task:changed', bump); s.off('task:updated', bump); s.off('task:created', bump); };
  }, [user, load]);

  const canCreate = user?.role === 'ADMIN' || user?.role === 'TEAM_LEAD' || user?.role === 'COORDINATOR';
  useEffect(() => {
    if (!user || !canCreate) return;
    api<TeamRow[]>('/teams').then((all) => setTeams(user.role === 'COORDINATOR' ? all.filter((t) => t.id === user.teamId) : all)).catch(() => {});
    api<{ id: string; name: string; teamId: string | null }[]>('/projects').then(setProjects).catch(() => {});
    setForm((f) => ({ ...f, teamId: user.teamId ?? '' }));
  }, [user, canCreate]);

  // Assignee list follows the chosen team (the old code only ever fetched the first 100 users company-wide).
  useEffect(() => {
    if (!user || !canCreate || !form.teamId) { setUsers([]); return; }
    api<{ data: UserRow[] }>(`/users?teamId=${form.teamId}&active=true&limit=100`).then((r) => setUsers(r.data)).catch(() => setUsers([]));
  }, [user, canCreate, form.teamId]);

  const shown = tasks;
  const people = users;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api('/tasks', { method: 'POST', body: {
        title: form.title, ownerId: form.ownerId, teamId: form.teamId, priority: form.priority, projectId: form.projectId || undefined,
        description: form.description || undefined,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : undefined,
        recurrence: form.recurrence,
        recurrenceUntil: form.recurrence !== 'NONE' && form.recurrenceUntil ? new Date(form.recurrenceUntil).toISOString() : undefined,
      } });
      setOpen(false);
      setForm({ ...form, title: '', description: '', ownerId: '', projectId: '', dueDate: '', estimatedHours: '', recurrence: 'NONE', recurrenceUntil: '' });
      await load(1, false);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <Loading />;
  const set = (k: string) => (e: React.ChangeEvent<any>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div>
      <PageHeader title="Tasks" sub={user.role === 'EMPLOYEE' ? 'Your assigned work.' : 'Track work across the team.'}>
        <input className="input !w-48" type="search" placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search tasks" />
        <button className={`btn-secondary ${overdueOnly ? '!border-red-300 !bg-red-50 !text-red-700' : ''}`} aria-pressed={overdueOnly} onClick={() => setOverdueOnly(!overdueOnly)}>⚠ Overdue</button>
        <select className="input !w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {COLS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <div className="flex rounded-xl border border-slate-300 bg-white p-0.5">
          {(['board', 'list'] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${view === v ? 'bg-ink-900 text-white' : 'text-slate-600'}`}>{v}</button>)}
        </div>
        {canCreate && <button className="btn" onClick={() => setOpen(true)}>+ New task</button>}
      </PageHeader>
      {err && !open && <p className="err mb-4">{err}</p>}
      {!fetching && total > shown.length && <p className="mb-3 text-xs text-slate-500">Showing {shown.length} of {total} tasks.</p>}
      {fetching ? <Loading /> : shown.length === 0 ? <div className="card"><Empty icon="🗂️" text="No tasks found." /></div> : view === 'board' ? (
        <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 lg:mx-0 lg:px-0">
          {(status ? [status] : COLS).map((c) => {
            const items = shown.filter((t) => t.status === c);
            return (
              <div key={c} className="min-w-[15rem] flex-1 rounded-2xl bg-slate-100/70 p-3">
                <div className="mb-3 flex items-center gap-2 px-1"><span className={`h-2.5 w-2.5 rounded-full ${COL_TONE[c]}`} /><b className="text-sm text-ink-900">{STATUS_LABEL[c]}</b><span className="ml-auto rounded-full bg-white px-2 text-xs font-semibold text-slate-500">{items.length}</span></div>
                <div className="space-y-2.5">{items.map((t) => <TaskCard key={t.id} t={t} />)}{items.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Empty</p>}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card table-wrap !p-2">
          <table>
            <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Owner</th><th>Due</th></tr></thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td><Link href={`/tasks/${t.id}`} className="font-medium text-ink-900 hover:text-brand-600">{t.title}</Link></td>
                  <td><StatusBadge status={t.status} /></td>
                  <td><PriorityBadge priority={t.priority} /></td>
                  <td><div className="flex items-center gap-2"><Avatar userId={t.owner.id} name={t.owner.displayName} size={24} />{t.owner.displayName}</div></td>
                  <td className={isOverdue(t) ? 'font-semibold text-red-600' : 'text-slate-500'}>{fmtDate(t.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {more && !fetching && (
        <div className="mt-4 flex justify-center"><button className="btn-secondary" onClick={() => load(page + 1, true)}>Load more tasks</button></div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Assign a new task">
        <form onSubmit={create} className="space-y-4">
          <div><label className="label">Title</label><input className="input" required maxLength={200} value={form.title} onChange={set('title')} placeholder="e.g. Onboard 5 interns" /></div>
          <div><label className="label">Description (optional)</label><textarea className="input" rows={3} value={form.description} onChange={set('description')} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Team</label>
              <select className="input" required value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value, ownerId: '', projectId: '' })}>
                <option value="">Select team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select></div>
            <div><label className="label">Assign to</label>
              <select className="input" required value={form.ownerId} onChange={set('ownerId')}>
                <option value="">Select person</option>{people.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select></div>
            <div><label className="label">Priority</label>
              <select className="input" value={form.priority} onChange={set('priority')}>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p}>{p}</option>)}</select></div>
            <div><label className="label">Due date</label><input className="input" type="date" required={form.recurrence !== 'NONE'} value={form.dueDate} onChange={set('dueDate')} /></div>
          </div>
          <div><label className="label">Project (optional)</label>
            <select className="input" value={form.projectId} onChange={set('projectId')}>
              <option value="">No project</option>
              {projects.filter((p) => !p.teamId || p.teamId === form.teamId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Repeat</label>
              <select className="input" value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value, recurrenceUntil: '' })}>
                <option value="NONE">Does not repeat</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select></div>
            {form.recurrence !== 'NONE' && (
              <div><label className="label">Repeat until (optional)</label><input className="input" type="date" min={form.dueDate || undefined} value={form.recurrenceUntil} onChange={set('recurrenceUntil')} /></div>
            )}
          </div>
          {form.recurrence !== 'NONE' && <p className="text-xs text-slate-500">Occurrences are created ahead of time (default 30 days, max 90) so each one has its own status, comments and files.</p>}
          <div><label className="label">Estimated hours</label><input className="input" type="number" min={0} max={1000} value={form.estimatedHours} onChange={set('estimatedHours')} /></div>
          {err && <p className="err">{err}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn" disabled={busy}>{busy ? 'Assigning…' : 'Assign task'}</button></div>
        </form>
      </Modal>
    </div>
  );
}
