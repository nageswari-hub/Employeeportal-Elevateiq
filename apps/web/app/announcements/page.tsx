'use client';
import { useEffect, useState } from 'react';
import { api, ApiError, timeAgo } from '../../lib/api';
import { Empty, Loading, PageHeader } from '../../components/ui';
import { useRequireAuth } from '../../lib/auth-context';
import { AttachButton, AttachmentList, UploadChips, useUploads } from '../../components/Attachments';
import type { FileInfo } from '../../lib/files';

interface A { id: string; title: string; body: string; scope: string; createdAt: string; createdById?: string; files?: FileInfo[] }

export default function AnnouncementsPage() {
  const { user, loading } = useRequireAuth();
  const [rows, setRows] = useState<A[]>([]);
  const [err, setErr] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const up = useUploads('ANNOUNCEMENT');

  async function load() {
    try { setRows(await api<A[]>('/announcements')); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Load failed'); }
  }
  useEffect(() => { if (user) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (up.busy) { setErr('Please wait for the files to finish uploading.'); return; }
    setErr(''); setBusy(true);
    try {
      const scope = user?.role === 'ADMIN' ? 'COMPANY' : 'TEAM';
      await api('/announcements', { method: 'POST', body: { title: title.trim(), body: body.trim(), scope, fileIds: up.fileIds } });
      setTitle(''); setBody(''); up.reset();
      await load();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Post failed'); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this announcement for everyone?')) return;
    try { await api(`/announcements/${id}`, { method: 'DELETE' }); await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Delete failed'); }
  }

  if (loading || !user) return <Loading />;
  const canPost = user.role === 'ADMIN' || user.role === 'TEAM_LEAD' || user.role === 'COORDINATOR';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Announcements" sub="Company and team notices. Everyone affected is notified instantly." />
      {err && <p className="err mb-4" role="alert">{err}</p>}
      {canPost && (
        <form onSubmit={create} className="card mb-5 space-y-3">
          <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={200} aria-label="Title" />
          <textarea className="input" required rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} placeholder={user.role === 'ADMIN' ? 'Company-wide message…' : 'Message to your team…'} aria-label="Message" />
          <UploadChips items={up.items} onRemove={up.remove} onRetry={up.retry} />
          <div className="flex items-center gap-2">
            <AttachButton onFiles={(f) => { void up.add(f); }} label="Attach files (PDF, images, documents, anything)" />
            <span className="text-xs text-slate-400">Attach files if needed</span>
            <button className="btn ml-auto" disabled={busy || up.busy}>{up.busy ? 'Uploading…' : busy ? 'Posting…' : `Post ${user.role === 'ADMIN' ? 'company-wide' : 'to my team'}`}</button>
          </div>
        </form>
      )}
      <div className="space-y-3">
        {rows.map((a) => (
          <article key={a.id} className="card">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="rounded bg-accent-50 px-1.5 py-0.5 font-bold uppercase text-accent-700">{a.scope.toLowerCase()}</span>
              <span title={new Date(a.createdAt).toLocaleString()}>{timeAgo(a.createdAt)}</span>
              {(user.role === 'ADMIN' || a.createdById === user.id) && <button className="ml-auto text-slate-400 hover:text-red-600" onClick={() => remove(a.id)}>Delete</button>}            </div>
            <h2 className="mt-1 text-lg font-semibold text-ink-900">{a.title}</h2>
            <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-700">{a.body}</p>
            <AttachmentList files={a.files} />
          </article>
        ))}
        {rows.length === 0 && <div className="card"><Empty icon="📢" text="No announcements yet." /></div>}
      </div>
    </div>
  );
}
