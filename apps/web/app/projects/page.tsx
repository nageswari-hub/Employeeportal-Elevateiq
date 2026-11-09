'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, fmtDate } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';
import { Avatar, Empty, Loading, Modal, PageHeader } from '../../components/ui';

interface Project {
  id: string; name: string; description: string | null; status: string;
  teamId: string | null; batchId: string | null; startDate: string | null; dueDate: string | null;
  team?: { id: string; name: string } | null; batch?: { id: string; name: string } | null;
  owner?: { id: string; displayName: string } | null;
  taskCount: number; doneCount: number; progress: number;
}
interface TeamRow { id: string; name: string }
interface UserRow { id: string; displayName: string }

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700',
  PAUSED: 'bg-amber-50 text-amber-700',
  DONE: 'bg-brand-50 text-brand-700',
  ARCHIVED: 'bg-slate-100 text-slate-500',
};

export default function ProjectsPage() {
  const { user, loading } = useRequireAuth();
  const [rows, setRows] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [form, setForm] = useState({ name: '', description: '', teamId: '', ownerId: '', startDate: '', dueDate: '' });

  const canCreate = user?.role === 'ADMIN' || user?.role === 'TEAM_LEAD' || user?.role === 'COORDINATOR';

  async function load() {
    try { setRows(await api<Project[]>('/projects')); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not load projects'); }
    finally { setFetching(false); }
  }
  useEffect(() => { if (user) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  useEffect(() => {
    if (!open || !canCreate || !user) return;
    if (user.role === 'ADMIN') api<TeamRow[]>('/teams').then(setTeams).catch(() => {});
    const teamId = user.role === 'ADMIN' ? form.teamId : user.teamId ?? '';
    if (teamId) api<{ data: UserRow[] }>(`/users?teamId=${teamId}&active=true&limit=100`).then((r) => setUsers(r.data)).catch(() => setUsers([]));
    else setUsers([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.teamId, user, canCreate]);

  async function remove(id: string) {
    if (!confirm('Delete this project? Its tasks will stay but become unlinked.')) return;
    setErr('');
    try { await api(`/projects/${id}`, { method: 'DELETE' }); await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Delete failed'); }
  }

  async function create(e: React.FormEvent) {    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await api('/projects', { method: 'POST', body: {
        name: form.name,
        description: form.description || undefined,
        teamId: user!.role === 'ADMIN' ? form.teamId || undefined : user!.teamId ?? undefined,
        ownerId: form.ownerId || undefined,
        startDate: form.startDate ? new Date(form.startDate).toISOString() : undefined,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
      } });
      setOpen(false); setForm({ name: '', description: '', teamId: '', ownerId: '', startDate: '', dueDate: '' });
      await load();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Create failed'); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <Loading />;

  return (
    <div className="space-y-5">
      <PageHeader title="Projects" sub="Group tasks into projects and watch progress.">
        {canCreate && <button className="btn" onClick={() => setOpen(true)}>+ New project</button>}
      </PageHeader>
      {err && !open && <p className="err">{err}</p>}
      {fetching ? <Loading /> : rows.length === 0 ? (
        <div className="card"><Empty text="No projects yet." /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="card transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start gap-2">
                <h2 className="min-w-0 flex-1 truncate font-semibold text-ink-900">{p.name}</h2>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_TONE[p.status] ?? 'bg-slate-100 text-slate-500'}`}>{p.status}</span>
                {canCreate && (
                  <button
                    type="button"
                    title="Delete project"
                    aria-label={`Delete ${p.name}`}
                    className="rounded-lg px-1.5 py-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void remove(p.id); }}
                  >✕</button>
                )}
              </div>
              {p.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.description}</p>}
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${p.progress}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">{p.doneCount} of {p.taskCount} tasks done · {p.progress}%</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                {p.owner && <><Avatar userId={p.owner.id} name={p.owner.displayName} size={22} /><span className="truncate">{p.owner.displayName}</span></>}
                <span className="ml-auto shrink-0">{p.dueDate ? `Due ${fmtDate(p.dueDate)}` : p.team?.name ?? p.batch?.name ?? ''}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New project">
        <form onSubmit={create} className="space-y-3">
          <div><label className="label">Name</label><input className="input" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Placement drive" /></div>
          <div><label className="label">Description (optional)</label><textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            {user.role === 'ADMIN' ? (
              <div><label className="label">Team</label>
                <select className="input" required value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value, ownerId: '' })}>
                  <option value="">Select team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></div>
            ) : null}
            <div><label className="label">Owner (optional)</label>
              <select className="input" value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
                <option value="">No owner</option>{users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select></div>
            <div><label className="label">Start date</label><input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
            <div><label className="label">Due date</label><input className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
          </div>
          {err && <p className="err">{err}</p>}
          <button className="btn w-full" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button>
        </form>
      </Modal>
    </div>
  );
}
