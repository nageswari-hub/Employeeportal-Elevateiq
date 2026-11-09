'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, timeAgo } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { getSocket } from '../lib/realtime';

interface Notif { id: string; type: string; title: string; link: string | null; isRead: boolean; createdAt: string }

export function NotifBell() {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<{ title: string; link?: string } | null>(null);
  const audio = useRef<AudioContext | null>(null);

  // Browsers only allow audio after a user gesture. Prepare a shared AudioContext on the
  // first tap/keystroke so the chime can play when a realtime notification arrives later.
  useEffect(() => {
    const unlock = () => {
      try {
        if (!audio.current) {
          const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
          if (Ctor) audio.current = new Ctor();
        }
        if (audio.current?.state === 'suspended') void audio.current.resume();
      } catch { /* audio unsupported: ignore */ }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  function chime() {
    try {
      const ctx = audio.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') void ctx.resume();
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      gain.connect(ctx.destination);
      [880, 1174.7].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(now + i * 0.12);
        osc.stop(now + 0.5);
      });
    } catch { /* ignore */ }
  }

  async function refresh() {
    try {
      const r = await api<{ data: Notif[]; unread: number }>('/notifications');
      setUnread(r.unread);
      setItems(r.data.slice(0, 10));
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!user) return;
    refresh();
    // Safety-net poll only while the tab is visible (live pushes do the real work): saves battery and server load.
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    const s = getSocket();
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const onNotify = (p?: { title?: string; link?: string }) => {
      refresh();
      chime();
      if (p?.title) { setToast({ title: p.title, link: p.link }); clearTimeout(toastTimer); toastTimer = setTimeout(() => setToast(null), 6000); }
    };
    const onMsg = () => refresh();
    s.on('notify', onNotify);
    s.on('channel:message', onMsg);
    return () => {
      clearInterval(t); clearTimeout(toastTimer);
      document.removeEventListener('visibilitychange', onVisible);
      s.off('notify', onNotify); s.off('channel:message', onMsg);
    };
  }, [user]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (open && box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  async function readAll() { await api('/notifications/read-all', { method: 'POST' }); refresh(); }
  async function readOne(id: string) { try { await api(`/notifications/${id}/read`, { method: 'POST' }); refresh(); } catch { /* ignore */ } }

  if (!user) return null;
  return (
    <div className="relative" ref={box}>
      <button className="btn-secondary relative !rounded-full !p-2.5" aria-label="Notifications" onClick={() => { setOpen(!open); refresh(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {toast && !open && (
        <div role="status" className="fixed bottom-4 right-4 z-[60] flex max-w-sm items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600" />
          <div className="text-sm">
            <p className="font-semibold text-ink-900">{toast.title}</p>
            {toast.link && <Link href={toast.link} onClick={() => setToast(null)} className="text-xs font-semibold text-accent-600 hover:underline">Open →</Link>}
          </div>
          <button className="text-slate-400 hover:text-slate-600" aria-label="Dismiss" onClick={() => setToast(null)}>✕</button>
        </div>
      )}
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[92vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <b className="text-sm text-ink-900">Notifications</b>
            <button className="text-xs font-semibold text-accent-600 hover:underline" onClick={readAll}>Mark all read</button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">🎉 All caught up.</p>}
            {items.map((n) => {
              const inner = (
                <div className={`flex gap-3 border-b border-slate-50 px-4 py-3 text-sm hover:bg-slate-50 ${n.isRead ? '' : 'bg-accent-50/50'}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.isRead ? 'bg-slate-200' : 'bg-brand-600'}`} />
                  <div><p className="text-slate-800">{n.title}</p><p className="mt-0.5 text-xs text-slate-400">{timeAgo(n.createdAt)}</p></div>
                </div>
              );
              return n.link
                ? <Link key={n.id} href={n.link} onClick={() => { readOne(n.id); setOpen(false); }}>{inner}</Link>
                : <div key={n.id} onClick={() => readOne(n.id)}>{inner}</div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
