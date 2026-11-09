'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError, fmtDate, STATUS_LABEL, timeAgo } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth-context';
import { getSocket } from '../../../lib/realtime';
import { Avatar, Loading, PriorityBadge, StatusBadge } from '../../../components/ui';
import { AttachButton, AttachmentList, UploadChips, useDropPaste, useUploads } from '../../../components/Attachments';
import type { FileInfo } from '../../../lib/files';

interface Detail {
  id: string; title: string; description: string | null; status: string; priority: string;
  dueDate?: string | null; estimatedHours?: string | number | null;
  recurrence?: string; recurrenceUntil?: string | null; seriesId?: string | null;
  blockedReason: string | null; reviewNote: string | null;
  project?: { id: string; name: string } | null;
  owner: { id: string; displayName: string };
  teamId?: string | null;
  files?: FileInfo[];
  comments: Array<{ id: string; body: string; author: { id: string; displayName: string }; createdAt: string; files?: FileInfo[] }>;
  activities: Array<{ id: string; action: string; fromStatus: string | null; toStatus: string | null; createdAt: string }>;
}

const NEXT: Record<string, string[]> = {
  TODO: ['IN_PROGRESS', 'BLOCKED'],
  IN_PROGRESS: ['IN_REVIEW', 'BLOCKED', 'TODO'],
  IN_REVIEW: ['IN_PROGRESS', 'BLOCKED'],
  BLOCKED: ['IN_PROGRESS', 'TODO'],
  DONE: [],
};
const STEPS = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];

