'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError, timeAgo } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth-context';
import { Avatar, Loading } from '../../../components/ui';

interface Message { id: string; body: string; createdAt: string; author: { id: string; displayName: string; role: string } }
interface Ticket {
  id: string; subject: string; description: string; category: string; priority: string; status: string;
  escalated: boolean; resolution: string | null; resolvedAt: string | null; createdAt: string;
  requester: { id: string; displayName: string; role: string };
  assignee: { id: string; displayName: string } | null;
  resolvedBy: { id: string; displayName: string } | null;
  team: { id: string; name: string } | null;
  messages: Message[];
}

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

export default function TicketDetailPage() {
  const { user, loading } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const [t, setT] = useState<Ticket | null>(null);
  const [err, setErr] = useState('');
  const [reply, setReply] = useState('');
  const [resolution, setResolution] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const data = await api<Ticket>(`/tickets/${params.id}`);
      setT(data); setStatus(data.status); setResolution(data.resolution ?? ''); setErr('');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not load ticket'); }
  }
  useEffect(() => { if (user) void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true); setErr('');
    try { await api(`/tickets/${params.id}/messages`, { method: 'POST', body: { body: reply.trim() } }); setReply(''); await load(); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Reply failed'); }
    finally { setBusy(false); }
  }

  async function save(body: any) {
    setBusy(true); setErr('');
    try { await api(`/tickets/${params.id}`, { method: 'PATCH', body }); await load(); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Update failed'); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <Loading />;
  if (!t) return <><p className="err">{err}</p><Loading /></>;

  const canManage = user.role === 'ADMIN' || t.assignee?.id === user.id ||
    ((user.role === 'TEAM_LEAD' || user.role === 'COORDINATOR') && !!t.team && t.team.id === user.teamId);
  const isRequester = t.requester.id === user.id;
  const closed = t.status === 'CLOSED' || t.status === 'RESOLVED';

  return (
    <div className="space-y-5">
      <Link href="/tickets" className="text-sm font-medium text-slate-500 hover:text-brand-600">← Back to tickets</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{t.subject}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{t.status.replace('_', ' ')}</span>
            <span className="text-xs font-semibold">{t.priority}</span>
            <span className="text-xs uppercase">{t.category}</span>
            {t.escalated && <span className="text-xs font-semibold text-red-600">escalated</span>}
            <span className="flex items-center gap-1.5"><Avatar userId={t.requester.id} name={t.requester.displayName} size={22} />{t.requester.displayName}</span>
            <span>→</span>
            <span>{t.assignee ? t.assignee.displayName : 'Unassigned'}</span>
            {t.team && <span>· {t.team.name}</span>}
            <span>· {timeAgo(t.createdAt)}</span>
          </div>
        </div>
      </div>
      {err && <p className="err">{err}</p>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="card">
            <h2 className="h2">Details</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{t.description}</p>
            {t.resolution && (
              <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                <b>Resolution:</b> {t.resolution}
                {t.resolvedBy && <span className="mt-1 block text-xs text-green-700">By {t.resolvedBy.displayName}{t.resolvedAt ? ` · ${timeAgo(t.resolvedAt)}` : ''}</span>}
              </div>
            )}
          </div>
          <div className="card">
            <h2 className="h2">Conversation ({t.messages.length})</h2>
            <ul className="mb-4 space-y-4">
              {t.messages.map((m) => (
                <li key={m.id} className="flex gap-3">
                  <Avatar userId={m.author.id} name={m.author.displayName} size={34} />
                  <div className="flex-1 rounded-2xl rounded-tl-sm bg-slate-50 px-4 py-2.5">
                    <p className="text-sm"><b className="text-ink-900">{m.author.displayName}</b> <span className="text-xs text-slate-400">{timeAgo(m.createdAt)}</span></p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700">{m.body}</p>
                  </div>
                </li>
              ))}
              {t.messages.length === 0 && <p className="text-sm text-slate-400">No replies yet. Add context or ask a question.</p>}
            </ul>
            {!closed && (
              <form onSubmit={sendReply} className="flex items-center gap-2">
                <input className="input" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} placeholder="Write a reply…" />
                <button className="btn" disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Send'}</button>
              </form>
            )}
          </div>
        </div>

        <div className="space-y-5">
          {canManage ? (
            <div className="card">
              <h2 className="h2">Resolve</h2>
              <label className="label">Status</label>
              <select className="input mb-3" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
              <label className="label">Resolution note</label>
              <textarea className="input mb-3" rows={3} maxLength={5000} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done?" />
              <button className="btn w-full" disabled={busy} onClick={() => void save({ status, resolution })}>{busy ? 'Saving…' : 'Save update'}</button>
            </div>
          ) : isRequester && !closed ? (
            <div className="card">
              <h2 className="h2">Ticket</h2>
              <p className="mb-3 text-sm text-slate-500">Solved on your side, or no longer needed?</p>
              <button className="btn-secondary w-full" disabled={busy} onClick={() => void save({ status: 'CLOSED' })}>Close my ticket</button>
            </div>
          ) : null}
          <div className="card text-sm text-slate-600">
            <h2 className="h2">Routing</h2>
            <p>Raised by <b>{t.requester.displayName}</b> ({t.requester.role.replace('_', ' ').toLowerCase()})</p>
            <p className="mt-1">Handled by <b>{t.assignee?.displayName ?? 'an admin'}</b></p>
            {t.team && <p className="mt-1">Team: {t.team.name}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
