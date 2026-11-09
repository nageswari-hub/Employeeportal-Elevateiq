'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Avatar, Empty, Loading, Modal, PageHeader } from '../../components/ui';
import { useRequireAuth } from '../../lib/auth-context';

interface Person { id: string; displayName: string; email?: string; role: string; isActive: boolean }
interface Team {
  id: string; name: string; description: string | null; leadId: string | null; coordinatorId: string | null; hrId: string | null;
  _count?: { members: number };
}
interface TeamDetail extends Team { members: Person[] }

export default function TeamsPage() {
  const { user, loading } = useRequireAuth(['ADMIN', 'TEAM_LEAD', 'COORDINATOR']);
  const isAdmin = user?.role === 'ADMIN';
  const [teams, setTeams] = useState<Team[]>([]);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<TeamDetail | null>(null);
  const [edit, setEdit] = useState({ name: '', description: '', leadId: '', coordinatorId: '', hrId: '' });
  const [candidates, setCandidates] = useState<Person[]>([]);

  const load = useCallback(async () => {
    try { setTeams(await api<Team[]>('/teams')); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Load failed'); }
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  async function show(t: Team) {
    setErr('');
    try {
      const d = await api<TeamDetail>(`/teams/${t.id}`);
      setOpen(d);
      setEdit({ name: d.name, description: d.description ?? '', leadId: d.leadId ?? '', coordinatorId: d.coordinatorId ?? '', hrId: (d as any).hrId ?? '' });
      if (isAdmin) {
        // Everyone who could lead/coordinate: staff roles company-wide, so the admin can pick people not yet in the team.
        const [leads, coords] = await Promise.all([
          api<{ data: Person[] }>('/users?role=TEAM_LEAD&active=true&limit=100'),
          api<{ data: Person[] }>('/users?role=COORDINATOR&active=true&limit=100'),
        ]);
        setCandidates([...leads.data, ...coords.data]);
      }
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not open team'); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/teams', { method: 'POST', body: { name: name.trim() } }); setName(''); await load(); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Create failed'); }
    finally { setBusy(false); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!open) return; setBusy(true); setErr('');
    try {
      await api(`/teams/${open.id}`, { method: 'PATCH', body: {
        name: edit.name.trim(), description: edit.description.trim() || undefined,
        leadId: edit.leadId || undefined, coordinatorId: edit.coordinatorId || undefined, hrId: edit.hrId || undefined,
      } });
      setOpen(null); await load();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <Loading />;
  const nameOf = (id: string | null) => (id ? candidates.find((c) => c.id === id)?.displayName ?? open?.members.find((m) => m.id === id)?.displayName : undefined);

  return (
    <div>
      <PageHeader title="Teams" sub={`${teams.length} team${teams.length === 1 ? '' : 's'}`} />
      {err && !open && <p className="err mb-4" role="alert">{err}</p>}
      {isAdmin && (
        <form onSubmit={create} className="card mb-5 flex flex-col gap-3 sm:flex-row">
          <input className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="New team name" />
          <button className="btn sm:w-40" disabled={busy}>+ Create team</button>
        </form>
      )}
      {teams.length === 0 ? <div className="card"><Empty icon="👥" text={isAdmin ? 'Create your first team above, then add people on the People page.' : 'No teams yet.'} /></div> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((t) => (
            <button key={t.id} onClick={() => show(t)} className="card text-left transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-500 text-lg font-bold text-white">{t.name.slice(0, 1).toUpperCase()}</span>
                <div><p className="font-semibold text-ink-900">{t.name}</p><p className="text-sm text-slate-500">{t._count?.members ?? 0} members</p></div>
              </div>
              {t.description && <p className="mt-3 text-sm text-slate-600">{t.description}</p>}
              {isAdmin && !t.leadId && <p className="mt-3 text-xs font-medium text-amber-600">No team lead assigned yet</p>}
              {isAdmin && !(t as any).hrId && <p className="mt-1 text-xs font-medium text-amber-600">No HR assigned yet</p>}
            </button>
          ))}
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''}>
        {open && (
          <form onSubmit={save} className="space-y-3">
            {err && <p className="err" role="alert">{err}</p>}
            {isAdmin ? (
              <>
                <div><label className="label">Team name</label><input className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
                <div><label className="label">Description</label><textarea className="input" rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Team lead</label>
                    <select className="input" value={edit.leadId} onChange={(e) => setEdit({ ...edit, leadId: e.target.value })}>
                      <option value="">{nameOf(open.leadId) ? `Keep: ${nameOf(open.leadId)}` : 'Not assigned'}</option>
                      {candidates.filter((c) => c.role === 'TEAM_LEAD').map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                    </select></div>
                  <div><label className="label">Coordinator</label>
                    <select className="input" value={edit.coordinatorId} onChange={(e) => setEdit({ ...edit, coordinatorId: e.target.value })}>
                      <option value="">{nameOf(open.coordinatorId) ? `Keep: ${nameOf(open.coordinatorId)}` : 'Not assigned'}</option>
                      {candidates.filter((c) => c.role === 'COORDINATOR').map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                    </select></div>
                  <div><label className="label">HR support</label>
                    <select className="input" value={edit.hrId} onChange={(e) => setEdit({ ...edit, hrId: e.target.value })}>
                      <option value="">{nameOf((open as any).hrId) ? `Keep: ${nameOf((open as any).hrId)}` : 'Not assigned'}</option>
                      {candidates.map((c) => <option key={c.id} value={c.id}>{c.displayName} ({c.role})</option>)}
                    </select></div>
                </div>
                <p className="text-xs text-slate-500">The lead and coordinator also receive the daily "missing reports" summary. Create these people on the People page first, then set their team there.</p>
              </>
            ) : open.description && <p className="text-sm text-slate-600">{open.description}</p>}
            <div>
              <p className="label">Members ({open.members.filter((m) => m.isActive).length})</p>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl bg-slate-50 p-3">
                {open.members.filter((m) => m.isActive).map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm"><Avatar userId={m.id} name={m.displayName} size={24} /><span className="font-medium text-ink-900">{m.displayName}</span>
                    {m.id === open.leadId && <span className="rounded bg-brand-50 px-1.5 text-[10px] font-bold uppercase text-brand-600">Lead</span>}
                    {m.id === open.coordinatorId && <span className="rounded bg-accent-50 px-1.5 text-[10px] font-bold uppercase text-accent-700">Coordinator</span>}
                    {m.email && <span className="ml-auto truncate text-xs text-slate-400">{m.email}</span>}
                  </li>
                ))}
                {open.members.length === 0 && <li className="text-sm text-slate-500">No members yet.</li>}
              </ul>
            </div>
            {isAdmin && <button className="btn w-full" disabled={busy}>{busy ? 'Saving…' : 'Save team'}</button>}
          </form>
        )}
      </Modal>
    </div>
  );
}
