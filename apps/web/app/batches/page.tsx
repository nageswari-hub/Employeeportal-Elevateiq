'use client';
import { Loading } from '../../components/ui';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';

interface Batch {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  durationDays: number;
}

export default function BatchesPage() {
  const { user, loading } = useRequireAuth(['ADMIN', 'TEAM_LEAD']);
  const [rows, setRows] = useState<Batch[]>([]);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [startDate, setStart] = useState('');
  const [endDate, setEnd] = useState('');
  const [durationDays, setDays] = useState('60');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api<Batch[]>('/batches'));
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
      await api('/batches', { method: 'POST', body: { name, startDate, endDate, durationDays: Number(durationDays) } });
      setName('');
      await load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <Loading />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Batches</h1>
      {err && <p className="err">{err}</p>}
      {user.role === 'ADMIN' && (
        <form onSubmit={create} className="card grid gap-2 sm:grid-cols-5">
          <input className="input" required placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" required type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
          <input className="input" required type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
          <input className="input" required type="number" min={1} max={365} value={durationDays} onChange={(e) => setDays(e.target.value)} />
          <button className="btn" disabled={busy}>Create</button>
        </form>
      )}
      <div className="card">
        <ul className="divide-y divide-slate-100">
          {rows.map((b) => (
            <li key={b.id} className="py-2 text-sm">
              <b>{b.name}</b> — {b.startDate.slice(0, 10)} → {b.endDate.slice(0, 10)} ({b.durationDays}d)
            </li>
          ))}
          {rows.length === 0 && <p className="text-sm text-slate-500">No batches yet.</p>}
        </ul>
      </div>
    </div>
  );
}
