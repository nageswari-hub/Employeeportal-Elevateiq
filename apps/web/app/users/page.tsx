'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, downloadText, ROLE_LABEL } from '../../lib/api';
import { Avatar, Empty, Loading, Modal, PageHeader } from '../../components/ui';
import { HrSupportButton } from '../../components/Workplace';
import { useRequireAuth } from '../../lib/auth-context';

interface Ref { id: string; name: string }
interface U {
  id: string; email: string; displayName: string; role: string; isActive: boolean;
  teamId: string | null; batchId: string | null; team?: Ref | null; batch?: Ref | null;
}
interface Cred { email: string; displayName?: string; tempPassword: string; role?: string; team?: string | null; batch?: string | null }

const PAGE = 25;

function CredentialCard({ c, onClose }: { c: Cred; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Email: ${c.email}\nTemporary password: ${c.tempPassword}\n(You will be asked to choose a new password at first sign-in.)`;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Copy this now. It is shown only once.</p>
        <p className="mt-1 text-amber-800">Share it privately with {c.displayName ?? c.email}. They must change it at first sign-in.</p>
      </div>
      <dl className="rounded-2xl bg-slate-50 p-4 text-sm">
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</dt>
        <dd className="mb-3 font-medium text-ink-900">{c.email}</dd>
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Temporary password</dt>
        <dd className="font-mono text-lg font-bold tracking-wider text-ink-900">{c.tempPassword}</dd>
      </dl>
      <div className="flex gap-2">
        <button className="btn" onClick={async () => { await navigator.clipboard?.writeText(text); setCopied(true); }}>{copied ? 'Copied ✓' : 'Copy details'}</button>
        <button className="btn-secondary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { user, loading } = useRequireAuth(['ADMIN', 'TEAM_LEAD']);
  const isAdmin = user?.role === 'ADMIN';
  const [rows, setRows] = useState<U[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [teams, setTeams] = useState<Ref[]>([]);
  const [batches, setBatches] = useState<Ref[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(true);

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [fRole, setFRole] = useState('');
  const [fTeam, setFTeam] = useState('');
  const [fActive, setFActive] = useState('');
  const [page, setPage] = useState(1);

  const [modal, setModal] = useState<null | 'add' | 'edit' | 'bulk'>(null);
  const [edit, setEdit] = useState<U | null>(null);
  const [cred, setCred] = useState<Cred | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '', role: 'EMPLOYEE', teamId: '', batchId: '', password: '' });

  // bulk import
  const [paste, setPaste] = useState('');
  const [bulkResult, setBulkResult] = useState<null | { created: Cred[]; skipped: { email: string; reason: string }[] }>(null);

  const roleOptions = isAdmin ? ['EMPLOYEE', 'COORDINATOR', 'TEAM_LEAD', 'ADMIN'] : ['EMPLOYEE', 'COORDINATOR'];

  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: String(PAGE) });
      if (q) p.set('search', q);
      if (fRole) p.set('role', fRole);
      if (fTeam) p.set('teamId', fTeam);
      if (fActive) p.set('active', fActive);
      const r = await api<{ data: U[]; meta: { total: number; page: number; totalPages: number } }>(`/users?${p}`);
      setRows(r.data); setMeta(r.meta); setErr('');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Load failed');
    } finally { setFetching(false); }
  }, [page, q, fRole, fTeam, fActive]);

  useEffect(() => { if (user) load(); }, [user, load]);
  useEffect(() => {
    if (!user) return;
    api<Ref[]>('/teams').then(setTeams).catch(() => {});
    api<Ref[]>('/batches').then(setBatches).catch(() => {});
  }, [user]);

  // Opened from the "password reset requested" notification: /users?focus=<id>
  useEffect(() => {
    if (!user) return;
    const id = new URLSearchParams(window.location.search).get('focus');
    if (id) api<U>(`/users/${id}`).then((u) => { setEdit(u); setModal('edit'); }).catch(() => {});
  }, [user]);

  const openAdd = () => {
    setForm({ email: '', displayName: '', role: 'EMPLOYEE', teamId: isAdmin ? '' : user?.teamId ?? '', batchId: '', password: '' });
    setCred(null); setErr(''); setModal('add');
  };
  const openEdit = (u: U) => { setEdit(u); setCred(null); setErr(''); setModal('edit'); };
  const close = () => { setModal(null); setEdit(null); setCred(null); setBulkResult(null); setPaste(''); };

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body: any = { email: form.email.trim(), displayName: form.displayName.trim(), role: form.role };
      if (form.teamId) body.teamId = form.teamId;
      if (form.batchId) body.batchId = form.batchId;
      if (form.password) body.password = form.password;
      const r = await api<U & { tempPassword?: string }>('/users', { method: 'POST', body });
      if (r.tempPassword) setCred({ email: r.email, displayName: r.displayName, tempPassword: r.tempPassword });
      else close();
      await load();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Create failed'); }
    finally { setBusy(false); }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return; setBusy(true); setErr('');
    try {
      await api(`/users/${edit.id}`, { method: 'PATCH', body: { displayName: edit.displayName.trim(), role: edit.role, teamId: edit.teamId || null, batchId: edit.batchId || null } });
      close(); await load();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  async function toggleActive(u: U) {
    if (u.isActive && !confirm(`Deactivate ${u.displayName}? They will be signed out immediately.`)) return;
    setErr('');
    try { await api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }); await load(); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Update failed'); }
  }

  async function resetPw(u: U) {
    if (!confirm(`Issue a new temporary password for ${u.displayName}? Their current password stops working and they are signed out.`)) return;
    setErr('');
    try {
      const r = await api<Cred>(`/users/${u.id}/reset-password`, { method: 'POST' });
      setEdit(u); setModal('edit'); setCred(r);
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Reset failed'); }
  }

  // Parse pasted spreadsheet rows: email, name, [role], [team], [batch]  (comma or tab separated; header row optional)
  const parsed = useMemo(() => {
    const out: { email: string; displayName: string; role?: string; team?: string; batch?: string }[] = [];
    const bad: string[] = [];
    for (const line of paste.split(/\r?\n/)) {
      const t = line.trim(); if (!t) continue;
      const c = t.split(/\t|,|;/).map((x) => x.trim());
      if (/^email$/i.test(c[0])) continue;
      const roleRaw = (c[2] || '').toUpperCase().replace(/\s+/g, '_');
      const role = roleRaw === 'LEAD' ? 'TEAM_LEAD' : roleRaw;
      if (!/^\S+@\S+\.\S+$/.test(c[0] || '') || !c[1]) { bad.push(t); continue; }
      if (role && !['EMPLOYEE', 'COORDINATOR', 'TEAM_LEAD'].includes(role)) { bad.push(t); continue; }
      out.push({ email: c[0].toLowerCase(), displayName: c[1], ...(role ? { role } : {}), ...(c[3] ? { team: c[3] } : {}), ...(c[4] ? { batch: c[4] } : {}) });
    }
    return { out, bad };
  }, [paste]);

  async function runBulk() {
    setBusy(true); setErr('');
    try {
      const r = await api<{ created: Cred[]; skipped: { email: string; reason: string }[] }>('/users/bulk', { method: 'POST', body: { rows: parsed.out } });
      setBulkResult(r); await load();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Import failed'); }
    finally { setBusy(false); }
  }

  const downloadCreds = () => {
    if (!bulkResult) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Name', 'Email', 'Role', 'Team', 'Batch', 'Temporary password'].join(',')]
      .concat(bulkResult.created.map((c) => [c.displayName, c.email, c.role, c.team, c.batch, c.tempPassword].map(esc).join(',')));
    downloadText(`teamflow-new-users-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
  };

  if (loading || !user) return <Loading />;
  return (
    <div>
      <PageHeader title="People" sub={`${meta.total} ${meta.total === 1 ? 'person' : 'people'} · deactivate leavers, never delete`}>
        <button className="btn-secondary" onClick={() => { setBulkResult(null); setPaste(''); setErr(''); setModal('bulk'); }}>Import from spreadsheet</button>
        <button className="btn" onClick={openAdd}>+ Add person</button>
      </PageHeader>
      {err && modal === null && <p className="err mb-4" role="alert">{err}</p>}

      <div className="card mb-4 !p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input className="input" type="search" placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
          <select className="input" value={fRole} onChange={(e) => { setFRole(e.target.value); setPage(1); }} aria-label="Filter by role">
            <option value="">All roles</option>
            {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input" value={fTeam} onChange={(e) => { setFTeam(e.target.value); setPage(1); }} aria-label="Filter by team">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="input" value={fActive} onChange={(e) => { setFActive(e.target.value); setPage(1); }} aria-label="Filter by status">
            <option value="">Active and inactive</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </select>
        </div>
      </div>

      <div className="card table-wrap !p-2">
        {fetching && rows.length === 0 ? <Loading /> : rows.length === 0 ? <Empty text="No one matches these filters." /> : (
          <table>
            <thead><tr><th>Person</th><th>Role</th><th>Team</th><th>Batch</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td><div className="flex items-center gap-3"><Avatar userId={u.id} name={u.displayName} size={34} /><div><p className="font-medium text-ink-900">{u.displayName}</p><p className="text-xs text-slate-400">{u.email}</p></div></div></td>
                  <td><span className="rounded-md bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-700">{ROLE_LABEL[u.role] ?? u.role}</span></td>
                  <td className="text-slate-600">{u.team?.name ?? <span className="text-amber-600">Unassigned</span>}</td>
                  <td className="text-slate-600">{u.batch?.name ?? '—'}</td>
                  <td><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${u.isActive ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{u.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td className="whitespace-nowrap text-right">
                    <HrSupportButton teamId={u.teamId} teamName={u.team?.name} />
                    <button className="btn-ghost !text-xs" onClick={() => openEdit(u)}>Edit</button>
                    <button className="btn-ghost !text-xs" onClick={() => resetPw(u)}>Reset password</button>
                    <button className="btn-ghost !text-xs" onClick={() => toggleActive(u)} disabled={u.id === user.id}>{u.isActive ? 'Deactivate' : 'Activate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button>
          <span className="text-slate-500">Page {meta.page} of {meta.totalPages}</span>
          <button className="btn-secondary" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}

      {/* Add */}
      <Modal open={modal === 'add'} onClose={close} title={cred ? 'Account created' : 'Add a person'}>
        {cred ? <CredentialCard c={cred} onClose={close} /> : (
          <form onSubmit={create} className="space-y-3">
            {err && <p className="err" role="alert">{err}</p>}
            <div><label className="label">Full name</label><input className="input" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></div>
            <div><label className="label">Work email</label><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Role</label>
                <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
              <div><label className="label">Team</label>
                <select className="input" value={form.teamId} disabled={!isAdmin} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
                  <option value="">{isAdmin ? 'No team yet' : 'Your team'}</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            </div>
            <div><label className="label">Batch (interns / trainees)</label>
              <select className="input" value={form.batchId} onChange={(e) => setForm({ ...form, batchId: e.target.value })}><option value="">No batch</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            <div><label className="label">Password <span className="font-normal normal-case text-slate-400">(leave blank to generate one)</span></label>
              <input className="input" type="text" minLength={8} autoComplete="off" placeholder="Auto-generated and shown once" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <button className="btn w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          </form>
        )}
      </Modal>

      {/* Edit (+ credential after reset) */}
      <Modal open={modal === 'edit' && !!edit} onClose={close} title={cred ? 'New temporary password' : `Edit ${edit?.displayName ?? ''}`}>
        {cred ? <CredentialCard c={{ ...cred, displayName: edit?.displayName }} onClose={close} /> : edit && (
          <form onSubmit={saveEdit} className="space-y-3">
            {err && <p className="err" role="alert">{err}</p>}
            <div><label className="label">Full name</label><input className="input" required value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} /></div>
            <p className="text-xs text-slate-400">{edit.email}</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Role</label>
                <select className="input" value={edit.role} disabled={edit.id === user.id} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                  {(roleOptions.includes(edit.role) ? roleOptions : [edit.role, ...roleOptions]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
              <div><label className="label">Team</label>
                <select className="input" value={edit.teamId ?? ''} onChange={(e) => setEdit({ ...edit, teamId: e.target.value || null })}>
                  <option value="">No team</option>
                  {teams.filter((t) => isAdmin || t.id === user.teamId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            </div>
            <div><label className="label">Batch</label>
              <select className="input" value={edit.batchId ?? ''} onChange={(e) => setEdit({ ...edit, batchId: e.target.value || null })}><option value="">No batch</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            <p className="text-xs text-amber-600">Changing role or team signs this person out so the new access applies at once.</p>
            <div className="flex gap-2">
              <button className="btn flex-1" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
              <button type="button" className="btn-secondary" onClick={() => resetPw(edit)}>Reset password</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Bulk import */}
      <Modal open={modal === 'bulk'} onClose={close} title={bulkResult ? 'Import finished' : 'Import people from a spreadsheet'}>
        {bulkResult ? (
          <div className="space-y-4">
            <p className="ok">{bulkResult.created.length} account{bulkResult.created.length === 1 ? '' : 's'} created.</p>
            {bulkResult.created.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">Download the passwords now. They are not stored and cannot be shown again.</p>
                <button className="btn mt-3" onClick={downloadCreds}>Download credentials (CSV)</button>
              </div>
            )}
            {bulkResult.skipped.length > 0 && (
              <div><p className="label">Skipped ({bulkResult.skipped.length})</p>
                <ul className="max-h-40 overflow-y-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{bulkResult.skipped.map((s) => <li key={s.email}><b>{s.email}</b>: {s.reason}</li>)}</ul></div>
            )}
            <button className="btn-secondary w-full" onClick={close}>Close</button>
          </div>
        ) : (
          <div className="space-y-3">
            {err && <p className="err" role="alert">{err}</p>}
            <p className="text-sm text-slate-600">Paste rows copied from Excel or Google Sheets. One person per line:</p>
            <code className="block rounded-xl bg-slate-50 p-3 text-xs text-slate-600">email, full name, role (optional), team name (optional), batch name (optional)</code>
            <textarea className="input h-44 font-mono text-xs" placeholder={'asha@company.com, Asha Rao, employee, Web Team, Oct 2026 Batch\nravi@company.com, Ravi Kumar'} value={paste} onChange={(e) => setPaste(e.target.value)} />
            <p className="text-xs text-slate-500">
              <b>{parsed.out.length}</b> ready{parsed.bad.length > 0 && <> · <span className="text-red-600">{parsed.bad.length} line{parsed.bad.length > 1 ? 's' : ''} cannot be read</span></>}.
              Roles: employee, coordinator{isAdmin ? ', lead' : ''}. Team and batch names must already exist. Up to 300 per import.
            </p>
            {parsed.bad.length > 0 && <ul className="max-h-24 overflow-y-auto rounded-xl bg-red-50 p-3 text-xs text-red-700">{parsed.bad.slice(0, 10).map((b, i) => <li key={i}>{b}</li>)}</ul>}
            <button className="btn w-full" disabled={busy || parsed.out.length === 0 || parsed.out.length > 300} onClick={runBulk}>{busy ? 'Creating accounts…' : `Create ${parsed.out.length} account${parsed.out.length === 1 ? '' : 's'}`}</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
