'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ROLE_LABEL } from '../lib/api';
import { useAuth } from '../lib/auth-context';

interface Cmd { id: string; label: string; hint?: string; group: string; run: () => void }

const PAGES: { href: string; label: string; roles?: string[]; keys: string }[] = [
  { href: '/dashboard', label: 'Dashboard', keys: 'home overview' },
  { href: '/tasks', label: 'Tasks', keys: 'board work todo' },
  { href: '/projects', label: 'Projects', keys: 'initiative workstream progress' },
  { href: '/tickets', label: 'Issues & escalations', keys: 'ticket issue help escalate support' },
  { href: '/attendance', label: 'Attendance', keys: 'check in out break present absent late' },
  { href: '/profile', label: 'My profile & photo', keys: 'picture avatar photo' },
  { href: '/reports', label: 'Daily report', keys: 'submit update standup' },
  { href: '/goals', label: 'Goals', keys: 'okr weekly' },
  { href: '/channels', label: 'Workspace', keys: 'message channel talk' },
  { href: '/announcements', label: 'Announcements', keys: 'news notice' },
  { href: '/teams', label: 'Teams', roles: ['ADMIN', 'TEAM_LEAD', 'COORDINATOR'], keys: 'group' },
  { href: '/users', label: 'People', roles: ['ADMIN', 'TEAM_LEAD'], keys: 'users add import reset password' },
  { href: '/settings', label: 'Settings', roles: ['ADMIN'], keys: 'deadline holidays working days' },
  { href: '/audit', label: 'Audit log', roles: ['ADMIN'], keys: 'history security activity' },
  { href: '/change-password', label: 'Change my password', keys: 'security' },
];

/** Ctrl/Cmd + K: jump anywhere or find a task / person in two keystrokes. */
export function CommandPalette() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [tasks, setTasks] = useState<{ id: string; title: string; owner?: { displayName: string } }[]>([]);
  const [people, setPeople] = useState<{ id: string; displayName: string; role: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', h);
    const ev = () => setOpen(true);
    window.addEventListener('tf:palette', ev);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('tf:palette', ev); };
  }, []);

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);

  // live search (debounced) once at least 2 characters are typed
  useEffect(() => {
    if (!open || !user || q.trim().length < 2) { setTasks([]); setPeople([]); return; }
    const t = setTimeout(() => {
      api<{ data: any[] }>(`/tasks?limit=5&search=${encodeURIComponent(q.trim())}`).then((r) => setTasks(r.data)).catch(() => setTasks([]));
      if (user.role !== 'EMPLOYEE') api<{ data: any[] }>(`/users?limit=5&search=${encodeURIComponent(q.trim())}`).then((r) => setPeople(r.data)).catch(() => setPeople([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, user]);

  const cmds = useMemo<Cmd[]>(() => {
    if (!user) return [];
    const go = (href: string) => () => { setOpen(false); router.push(href); };
    const needle = q.trim().toLowerCase();
    const pages: Cmd[] = PAGES.filter((p) => !p.roles || p.roles.includes(user.role) || user.role === 'ADMIN')
      .filter((p) => !needle || `${p.label} ${p.keys}`.toLowerCase().includes(needle))
      .map((p) => ({ id: p.href, label: p.label, group: 'Go to', run: go(p.href) }));
    const t: Cmd[] = tasks.map((x) => ({ id: `t${x.id}`, label: x.title, hint: x.owner?.displayName, group: 'Tasks', run: go(`/tasks/${x.id}`) }));
    const pe: Cmd[] = people.map((x) => ({ id: `p${x.id}`, label: x.displayName, hint: ROLE_LABEL[x.role], group: 'People', run: go(`/users?focus=${x.id}`) }));
    const acts: Cmd[] = [];
    if (!needle || 'sign out log out'.includes(needle)) acts.push({ id: 'logout', label: 'Sign out', group: 'Actions', run: () => { setOpen(false); logout(); } });
    return [...t, ...pe, ...pages, ...acts];
  }, [user, q, tasks, people, router, logout]);

  useEffect(() => setSel(0), [q]);

  if (!open || !user) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(cmds.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); cmds[sel]?.run(); }
  };
  let last = '';
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-ink-900/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} className="w-full border-b border-slate-200 px-5 py-4 text-base outline-none placeholder:text-slate-400" placeholder="Search tasks, people, pages…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} aria-label="Search" />
        <ul className="max-h-[50vh] overflow-y-auto py-2">
          {cmds.length === 0 && <li className="px-5 py-6 text-center text-sm text-slate-500">Nothing found.</li>}
          {cmds.map((c, i) => {
            const head = c.group !== last ? (last = c.group) : null;
            return (
              <li key={c.id}>
                {head && <p className="px-5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{head}</p>}
                <button className={`flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm ${i === sel ? 'bg-accent-50 text-accent-700' : 'text-slate-700 hover:bg-slate-50'}`} onMouseEnter={() => setSel(i)} onClick={c.run}>
                  <span className="truncate font-medium">{c.label}</span>
                  {c.hint && <span className="ml-auto shrink-0 text-xs text-slate-400">{c.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="hidden border-t border-slate-100 px-5 py-2 text-[11px] text-slate-400 sm:block">↑↓ to move · Enter to open · Esc to close</p>
      </div>
    </div>
  );
}
