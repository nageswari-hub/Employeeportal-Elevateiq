'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';

interface Leave {
  id: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: string;
  user?: { displayName: string; email: string };
  decidedBy?: { displayName: string } | null;
}

export default function LeavesPage() {
  const { user, loading } = useRequireAuth();
  const [mine, setMine] = useState<Leave[]>([]);
  const [pend, setPend] = useState<Leave[]>([]);
  const [allRows, setAllRows] = useState<Leave[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => {
    api<Leave[]>('/leaves/mine').then(setMine).catch(() => {});
    if (user && ['ADMIN', 'TEAM_LEAD', 'COORDINATOR'].includes(user.role)) {
      api<Leave[]>('/leaves/pending').then(setPend).catch(() => {});
    }
    if (user && ['ADMIN', 'TEAM_LEAD'].includes(user.role)) {
      api<Leave[]>('/leaves/all').then(setAllRows).catch(() => {});
    }
  };
  useEffect(() => { if (user) load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      await api('/leaves', { method: 'POST', body: { fromDate: from, toDate: to, reason } });
      setMsg('Request sent to your lead. You will be notified on decision.');
      setFrom(''); setTo(''); setReason('');
      load();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Failed'); }
  }

  async function decide(id: string, ok: boolean) {
    setErr('');
    try {
      await api(`/leaves/${id}/${ok ? 'approve' : 'reject'}`, { method: 'POST', body: {} });
      load();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Failed'); }
  }

  async function cancel(id: string) {
    try { await api(`/leaves/${id}/cancel`, { method: 'POST' }); load(); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Failed'); }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this approved leave? The days will no longer count as leave.')) return;
    setErr('');
    try { await api(`/leaves/${id}/revoke`, { method: 'POST' }); load(); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Failed'); }
  }

  if (loading || !user) return <p className="text-sm text-slate-600">Loading…</p>;
  const canDecide = ['ADMIN', 'TEAM_LEAD'].includes(user.role);
  const chip = (s: string) => s === 'APPROVED' ? 'bg-green-100 text-green-800' : s === 'PENDING' ? 'bg-amber-100 text-amber-800' : s === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-slate-200 text-slate-600';

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">🏖️ Leaves</h1>
      {err && <p className="err">{err}</p>}
      {msg && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}
      <div className="card">
        <h2 className="mb-2 font-semibold">Request leave</h2>
        <form onSubmit={submit} className="grid gap-2 sm:grid-cols-4">
          <input className="input" required type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input" required type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <input className="input" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" maxLength={1000} />
          <button className="btn">Request</button>
        </form>
      </div>
      {canDecide && pend.length > 0 && (
        <div className="card">
          <h2 className="mb-2 font-semibold">Waiting for decision ({pend.length})</h2>
          <ul className="space-y-2 text-sm">
            {pend.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2">
                <span><b>{l.user?.displayName}</b> · {l.fromDate.slice(0, 10)} → {l.toDate.slice(0, 10)} · {l.reason}</span>
                <span className="ml-auto flex gap-2">
                  <button className="btn !px-3 !py-1" onClick={() => decide(l.id, true)}>Approve</button>
                  <button className="btn-secondary" onClick={() => decide(l.id, false)}>Reject</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {canDecide && allRows.length > 0 && (
        <div className="card">
          <h2 className="mb-2 font-semibold">All leave requests</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Person</th><th>Dates</th><th>Status</th><th>Reason</th><th>Decided by</th><th /></tr></thead>
              <tbody>
                {allRows.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap">{l.user?.displayName ?? '—'}</td>
                    <td className="whitespace-nowrap">{l.fromDate.slice(0, 10)} → {l.toDate.slice(0, 10)}</td>
                    <td><span className={`rounded px-2 py-0.5 text-xs ${chip(l.status)}`}>{l.status}</span></td>
                    <td className="max-w-xs truncate" title={l.reason}>{l.reason}</td>
                    <td className="whitespace-nowrap">{l.decidedBy?.displayName ?? '—'}</td>
                    <td className="whitespace-nowrap text-right">
                      {l.status === 'PENDING' && <button className="text-slate-500 hover:underline" onClick={() => cancel(l.id)}>Cancel</button>}
                      {l.status === 'APPROVED' && <button className="text-red-600 hover:underline" onClick={() => revoke(l.id)}>Revoke</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="card">
        <h2 className="mb-2 font-semibold">My requests</h2>
        {mine.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
          <ul className="space-y-1 text-sm">
            {mine.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${chip(l.status)}`}>{l.status}</span>
                {l.fromDate.slice(0, 10)} → {l.toDate.slice(0, 10)} · {l.reason}
                {l.status === 'PENDING' && <button className="ml-auto text-slate-500 hover:underline" onClick={() => cancel(l.id)}>Cancel</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
