'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Avatar, Modal } from './ui';

interface Meeting {
  id: string;
  title: string;
  meetUrl: string;
  startsAt: string;
  note: string | null;
  noteUpdatedBy?: { displayName: string } | null;
  audience?: string;
  createdById?: string;
  team: { id: string; name: string } | null;
}
interface TeamRow { id: string; name: string }
interface UserRow { id: string; displayName: string; teamId?: string | null }

const AUDIENCE_LABEL: Record<string, string> = { COMPANY: 'Everyone', TEAM: 'Team', LEADS: 'Team leads', USERS: 'Selected people' };

export function MeetingsCard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Meeting[]>([]);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [at, setAt] = useState('');
  const [daily, setDaily] = useState(false);
  const [audience, setAudience] = useState<'COMPANY' | 'TEAM' | 'LEADS' | 'USERS'>(user?.role === 'ADMIN' ? 'COMPANY' : 'TEAM');
  const [teamId, setTeamId] = useState(user?.teamId ?? '');
  const [userIds, setUserIds] = useState<string[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [people, setPeople] = useState<UserRow[]>([]);
  const [err, setErr] = useState('');
  const canCreate = user && ['ADMIN', 'TEAM_LEAD'].includes(user.role);
  const isAdmin = user?.role === 'ADMIN';

  const load = () => api<Meeting[]>('/meetings').then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!canCreate) return;
    if (isAdmin) api<TeamRow[]>('/teams').then(setTeams).catch(() => {});
  }, [canCreate, isAdmin]);

  useEffect(() => {
    if (!canCreate || audience !== 'USERS') { setPeople([]); return; }
    const tid = isAdmin ? teamId : user?.teamId ?? '';
    if (!tid) { setPeople([]); return; }
    api<{ data: UserRow[] }>(`/users?teamId=${tid}&active=true&limit=100`).then((r) => setPeople(r.data)).catch(() => setPeople([]));
  }, [canCreate, audience, teamId, isAdmin, user?.teamId]);

  async function saveNote(id: string) {
    await api(`/meetings/${id}/note`, { method: 'PATCH', body: { note: noteText } });
    setOpenNote(null);
    setNoteText('');
    load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this meeting for everyone?')) return;
    setErr('');
    try { await api(`/meetings/${id}`, { method: 'DELETE' }); load(); }
    catch (e: any) { setErr(e.message ?? 'Delete failed'); }
  }

  function toggleUser(id: string) {
    setUserIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await api('/meetings', { method: 'POST', body: {
        title,
        meetUrl: url,
        startsAt: new Date(at).toISOString(),
        audience,
        teamId: audience === 'COMPANY' ? null : audience === 'LEADS' ? (teamId || null) : (isAdmin ? teamId : user?.teamId ?? null),
        userIds: audience === 'USERS' ? userIds : undefined,
        recurrence: daily ? 'DAILY' : 'NONE',
      } });
      setTitle(''); setUrl(''); setAt(''); setDaily(false); setUserIds([]);
      load();
    } catch (ex: any) { setErr(ex.message ?? 'Could not schedule meeting'); }
  }

  const canManage = (m: Meeting) => user?.role === 'ADMIN' || m.createdById === user?.id;

  return (
    <section className="card">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="h2">📹 Meetings — join in one tap</h2>
      </div>
      {rows.length === 0 && <p className="text-sm text-slate-500">No upcoming meetings. Enjoy the quiet.</p>}
      <ul className="space-y-2">
        {rows.map((m) => {
          const live = new Date(m.startsAt).getTime() - Date.now() < 15 * 60_000;
          return (
            <li key={m.id} className="rounded-xl bg-slate-50 p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span>{live ? '🔴' : '📅'}</span>
                <span><b>{m.title}</b> <span className="text-slate-500">· {m.team ? m.team.name : 'Company'} · {AUDIENCE_LABEL[m.audience ?? 'TEAM'] ?? ''} · {new Date(m.startsAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></span>
                <span className="ml-auto flex gap-2">
                  <button className="btn-secondary !px-2 !py-1" onClick={() => { setOpenNote(openNote === m.id ? null : m.id); setNoteText(m.note ?? ''); }}>📝 {m.note ? 'Note' : 'Add note'}</button>
                  <a href={m.meetUrl} target="_blank" rel="noreferrer" className="btn !px-4 !py-1.5">Join →</a>
                  {canManage(m) && <button className="rounded-lg px-2 py-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete meeting" aria-label={`Delete ${m.title}`} onClick={() => remove(m.id)}>✕</button>}
                </span>
              </div>
              {m.note && openNote !== m.id && <p className="mt-1 whitespace-pre-wrap text-slate-600">📝 {m.note}</p>}
              {openNote === m.id && (
                <div className="mt-2 flex gap-2">
                  <textarea className="input" rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Shared note for everyone in this meeting…" maxLength={10000} />
                  <button className="btn" onClick={() => saveNote(m.id)}>Save</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canCreate && (
        <form onSubmit={create} className="mt-3 space-y-2 rounded-xl border border-dashed border-slate-300 p-2">
          <div className="grid gap-2 sm:grid-cols-4">
            <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Standup" maxLength={200} />
            <input className="input sm:col-span-2" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Meet link https://…" />
            <input className="input" required type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <select className="input" value={audience} onChange={(e) => { setAudience(e.target.value as any); setUserIds([]); }}>
              {isAdmin && <option value="COMPANY">Everyone in the company</option>}
              <option value="TEAM">Entire team</option>
              {isAdmin && <option value="LEADS">Team leads</option>}
              <option value="USERS">Selected people</option>
            </select>
            {(audience === 'TEAM' || audience === 'USERS' || (audience === 'LEADS' && isAdmin)) && (
              <select className="input" value={isAdmin ? teamId : user?.teamId ?? ''} onChange={(e) => { setTeamId(e.target.value); setUserIds([]); }} required={audience !== 'LEADS'}>
                {isAdmin ? <><option value="">{audience === 'LEADS' ? 'All teams' : 'Select team'}</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</> : <option value={user?.teamId ?? ''}>{teams.find((t) => t.id === user?.teamId)?.name ?? 'My team'}</option>}
              </select>
            )}
            <label className="flex items-center gap-1 text-sm text-slate-600"><input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} /> Repeat daily</label>
            <button className="btn sm:ml-auto">Schedule</button>
          </div>
          {audience === 'USERS' && (
            <div className="rounded-xl border border-slate-200 p-2">
              {people.length === 0 ? <p className="text-xs text-slate-500">{isAdmin && !teamId ? 'Choose a team to pick people.' : 'No people found in this team.'}</p> : (
                <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                  {people.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={userIds.includes(p.id)} onChange={() => toggleUser(p.id)} />
                      <span className="truncate">{p.displayName}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {err && <p className="err">{err}</p>}
        </form>
      )}
    </section>
  );
}


export function HrCard() {
  const { user } = useAuth();
  const [hr, setHr] = useState<any>(null);
  const [lead, setLead] = useState<any>(null);

  useEffect(() => {
    if (!user?.teamId) return;
    api<any>(`/teams/${user.teamId}`).then((t) => { setHr(t.hr ?? null); setLead(t.lead ?? null); }).catch(() => {});
  }, [user]);

  if (!user?.teamId || (!hr && !lead)) return null;
  return (
    <section className="card">
      <h2 className="h2">🙋 Your support contacts</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {hr && (
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <Avatar name={hr.displayName} userId={hr.id} />
            <div className="text-sm">
              <p className="font-semibold">{hr.displayName}</p>
              <p className="text-slate-500">HR support · {hr.email}</p>
              <a className="text-brand-600 hover:underline" href={`mailto:${hr.email}`}>Ask HR for help →</a>
            </div>
          </div>
        )}
        {lead && (
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <Avatar name={lead.displayName} userId={lead.id} />
            <div className="text-sm">
              <p className="font-semibold">{lead.displayName}</p>
              <p className="text-slate-500">Team lead · {lead.email}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function LeavesWidget() {  const { user } = useAuth();
  const [mine, setMine] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);

  useEffect(() => {
    api<any[]>('/leaves/mine').then((r) => setMine(r.filter((x) => x.status === 'APPROVED').slice(0, 3))).catch(() => {});
    if (user && ['ADMIN', 'TEAM_LEAD', 'COORDINATOR'].includes(user.role)) {
      api<any[]>('/leaves/pending').then(setPending).catch(() => {});
    }
  }, [user]);

  if (!mine.length && !pending.length) return null;
  return (
    <section className="card">
      <h2 className="h2">🏖️ Leaves</h2>
      {pending.length > 0 && (
        <Link href="/leaves" className="mb-2 flex items-center gap-2 rounded-xl bg-amber-50 p-2.5 text-sm text-amber-800 hover:bg-amber-100">
          <span>⏳</span><b>{pending.length} request{pending.length > 1 ? 's' : ''} waiting for decision.</b><span className="ml-auto font-semibold">Review →</span>
        </Link>
      )}
      {mine.length > 0 && (
        <ul className="space-y-1 text-sm text-slate-600">
          {mine.map((l) => (
            <li key={l.id}>✅ {l.fromDate.slice(0, 10)} → {l.toDate.slice(0, 10)}</li>
          ))}
        </ul>
      )}
      {mine.length === 0 && pending.length === 0 && <p className="text-sm text-slate-500">No upcoming leaves.</p>}
    </section>
  );
}

export function HrSupportButton({ teamId, teamName }: { teamId: string | null; teamName?: string }) {
  const [open, setOpen] = useState(false);
  const [hr, setHr] = useState<any>(null);
  const [err, setErr] = useState('');

  async function show() {
    setErr('');
    if (!teamId) { setHr(null); setOpen(true); return; }
    try {
      const t = await api<any>(`/teams/${teamId}`);
      setHr(t.hr ?? null);
      setOpen(true);
    } catch (e: any) { setErr(e.message ?? 'Failed'); setOpen(true); }
  }

  return (
    <>
      <button className="btn-ghost !text-xs" onClick={show}>HR support</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`HR support${teamName ? ` — ${teamName}` : ''}`}>
        {err && <p className="err">{err}</p>}
        {!teamId || !hr ? (
          <p className="text-sm text-slate-600">No HR assigned to this team yet. Ask your admin to assign one in Teams.</p>
        ) : (
          <div className="flex items-center gap-3">
            <Avatar name={hr.displayName} userId={hr.id} size={44} />
            <div className="text-sm">
              <p className="font-semibold">{hr.displayName}</p>
              <p className="text-slate-500">{hr.email}</p>
              <a className="text-brand-600 hover:underline" href={`mailto:${hr.email}`}>Write to HR →</a>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
