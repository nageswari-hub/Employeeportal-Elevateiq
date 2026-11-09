'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, ROLE_LABEL } from '../../lib/api';
import { uploadAvatar } from '../../lib/files';
import { Avatar, Loading, PageHeader } from '../../components/ui';
import { useAuth } from '../../lib/auth-context';
import { useAvatars } from '../../components/AvatarProvider';
import { useRouter } from 'next/navigation';

export default function ProfilePage() {
  const { user, loading, reload } = useAuth();
  const { refresh } = useAvatars();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    if (typeof window !== 'undefined') setSetup(new URLSearchParams(window.location.search).get('setup') === '1');
  }, [loading, user, router]);
  useEffect(() => { if (user) api('/attendance/mine').then(setStats).catch(() => {}); }, [user]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function pick(file?: File) {
    if (!file) return;
    setErr(''); setMsg('');
    if (!file.type.startsWith('image/')) { setErr('Please choose a photo (JPG, PNG or WebP).'); return; }
    setBusy(true);
    setPreview(URL.createObjectURL(file));
    try {
      await uploadAvatar(file);
      await reload(); refresh();
      setMsg('Photo saved. Your teammates can see it now.');
      if (setup) setTimeout(() => router.replace('/dashboard'), 900);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed');
      setPreview(null);
    } finally { setBusy(false); }
  }

  async function removePhoto() {
    if (!confirm('Remove your photo?')) return;
    setBusy(true); setErr('');
    try { await api('/avatars/me', { method: 'DELETE' }); await reload(); refresh(); setPreview(null); setMsg('Photo removed.'); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <Loading />;
  const s = stats?.summary;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My profile" sub={setup ? 'One last step: add a clear photo of your face so your team can recognise you.' : 'Your photo is shown next to your name across TeamFlow.'} />
      {setup && <div className="mb-5 rounded-2xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-700"><b>Welcome, {user.displayName.split(' ')[0]}!</b> A profile photo is required before you continue. It takes ten seconds.</div>}
      {err && <p className="err mb-4" role="alert">{err}</p>}
      {msg && <p className="ok mb-4" role="status">{msg}</p>}

      <div className="card">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <div className="relative">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Your new photo" className="h-36 w-36 rounded-full object-cover ring-4 ring-white shadow-lg" />
            ) : <div className="rounded-full ring-4 ring-white shadow-lg"><Avatar userId={user.id} name={user.displayName} size={144} /></div>}
            {busy && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-white/70 text-sm font-semibold text-ink-900">Saving…</span>}
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-xl font-bold text-ink-900">{user.displayName}</h2>
            <p className="text-sm text-slate-500">{user.email}</p>
            <p className="mt-1"><span className="rounded-md bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-700">{ROLE_LABEL[user.role]}</span></p>
            <input ref={input} type="file" accept="image/*" capture="user" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
              <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{user.avatarFileId ? 'Change photo' : 'Upload photo'}</button>
              {user.avatarFileId && <button className="btn-secondary" disabled={busy} onClick={removePhoto}>Remove</button>}
            </div>
            <ul className="mt-4 space-y-1 text-xs text-slate-500">
              <li>• Use a clear, front-facing photo of yourself (no logos or group shots).</li>
              <li>• It is cropped to a square and resized automatically; the location data in phone photos is removed.</li>
            </ul>
          </div>
        </div>
      </div>

      {s && (
        <div className="card mt-5">
          <div className="mb-3 flex items-center"><h2 className="h2 !mb-0">This month’s attendance</h2><Link href="/attendance" className="ml-auto text-sm font-semibold text-accent-600 hover:underline">Open attendance →</Link></div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Present', s.present], ['Late', s.late], ['On leave', s.leave], ['Absent', s.absent]].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-slate-50 p-3 text-center"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt><dd className="text-2xl font-bold text-ink-900">{v}</dd></div>
            ))}
          </dl>
        </div>
      )}
      <p className="mt-5 text-center text-sm"><Link href="/change-password" className="font-semibold text-accent-600 hover:underline">Change my password</Link></p>
    </div>
  );
}
