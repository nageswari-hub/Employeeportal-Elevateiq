'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';
import { Avatar, Donut, Empty, Loading, PageHeader, ProgressBar, Stat } from '../../components/ui';
import { AttentionRadar } from '../../components/AttentionRadar';
import { AttendanceGlance } from '../../components/AttendanceGlance';
import { HrCard, LeavesWidget, MeetingsCard } from '../../components/Workplace';
import { useMyAttendance } from '../../components/AttendanceProvider';
import { getSocket } from '../../lib/realtime';

interface Me {
  tasks: { open: number; dueToday: number; overdue: number; blocked: number; inReview: number };
  training: Array<{ planId: string; title: string; done: number; total: number; progressPct: number }>;
  reports: { last7: number; lateLast7: number; streak: number; reportedToday: boolean };
}

const DONUT: Record<string, string> = { TODO: '#94A3B8', IN_PROGRESS: '#1E6FE0', IN_REVIEW: '#F59E0B', DONE: '#22C55E', BLOCKED: '#EF4444' };

function greet() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { user, loading } = useRequireAuth();
  const att = useMyAttendance();
  const [me, setMe] = useState<Me | null>(null);
  const [extra, setExtra] = useState<any>(null);
  const [err, setErr] = useState('');
  const [allTeams, setAllTeams] = useState(false);
  const [leadTeams, setLeadTeams] = useState<{ id: string; name: string; leadId?: string | null }[]>([]);
  const [leadTeamId, setLeadTeamId] = useState(user?.teamId ?? '');
  const [expTeams, setExpTeams] = useState<{ id: string; name: string; leadId?: string | null }[]>([]);
  const [expUsers, setExpUsers] = useState<{ id: string; displayName: string }[]>([]);
  const [expTeam, setExpTeam] = useState('');
  const [expUser, setExpUser] = useState('');
  const [expPeriod, setExpPeriod] = useState<'week' | 'month'>('week');

  useEffect(() => {
    if (user?.role !== 'TEAM_LEAD') return;
    api<{ id: string; name: string; leadId?: string | null }[]>('/teams')
      .then((ts) => {
        const led = ts.filter((t) => t.leadId === user.id || t.id === user.teamId);
        setLeadTeams(led);
        setLeadTeamId((cur) => cur || led.find((t) => t.id === user.teamId)?.id || led[0]?.id || '');
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const load = () => {
      api<Me>('/dashboard/me').then((m) => { setMe(m); setErr(''); }).catch((e) => setErr(e.message));
      if (user.role === 'ADMIN') api('/dashboard/admin').then(setExtra).catch((e) => setErr(e.message));
      else if (user.role === 'TEAM_LEAD') api(`/dashboard/lead${leadTeamId ? `?teamId=${leadTeamId}` : ''}`).then(setExtra).catch((e) => setErr(e.message));
      else if (user.role === 'COORDINATOR') api('/dashboard/coordinator').then(setExtra).catch((e) => setErr(e.message));
    };
    load();
    // Live: refresh (debounced) whenever a task changes in my team, instead of waiting for a manual reload.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(timer); timer = setTimeout(load, 800); };
    const s = getSocket();
    s.on('task:changed', bump); s.on('task:updated', bump); s.on('task:created', bump);
    return () => { clearTimeout(timer); s.off('task:changed', bump); s.off('task:updated', bump); s.off('task:created', bump); };
  }, [user, leadTeamId]);

  useEffect(() => {
    if (!user || user.role === 'EMPLOYEE' || user.role === 'COORDINATOR') return;
    if (user.role === 'ADMIN') api<{ id: string; name: string }[]>('/teams').then(setExpTeams).catch(() => {});
    else setExpTeams(leadTeams);
  }, [user, leadTeams]);

  useEffect(() => {
    if (!expTeam) { setExpUsers([]); setExpUser(''); return; }
    api<{ data: { id: string; displayName: string }[] }>(`/users?teamId=${expTeam}&limit=100`).then((r) => setExpUsers(r.data)).catch(() => setExpUsers([]));
  }, [expTeam]);

  if (loading || !user) return <Loading />;
  const activeTeamId = user.role === 'TEAM_LEAD' ? leadTeamId : user.teamId;
  const teamParam = activeTeamId ? `?teamId=${activeTeamId}` : '';
  const canExport = user.role !== 'EMPLOYEE';

  return (
    <div className="space-y-6">
      <PageHeader title={`${greet()}, ${user.displayName.split(' ')[0]} 👋`} sub="Here is what needs your attention today.">
        {user.role === 'TEAM_LEAD' && leadTeams.length > 1 && (
          <select className="input !w-auto" aria-label="Team" value={leadTeamId} onChange={(e) => setLeadTeamId(e.target.value)}>
            {leadTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <Link href="/reports" className="btn">Submit daily report</Link>
        <Link href="/tasks" className="btn-secondary">My tasks</Link>
      </PageHeader>
      {err && <p className="err">{err}</p>}

      {me && (
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Open tasks" value={me.tasks.open} tone="default" hint={`${me.tasks.inReview} in review`} />
          <Stat label="Due today" value={me.tasks.dueToday} tone="warn" />
          <Stat label="Overdue" value={me.tasks.overdue} tone="danger" />
          <Stat label="Report streak" value={`${me.reports.streak} 🔥`} tone="success" hint={me.reports.reportedToday ? 'today’s report is in' : me.reports.lateLast7 ? `${me.reports.lateLast7} late this week` : 'keep it going'} />
        </section>
      )}

      {me && !me.reports.reportedToday && user.role !== 'ADMIN' && (
        <Link href="/reports" className="flex items-center gap-3 rounded-2xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-700 transition hover:bg-brand-100">
          <span className="text-xl">📝</span><span><b>Today’s report is not submitted yet.</b> It takes two minutes. Tap to write it.</span><span className="ml-auto font-semibold">Open →</span>
        </Link>
      )}

      {att.today && att.today.workingDay && !att.today.record && (
        <Link href="/attendance" className="flex items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800 transition hover:bg-orange-100">
          <span className="text-xl">🕘</span><span><b>You have not checked in yet.</b> Tap to mark your attendance.</span><span className="ml-auto font-semibold">Check in →</span>
        </Link>
      )}

      {(user.role === 'ADMIN' || user.role === 'TEAM_LEAD' || user.role === 'COORDINATOR') && <AttendanceGlance />}

      <MeetingsCard />

      <HrCard />

      <LeavesWidget />

      {(user.role === 'ADMIN' || user.role === 'TEAM_LEAD' || user.role === 'COORDINATOR') && (
        <AttentionRadar teamId={user.role === 'ADMIN' ? null : activeTeamId ?? null} />
      )}

      {user.role === 'ADMIN' && extra && (
        <>
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Report submission today" value={`${extra.reports.submissionRate}%`} tone="brand" hint={`${extra.reports.submittedToday} of ${extra.reports.activeUsers} people`} />
            <Stat label="Overdue tasks" value={extra.tasks.overdue} tone="danger" />
            <Stat label="Blocked tasks" value={extra.tasks.blocked} tone="warn" />
            <Stat label="Late reports today" value={extra.reports.lateToday} />
          </section>
          <section className="grid gap-4 lg:grid-cols-3">
            <div className="card">
              <h2 className="h2">Tasks by status</h2>
              <div className="flex flex-wrap items-center justify-center gap-6 sm:flex-nowrap">
                <Donut data={Object.entries(extra.tasks.byStatus as Record<string, number>).map(([k, v]) => ({ label: k, value: v, color: DONUT[k] ?? '#CBD5E1' }))} />
                <ul className="space-y-1.5 text-sm">
                  {Object.entries(extra.tasks.byStatus as Record<string, number>).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: DONUT[k] }} /><span className="text-slate-600">{k.replace('_', ' ').toLowerCase()}</span><b className="ml-auto pl-4 text-ink-900">{v}</b></li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="card lg:col-span-2">
              <div className="mb-3 flex items-center"><h2 className="font-semibold text-ink-900">Team leaderboard</h2><span className="ml-2 text-xs text-slate-400">ranked by report rate</span>
                {extra.leaderboard.length > 6 && <button className="btn-ghost ml-auto !text-xs" onClick={() => setAllTeams(!allTeams)}>{allTeams ? 'Show top 6' : `Show all ${extra.leaderboard.length}`}</button>}
              </div>
              <ul className="space-y-3">
                {(allTeams ? extra.leaderboard : extra.leaderboard.slice(0, 6)).map((t: any, i: number) => (
                  <li key={t.teamId}>
                    <div className="mb-1 flex items-center gap-2 text-sm">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                      <span className="font-medium text-slate-800">{t.name}</span>
                      <span className="text-xs text-slate-400">{t.members} members</span>
                      <span className="ml-auto text-xs text-slate-500">reports <b className="text-ink-900">{t.reportRate}%</b> · done <b className="text-ink-900">{t.taskDoneRate}%</b></span>
                    </div>
                    <ProgressBar pct={t.reportRate} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}

      {user.role === 'TEAM_LEAD' && extra && (
        <>
          <section className="grid grid-cols-3 gap-4">
            <Stat label="Overdue" value={extra.overdue} tone="danger" />
            <Stat label="Pending reviews" value={extra.pendingReviews.length} tone="warn" />
            <Stat label="Team members" value={extra.members.length} />
          </section>
          <section className="grid gap-4 lg:grid-cols-5">
            <div className="card lg:col-span-2">
              <h2 className="h2">Waiting for your review</h2>
              {extra.pendingReviews.length === 0 ? <Empty icon="✅" text="Nothing waiting. Nice!" /> : (
                <ul className="divide-y divide-slate-100">
                  {extra.pendingReviews.map((t: any) => (
                    <li key={t.id} className="flex items-center gap-3 py-2.5">
                      <Avatar userId={t.owner.id} name={t.owner.displayName} size={30} />
                      <div className="min-w-0"><Link href={`/tasks/${t.id}`} className="block truncate text-sm font-medium text-ink-900 hover:text-brand-600">{t.title}</Link><p className="text-xs text-slate-400">{t.owner.displayName}</p></div>
                      <Link href={`/tasks/${t.id}`} className="btn-secondary ml-auto !py-1 !text-xs">Review</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card table-wrap lg:col-span-3">
              <h2 className="h2">Individual performance</h2>
              <table>
                <thead><tr><th>Name</th><th>Done</th><th>Blocked</th><th>Rate</th><th>Reports 7d</th></tr></thead>
                <tbody>
                  {extra.members.map((m: any) => (
                    <tr key={m.id}>
                      <td><div className="flex items-center gap-2"><Avatar userId={m.id} name={m.displayName} size={26} /><span className="font-medium">{m.displayName}</span></div></td>
                      <td>{m.tasksDone}/{m.tasksTotal}</td>
                      <td>{m.tasksBlocked > 0 ? <span className="font-semibold text-red-600">{m.tasksBlocked}</span> : 0}</td>
                      <td className="w-32"><div className="flex items-center gap-2"><ProgressBar pct={m.doneRate} tone="green" /><span className="text-xs text-slate-500">{m.doneRate}%</span></div></td>
                      <td>{m.reportsLast7}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {user.role === 'COORDINATOR' && extra && (
        <section className="card">
          <div className="mb-3 flex items-center"><h2 className="font-semibold text-ink-900">Today — every member</h2><span className="ml-2 text-xs text-slate-400">{extra.date}</span>
            <span className="ml-auto text-sm text-slate-500">{extra.members.filter((m: any) => m.reported).length}/{extra.members.length} reported</span></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {extra.members.map((m: any) => (
              <div key={m.id} className={`flex items-center gap-3 rounded-xl border p-3 ${m.reported ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'}`}>
                <Avatar userId={m.id} name={m.displayName} size={36} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-900">{m.displayName}</p><p className="text-xs text-slate-500">open {m.openTasks} · blocked {m.blockedTasks}{m.late ? ' · late' : ''}</p></div>
                <span className={`text-xs font-semibold ${m.reported ? 'text-green-700' : 'text-red-600'}`}>{m.reported ? '✓ Reported' : 'Missing'}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {canExport && (
        <section className="card">
          <h2 className="h2">Reports &amp; exports</h2>
          {(user.role === 'ADMIN' || user.role === 'TEAM_LEAD') && (
            <div className="mb-3 grid gap-2 sm:grid-cols-4">
              <select className="input" aria-label="Team" value={expTeam} onChange={(e) => { setExpTeam(e.target.value); setExpUser(''); }}>
                <option value="">{user.role === 'TEAM_LEAD' ? 'All my teams' : 'All teams'}</option>
                {expTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select className="input" aria-label="Person" value={expUser} onChange={(e) => setExpUser(e.target.value)} disabled={!expTeam}>
                <option value="">All people</option>
                {expUsers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
              <select className="input" aria-label="Period" value={expPeriod} onChange={(e) => setExpPeriod(e.target.value as any)}>
                <option value="week">This week</option>
                <option value="month">This month</option>
              </select>
              <div className="flex gap-2">
                <a className="btn-secondary" href={`/backend/exports/reports.csv?period=${expPeriod}${expTeam ? `&teamId=${encodeURIComponent(expTeam)}` : ''}${expUser ? `&userId=${encodeURIComponent(expUser)}` : ''}`}>⬇ CSV</a>
                <a className="btn-secondary" href={`/backend/exports/reports.pdf?period=${expPeriod}${expTeam ? `&teamId=${encodeURIComponent(expTeam)}` : ''}${expUser ? `&userId=${encodeURIComponent(expUser)}` : ''}`}>⬇ PDF</a>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <a className="btn-secondary" href={`/backend/exports/tasks.csv${teamParam}`}>⬇ Tasks CSV</a>
            <a className="btn-secondary" href={`/backend/exports/tasks.pdf${teamParam}`}>⬇ Tasks PDF</a>
            <a className="btn-secondary" href={`/backend/exports/reports.csv${teamParam}`}>⬇ Reports CSV (today)</a>
            <a className="btn-secondary" href={`/backend/exports/reports.pdf${teamParam}`}>⬇ Reports PDF (today)</a>
            <a className="btn-secondary" href="/backend/exports/tasks.csv?status=BLOCKED">⬇ Blocked tasks CSV</a>
          </div>
        </section>
      )}
    </div>
  );
}