export default function TaskDetailPage() {
  const { user, loading } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const [task, setTask] = useState<Detail | null>(null);
  const [err, setErr] = useState('');
  const [comment, setComment] = useState('');
  const [blockedReason, setBlockedReason] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [askBlock, setAskBlock] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const taskFiles = useUploads('TASK', params.id);
  const commentFiles = useUploads('COMMENT', params.id);
  const dropTask = useDropPaste((f) => { void taskFiles.add(f); });

  async function load() {
    try { setTask(await api<Detail>(`/tasks/${params.id}`)); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Load failed'); }
  }
  useEffect(() => { if (user) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  // Live comments via Socket.io (page still works without it)
  useEffect(() => {
    if (!user || !task) return;
    const s = getSocket();
    s.emit('joinTask', { taskId: task.id });
    const onComment = (c: any) => { if (c.taskId === task.id) load(); };
    // Status changes by someone else (e.g. lead approves) appear instantly, no manual refresh.
    const onUpdated = (u: any) => { if (u?.id === task.id) load(); };
    s.on('comment:added', onComment);
    s.on('task:updated', onUpdated);
    return () => { s.off('comment:added', onComment); s.off('task:updated', onUpdated); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, task?.id]);

  async function setStatus(status: string) {
    setErr('');
    try {
      await api(`/tasks/${params.id}/status`, { method: 'PATCH', body: {
        status,
        blockedReason: status === 'BLOCKED' ? blockedReason : undefined,
        reviewNote: reviewNote || undefined,
      } });
      setAskBlock(false); setBlockedReason(''); setReviewNote('');
      await load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Update failed'); }
  }

  // Task-level files attach to the task the moment they finish uploading
  useEffect(() => {
    if (taskFiles.items.length && !taskFiles.busy && taskFiles.items.every((i) => i.status !== 'uploading')) {
      if (taskFiles.items.some((i) => i.status === 'done')) { load().then(() => taskFiles.reset()); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskFiles.busy, taskFiles.items.length]);

  async function stopSeries() {
    if (!task || !confirm('Stop this repeat? Future occurrences will be removed.')) return;
    setErr('');
    try { await api(`/tasks/${params.id}/series`, { method: 'DELETE' }); await load(); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Could not stop the repeat'); }
  }

  async function removeAttachment(f: FileInfo) {
    if (!confirm(`Remove "${f.name}" from this task?`)) return;
    try { await api(`/tasks/${params.id}/attachments/${f.id}`, { method: 'DELETE' }); await load(); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Could not remove file'); }
  }

  async function sendComment(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      if (commentFiles.busy) { setErr('Please wait for the files to finish uploading.'); return; }
      await api(`/tasks/${params.id}/comments`, { method: 'POST', body: { body: comment.trim() || undefined, fileIds: commentFiles.fileIds } });
      setComment(''); commentFiles.reset();
      await load();
      end.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Comment failed'); }
  }

  if (loading || !user) return <Loading />;
  if (err && !task) return <p className="err">{err}</p>;
  if (!task) return <Loading />;

  const isLead = user.role === 'ADMIN' || user.role === 'TEAM_LEAD';
  const canPlan = user.role === 'ADMIN' || ((user.role === 'TEAM_LEAD' || user.role === 'COORDINATOR') && !!task.teamId && task.teamId === user.teamId);
  const options = [...(NEXT[task.status] ?? []), ...(isLead && task.status !== 'DONE' ? ['DONE'] : [])];
  const stepIdx = STEPS.indexOf(task.status);
  const reviewing = isLead && task.status === 'IN_REVIEW';

  return (
    <div className="space-y-5">
      <Link href="/tasks" className="text-sm font-medium text-slate-500 hover:text-brand-600">← Back to tasks</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{task.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <StatusBadge status={task.status} /><PriorityBadge priority={task.priority} />
            <span className="flex items-center gap-1.5"><Avatar userId={task.owner.id} name={task.owner.displayName} size={22} />{task.owner.displayName}</span>
            {task.dueDate && <span>Due {fmtDate(task.dueDate)}</span>}
            {task.project && <Link href={`/projects/${task.project.id}`} className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:text-brand-600">{task.project.name}</Link>}
            {task.recurrence && task.recurrence !== 'NONE' && (
              <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                Repeats {task.recurrence.toLowerCase()}{task.recurrenceUntil ? ` until ${fmtDate(task.recurrenceUntil)}` : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {task.status !== 'BLOCKED' && (
        <div className="card !py-4"><ol className="flex items-center">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center last:flex-none">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${i <= stepIdx ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{i < stepIdx ? '✓' : i + 1}</span>
              <span className={`ml-2 hidden text-sm sm:inline ${i <= stepIdx ? 'font-semibold text-ink-900' : 'text-slate-400'}`}>{STATUS_LABEL[s]}</span>
              {i < STEPS.length - 1 && <span className={`mx-3 h-0.5 flex-1 rounded ${i < stepIdx ? 'bg-brand-600' : 'bg-slate-200'}`} />}
            </li>
          ))}
        </ol></div>
      )}
      {err && <p className="err">{err}</p>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="card">
            <h2 className="h2">Details</h2>
            {task.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{task.description}</p> : <p className="text-sm text-slate-400">No description.</p>}
            {task.blockedReason && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><b>⛔ Blocked:</b> {task.blockedReason}</div>}
            {task.reviewNote && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><b>📝 Lead note:</b> {task.reviewNote}</div>}
          </div>

          <div className="card" {...dropTask.bind}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="h2 !mb-0">Files <span className="text-sm font-normal text-slate-400">({task.files?.length ?? 0})</span></h2>
              <span className="ml-auto"><AttachButton label="Attach files to this task" onFiles={(f) => { void taskFiles.add(f); }} /></span>
            </div>
            {dropTask.dragging && <p className="mb-2 rounded-xl border-2 border-dashed border-accent-600 bg-accent-50 p-4 text-center text-sm font-semibold text-accent-700">Drop to attach to this task</p>}
            <UploadChips items={taskFiles.items} onRemove={taskFiles.remove} onRetry={taskFiles.retry} />
            {task.files?.length ? <AttachmentList files={task.files} onDelete={removeAttachment} /> : !taskFiles.items.length && <p className="text-sm text-slate-400">No files yet. Attach briefs, screenshots, documents, anything.</p>}
          </div>

          <div className="card">
            <h2 className="h2">Comments <span className="text-sm font-normal text-slate-400">({task.comments.length})</span></h2>
            <ul className="mb-4 space-y-4">
              {task.comments.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <Avatar userId={c.author.id} name={c.author.displayName} size={34} />
                  <div className="flex-1 rounded-2xl rounded-tl-sm bg-slate-50 px-4 py-2.5">
                    <p className="text-sm"><b className="text-ink-900">{c.author.displayName}</b> <span className="text-xs text-slate-400">{timeAgo(c.createdAt)}</span></p>
                    {c.body && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700">{c.body}</p>}
                    <AttachmentList files={c.files} compact />
                  </div>
                </li>
              ))}
              {task.comments.length === 0 && <p className="text-sm text-slate-400">No comments yet. Ask a question or share an update.</p>}
            </ul>
            <div ref={end} />
            <form onSubmit={sendComment} className="space-y-2">
              <UploadChips items={commentFiles.items} onRemove={commentFiles.remove} onRetry={commentFiles.retry} />
              <div className="flex items-center gap-2">
                <AttachButton onFiles={(f) => { void commentFiles.add(f); }} />
                <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" maxLength={5000} />
                <button className="btn" disabled={commentFiles.busy || (!comment.trim() && !commentFiles.fileIds.length)}>{commentFiles.busy ? 'Uploading…' : 'Send'}</button>
              </div>
            </form>
          </div>
        </div>

        <div className="space-y-5">
          {task.seriesId && task.recurrence && task.recurrence !== 'NONE' && canPlan && (
            <div className="card">
              <h2 className="h2">Recurring task</h2>
              <p className="mb-3 text-sm text-slate-500">Editing affects this occurrence only. Stop the series to remove future occurrences.</p>
              <button className="btn-secondary w-full !border-amber-200 !text-amber-700 hover:!bg-amber-50" onClick={stopSeries}>Stop future repeats</button>
            </div>
          )}
          <div className="card">
            <h2 className="h2">Update status</h2>
            {task.status === 'DONE' && !isLead ? (
              <p className="text-sm text-slate-500">✅ Done. Only your lead can reopen it.</p>
            ) : options.length === 0 ? <p className="text-sm text-slate-500">No further actions.</p> : (
              <div className="space-y-2">
                {reviewing && <textarea className="input" rows={2} placeholder="Note to the owner (used when sending back)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />}
                {options.map((s) => {
                  const primary = s === 'DONE' || (s === 'IN_PROGRESS' && task.status === 'TODO') || (s === 'IN_REVIEW');
                  if (s === 'BLOCKED') return <button key={s} className="btn-secondary w-full !border-red-200 !text-red-600 hover:!bg-red-50" onClick={() => setAskBlock(true)}>⛔ Mark as blocked</button>;
                  return <button key={s} className={primary ? 'btn w-full' : 'btn-secondary w-full'} onClick={() => setStatus(s)}>
                    {s === 'DONE' ? '✓ Approve & mark done' : s === 'IN_PROGRESS' && task.status === 'IN_REVIEW' ? '↩ Send back to in progress' : s === 'IN_PROGRESS' && task.status === 'BLOCKED' ? '✅ Unblock — continue' : s === 'IN_REVIEW' ? '📤 Submit for review' : s === 'IN_PROGRESS' ? '▶ Start working' : `Move to ${STATUS_LABEL[s]}`}
                  </button>;
                })}
                {askBlock && (
                  <div className="rounded-xl border border-red-200 bg-red-50/60 p-3">
                    <label className="label !text-red-700">Why are you blocked?</label>
                    <input className="input" autoFocus value={blockedReason} onChange={(e) => setBlockedReason(e.target.value)} placeholder="e.g. waiting on VPN access" />
                    <div className="mt-2 flex gap-2"><button className="btn !bg-red-600 hover:!bg-red-700 flex-1" disabled={!blockedReason.trim()} onClick={() => setStatus('BLOCKED')}>Confirm</button><button className="btn-secondary" onClick={() => setAskBlock(false)}>Cancel</button></div>
                    <p className="mt-2 text-xs text-slate-500">Your Team Lead and Coordinator are notified.</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="card">
            <h2 className="h2">Activity</h2>
            <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
              {task.activities.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-accent-600" />
                  <p className="text-sm text-slate-700">{a.action.replace(/_/g, ' ').toLowerCase()}{(a.fromStatus || a.toStatus) && <span className="text-slate-400"> · {a.fromStatus ? STATUS_LABEL[a.fromStatus] : ''} → {a.toStatus ? STATUS_LABEL[a.toStatus] : ''}</span>}</p>
                  <p className="text-xs text-slate-400">{timeAgo(a.createdAt)}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
