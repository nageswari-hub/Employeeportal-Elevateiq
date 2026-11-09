'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError, fmtDate, STATUS_LABEL } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth-context';
import { Avatar, Loading, PriorityBadge, StatusBadge } from '../../../components/ui';

interface TaskRow {
  id: string; title: string; status: string; priority: string; dueDate: string | null;
  owner: { id: string; displayName: string };
}
interface Project {
  id: string; name: string; description: string | null; status: string;
  teamId: string | null; startDate: string | null; dueDate: string | null;
  team?: { id: string; name: string } | null; batch?: { id: string; name: string } | null;
  owner?: { id: string; displayName: string } | null;
  taskCount: number; doneCount: number; progress: number; tasks: TaskRow[];
}

const STATUSES = ['ACTIVE', 'PAUSED', 'DONE', 'ARCHIVED'];

export default function ProjectDetailPage() {
  const { user, loading } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const [p, setP] = useState<Project | null>(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try { setP(await api<Project>(`/projects/${params.id}`)); setErr(''); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not load project'); }
  }
  useEffect(() => { if (user) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  async function setStatus(status: string) {
    setSaving(true); setErr('');
    try { await api(`/projects/${params.id}`, { method: 'PATCH', body: { status } }); await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Update failed'); }
    finally { setSaving(false); }
  }

  if (loading || !user) return <Loading />;
  if (!p) return <><p className="err">{err}</p><Loading /></>;

  const canPlan = user.role === 'ADMIN' || ((user.role === 'TEAM_LEAD' || user.role === 'COORDINATOR') && !!p.teamId && p.teamId === user.teamId);

  return (
    <div className="space-y-5">
      <Link href="/projects" className="text-sm font-medium text-slate-500 hover:text-brand-600">← Back to projects</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{p.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{p.status}</span>
            {p.team?.name && <span>{p.team.name}</span>}
            {p.batch?.name && <span>{p.batch.name}</span>}
            {p.owner && <span className="flex items-center gap-1.5"><Avatar userId={p.owner.id} name={p.owner.displayName} size={22} />{p.owner.displayName}</span>}
            {p.dueDate && <span>Due {fmtDate(p.dueDate)}</span>}
          </div>
        </div>
        {canPlan && (
          <select className="input !w-40" value={p.status} disabled={saving} onChange={(e) => void setStatus(e.target.value)} aria-label="Project status">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
      {err && <p className="err">{err}</p>}

      <div className="card">
        {p.description && <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{p.description}</p>}
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-600" style={{ width: `${p.progress}%` }} />
        </div>
        <p className="mt-2 text-sm text-slate-500">{p.doneCount} of {p.taskCount} tasks done · {p.progress}%</p>
      </div>

      <div className="card">
        <h2 className="h2">Tasks ({p.tasks.length})</h2>
        {p.tasks.length === 0 ? <p className="text-sm text-slate-400">No tasks linked yet. Choose this project when assigning a task.</p> : (
          <ul className="divide-y divide-slate-100">
            {p.tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-medium text-ink-900 hover:text-brand-600">{t.title}</Link>
                <PriorityBadge priority={t.priority} />
                <StatusBadge status={t.status} />
                <span className="flex items-center gap-1.5 text-xs text-slate-500"><Avatar userId={t.owner.id} name={t.owner.displayName} size={20} />{t.owner.displayName}</span>
                <span className="w-20 text-right text-xs text-slate-400">{t.dueDate ? fmtDate(t.dueDate) : STATUS_LABEL[t.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
