'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, timeAgo } from '../../lib/api';
import { Empty, Loading, PageHeader } from '../../components/ui';
import { useRequireAuth } from '../../lib/auth-context';

interface Row {
  id: string; action: string; entity: string; entityId: string | null; ip: string | null; createdAt: string;
  metadata: Record<string, unknown> | null; actor: { displayName: string; email: string } | null;
}

const TONE = (a: string) => (/DEACTIVATE|REUSE|RESET|PASSWORD/.test(a) ? 'bg-amber-50 text-amber-800' : /DELETE/.test(a) ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700');

export default function AuditPage() {
  const { user, loading } = useRequireAuth(['ADMIN']);
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: '50' });
      if (action.trim()) p.set('action', action.trim());
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const r = await api<{ data: Row[]; meta: typeof meta }>(`/admin/audit?${p}`);
      setRows(r.data); setMeta(r.meta); setErr('');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Load failed'); }
    finally { setBusy(false); }
  }, [page, action, from, to]);

  useEffect(() => { if (!user) return; const t = setTimeout(load, action ? 300 : 0); return () => clearTimeout(t); }, [user, load, action]);

  if (loading || !user) return <Loading />;
  return (
    <div>
      <PageHeader title="Audit log" sub={`${meta.total.toLocaleString()} recorded actions · who did what, when and from where`} />
      {err && <p className="err mb-4" role="alert">{err}</p>}
      <div className="card mb-4 !p-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <input className="input" placeholder="Filter by action (e.g. LOGIN, USER_)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action filter" />
          <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" />
          <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" />
        </div>
      </div>
      <div className="card table-wrap !p-2">
        {busy && rows.length === 0 ? <Loading /> : rows.length === 0 ? <Empty icon="🔎" text="No matching entries." /> : (
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap text-slate-500" title={new Date(r.createdAt).toLocaleString()}>{timeAgo(r.createdAt)}</td>
                  <td>{r.actor ? <><p className="font-medium text-ink-900">{r.actor.displayName}</p><p className="text-xs text-slate-400">{r.actor.email}</p></> : <span className="text-slate-400">system</span>}</td>
                  <td><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${TONE(r.action)}`}>{r.action}</span></td>
                  <td className="text-xs text-slate-500">{r.entity}{r.metadata && Object.keys(r.metadata).length > 0 && <p className="max-w-xs truncate text-slate-400" title={JSON.stringify(r.metadata)}>{JSON.stringify(r.metadata)}</p>}</td>
                  <td className="font-mono text-xs text-slate-400">{r.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</button>
          <span className="text-slate-500">Page {meta.page} of {meta.totalPages}</span>
          <button className="btn-secondary" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Older →</button>
        </div>
      )}
    </div>
  );
}
