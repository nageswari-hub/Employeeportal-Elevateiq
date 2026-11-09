'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { ROLE_LABEL } from '../lib/api';
import { NotifBell } from './NotifBell';
import { Avatar } from './ui';
import { PhotoBanner } from './PhotoBanner';
import { CommandPalette } from './CommandPalette';
import { AttendanceChip } from './AttendanceChip';

const ALL = ['ADMIN', 'TEAM_LEAD', 'COORDINATOR', 'EMPLOYEE'];
const ICONS: Record<string, string> = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  tasks: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  goals: 'M12 22a10 10 0 100-20 10 10 0 000 20zm0-6a4 4 0 100-8 4 4 0 000 8zm0-2a2 2 0 100-4 2 2 0 000 4z',
  training: 'M22 10L12 5 2 10l10 5 10-5zM6 12v5c3 2 9 2 12 0v-5',
  assessments: 'M9 12h6M9 16h6M9 8h6M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z',
  reports: 'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6zM14 3v6h6M8 13h8M8 17h5',
  chat: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  announce: 'M3 11v2a1 1 0 001 1h3l5 4V6L7 10H4a1 1 0 00-1 1zm13-3a5 5 0 010 8',
  teams: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  batches: 'M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  leave: 'M8 2v4M16 2v4M3 8h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  calendar: 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zm3 9h4m-4 4h7',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  audit: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  projects: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  ticket: 'M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4V8zM9 7v10',
  users: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6',
};
const GROUPS: { title: string; items: { href: string; label: string; icon: string; roles: string[] }[] }[] = [
  { title: 'Work', items: [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', roles: ALL },
    { href: '/tasks', label: 'Tasks', icon: 'tasks', roles: ALL },
    { href: '/projects', label: 'Projects', icon: 'projects', roles: ALL },
    { href: '/tickets', label: 'Issues & escalations', icon: 'ticket', roles: ALL },
    { href: '/goals', label: 'Goals', icon: 'goals', roles: ALL },
    { href: '/attendance', label: 'Attendance', icon: 'clock', roles: ALL },
    { href: '/reports', label: 'Daily reports', icon: 'reports', roles: ALL },
    { href: '/leaves', label: 'Leaves', icon: 'leave', roles: ALL },
    { href: '/calendar', label: 'Calendar', icon: 'calendar', roles: ALL },
  ] },
  { title: 'Communicate', items: [
    { href: '/channels', label: 'Workspace', icon: 'chat', roles: ALL },
    { href: '/announcements', label: 'Announcements', icon: 'announce', roles: ALL },
  ] },
  { title: 'Manage', items: [
    { href: '/teams', label: 'Teams', icon: 'teams', roles: ['ADMIN', 'TEAM_LEAD', 'COORDINATOR'] },
    { href: '/users', label: 'People', icon: 'users', roles: ['ADMIN', 'TEAM_LEAD'] },
    { href: '/settings', label: 'Settings', icon: 'settings', roles: ['ADMIN'] },
    { href: '/audit', label: 'Audit log', icon: 'audit', roles: ['ADMIN'] },
  ] },
];

function Icon({ name }: { name: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const bare = path === '/login' || path === '/change-password';
  if (bare || !user) return <>{children}</>;

  const side = (
    <div className="flex h-full flex-col">
      <div className="mx-4 mt-5 rounded-xl bg-white px-3 py-2.5">
        <img src="/logo.png" alt="ElevateIQ" className="h-8 w-auto" />
      </div>
      <p className="mx-5 mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">TeamFlow</p>
      <nav className="mt-3 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {GROUPS.map((g) => {
          const items = g.items.filter((i) => i.roles.includes(user.role));
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-white/40">{g.title}</p>
              {items.map((i) => {
                const active = path === i.href || path.startsWith(i.href + '/');
                return (
                  <Link key={i.href} href={i.href} className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${active ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                    <Icon name={i.icon} /> {i.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="m-3 flex items-center gap-3 rounded-2xl bg-white/10 p-3">
        <Avatar userId={user.id} name={user.displayName} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{user.displayName}</p>
          <p className="text-xs text-white/60">{ROLE_LABEL[user.role]}</p>
        </div>
        <button onClick={logout} title="Log out" className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 bg-gradient-to-b from-ink-900 to-ink-800 lg:block">{side}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-gradient-to-b from-ink-900 to-ink-800">{side}</aside>
        </div>
      )}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur lg:px-8">
        <button className="btn-ghost lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <img src="/logo.png" alt="ElevateIQ" className="h-6 w-auto lg:hidden" />
        <p className="hidden text-sm text-slate-500 lg:block">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <button className="btn-secondary ml-auto hidden !rounded-full !py-1.5 text-slate-500 sm:inline-flex" onClick={() => window.dispatchEvent(new Event('tf:palette'))} aria-label="Search (Ctrl+K)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          Search <kbd className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">Ctrl K</kbd>
        </button>
        <button className="btn-ghost ml-auto sm:hidden" onClick={() => window.dispatchEvent(new Event('tf:palette'))} aria-label="Search">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        </button>
        <AttendanceChip />
        <NotifBell />
      </header>
      <CommandPalette />
      <main id="main" className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 lg:px-8">
        <PhotoBanner />
        {children}
      </main>
    </div>
  );
}
