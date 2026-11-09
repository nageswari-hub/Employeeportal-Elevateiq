'use client';
import { Loading } from '../../components/ui';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';

interface Goal {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  status: string;
  teamId?: string | null;
  createdById: string;
  createdBy?: { id: string; displayName: string } | null;
  team?: { id: string; name: string } | null;
}

export default function GoalsPage() {
  const { user, loading } = useRequireAuth();
  const [rows, setRows] = useState<Goal[]>([]);
  const [err, setErr] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editType, setEditType] = useState('WEEKLY');
  const [editStatus, setEditStatus] = useState('ACTIVE');

  async function load() {
    try {
      setRows(await api<Goal[]>('/goals'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Load failed');
    }
  }

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api('/goals', { method: 'POST', body: { title, teamId: user?.teamId ?? undefined } });
      setTitle('');
      await load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(g: Goal) {
    setEditing(g.id);
    setEditTitle(g.title);
    setEditType(g.type);
    setEditStatus(g.status);
    setErr('');
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setErr('');
    try {
      await api(`/goals/${id}`, { method: 'PATCH', body: { title: editTitle.trim(), type: editType, status: editStatus } });
      setEditing(null);
      await load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this goal? Tasks linked to it will be unlinked.')) return;
    setErr('');
    try {
      await api(`/goals/${id}`, { method: 'DELETE' });
      await load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Delete failed');
    }
  }

  if (loading || !user) return <Loading />;
  const canCreate = user.role === 'ADMIN' || user.role === 'TEAM_LEAD' || user.role === 'COORDINATOR';
  const canManage = (g: Goal) => user.role === 'ADMIN' || g.createdById === user.id;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Goals</h1>
      {err && <p className="err">{err}</p>}
      {canCreate && (
        <form onSubmit={create} className="card flex gap-2">
          <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Week 12 onboarding goal" />
          <button className="btn" disabled={busy}>Create</button>
        </form>
      )}
      <div className="card">
        <ul className="divide-y divide-slate-100">
          {rows.map((g) => (
            <li key={g.id} className="py-2 text-sm">
              {editing === g.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input className="input max-w-xs" value={editTitle} maxLength={200} onChange={(e) => setEditTitle(e.target.value)} />
                  <select className="input !w-auto" value={editType} onChange={(e) => setEditType(e.target.value)}>
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                  <select className="input !w-auto" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                    <option value="ACTIVE">Active</option>
                    <option value="DONE">Done</option>
                    <option value="ARCHIVED">Archived</option>
                  </select>
                  <button className="btn !px-3 !py-1" disabled={busy} onClick={() => saveEdit(g.id)}>Save</button>
                  <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <b>{g.title}</b>
                  <span className="text-slate-500">· {g.type} · {g.status}{g.team?.name ? ` · ${g.team.name}` : ''}{g.createdBy ? ` · by ${g.createdBy.displayName}` : ''}</span>
                  {canManage(g) && (
                    <span className="ml-auto flex gap-2">
                      <button className="text-slate-500 hover:underline" onClick={() => startEdit(g)}>Edit</button>
                      <button className="text-red-600 hover:underline" onClick={() => remove(g.id)}>Delete</button>
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
          {rows.length === 0 && <p className="text-sm text-slate-500">No goals yet.</p>}
        </ul>
      </div>
    </div>
  );
}
