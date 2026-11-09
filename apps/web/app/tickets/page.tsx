'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, timeAgo } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';
import { Avatar, Empty, Loading, Modal, PageHeader } from '../../components/ui';

interface Ticket {
  id: string; subject: string; category: string; priority: string; status: string; escalated: boolean;
  createdAt: string;
  requester: { id: string; displayName: string; role: string };
  assignee: { id: string; displayName: string } | null;
  team: { id: string; name: string } | null;
}

const STATUS_TONE: Record<string, string> = {
  OPEN: 'bg-red-50 text-red-700',
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  RESOLVED: 'bg-green-50 text-green-700',
  CLOSED: 'bg-slate-100 text-slate-500',
};
const PRIORITY_TONE: Record<string, string> = {
  LOW: 'text-slate-500', MEDIUM: 'text-slate-700', HIGH: 'text-amber-700', URGENT: 'text-red-600',
};

export default function TicketsPage() {
  const { user, loading } = useRequireAuth();
  const [rows, setRows] = useState<Ticket[]>([]);
  const [fetching, setFetching] = useState(true);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ subject: '', description: '', category: 'WORK', priority: 'MEDIUM', escalateToAdmin: false });

  async function load() {
    setFetching(true);
    try { setRows(await api<Ticket[]>(`/tickets${status ? `?status=${status}` : ''}`)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not load tickets'); }
    finally { setFetching(false); }
  }
  useEffect(() => { if (user) void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, status]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api('/tickets', { method: 'POST', body: form });
      setOpen(false); setForm({ subject: '', description: '', category: 'WORK', priority: 'MEDIUM', escalateToAdmin: false });
      await load();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Could not raise ticket'); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <Loading />;
  const openCount = rows.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length;

  return (
    <div className="space-y-5">
      <PageHeader title="Issues & escalations" sub="Raise a blocker, get it routed to your lead or admin.">
        <select className="input !w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>
        <button className="btn" onClick={() => setOpen(true)}>+ New ticket</button>
      </PageHeader>
      {err && !open && <p className="err">{err}</p>}
      {!fetching && <p className="text-xs text-slate-500">{openCount} open · {rows.length} shown</p>}
      {fetching ? <Loading /> : rows.length === 0 ? <div className="card"><Empty text="No tickets here." /></div> : (
        <div className="card table-wrap !p-2">
          <table>
            <thead><tr><th>Ticket</th><th>Status</th><th>Priority</th><th>Raised by</th><th>Owner</th><th>Age</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td>
                    <Link href={`/tickets/${t.id}`} className="font-medium text-ink-900 hover:text-brand-600">{t.subject}</Link>
                    <p className="text-[11px] text-slate-400">{t.category.toLowerCase()}{t.escalated ? ' · escalated' : ''}{t.team ? ` · ${t.team.name}` : ''}</p>
                  </td>
                  <td><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_TONE[t.status] ?? ''}`}>{t.status.replace('_', ' ')}</span></td>
                  <td><span className={`text-xs font-semibold ${PRIORITY_TONE[t.priority] ?? ''}`}>{t.priority}</span></td>
                  <td><span className="flex items-center gap-1.5 text-sm"><Avatar userId={t.requester.id} name={t.requester.displayName} size={22} />{t.requester.displayName}</span></td>
                  <td className="text-sm text-slate-600">{t.assignee?.displayName ?? 'Unassigned'}</td>
                  <td className="text-xs text-slate-400">{timeAgo(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Raise a ticket">
        <form onSubmit={create} className="space-y-3">
          <div><label className="label">Subject</label><input className="input" required minLength={3} maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Laptop cannot connect to VPN" /></div>
          <div><label className="label">Details</label><textarea className="input" required rows={4} maxLength={10000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What happened, what you already tried, and what you need." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Category</label>
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {['WORK', 'ACCESS', 'ATTENDANCE', 'TECHNICAL', 'OTHER'].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
              </select></div>
            <div><label className="label">Priority</label>
              <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select></div>
          </div>
          {user.role !== 'ADMIN' && (
            <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <input className="mt-0.5" type="checkbox" checked={form.escalateToAdmin} onChange={(e) => setForm({ ...form, escalateToAdmin: e.target.checked })} />
              <span><b>Escalate to admin.</b> Skip the normal route to your team lead. Use this for access, safety or conduct issues.</span>
            </label>
          )}
          {err && <p className="err">{err}</p>}
          <button className="btn w-full" disabled={busy}>{busy ? 'Sending…' : 'Raise ticket'}</button>
        </form>
      </Modal>
    </div>
  );
}
