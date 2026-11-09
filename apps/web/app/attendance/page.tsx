'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, downloadFile } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';
import { Avatar, Loading, Modal, PageHeader } from '../../components/ui';
import { useMyAttendance, useTick } from '../../components/AttendanceProvider';
import { BreakPicker } from '../../components/BreakPicker';
import { useAvatars } from '../../components/AvatarProvider';
import { getSocket } from '../../lib/realtime';
import { BREAK_EMOJI, BREAK_LABEL, DayState, fmtDur, fmtTime, hhmm, liveMinutes, monthLabel, shiftMonth, STATE_LABEL, STATE_PILL, STATE_RING } from '../../lib/attendance';

interface BoardRow {
  userId: string; name: string; email: string; role: string; teamId: string | null; teamName: string | null; batchName: string | null; day: string;
  state: DayState; late: boolean; halfDay: boolean; mode: string | null; checkInAt: string | null; checkOutAt: string | null; lateMinutes: number;
  workedMinutes: number; breakMinutes: number; breakCount: number; overBreak: boolean; onBreakSince: string | null; breakReason: string | null;
  autoClosed: boolean; edited: boolean; note: string | null; breaks: { reason: string; note: string | null; startAt: string; endAt: string | null; minutes: number }[];
}
interface Board {
  date: string; workingDay: boolean; summary: Record<string, number>; rows: BoardRow[];
}
interface PersonDay extends Partial<Omit<BoardRow, 'state'>> { day: string; state: DayState | 'FUTURE' }
interface Person { user: { id: string; name: string; email: string; team: string | null }; from: string; to: string; summary: Record<string, number>; days: PersonDay[] }

const todayStr = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const label = (r: { state: DayState | 'FUTURE'; late?: boolean; halfDay?: boolean; checkInAt?: string | null }) => {
  if (r.state === 'FUTURE') return '';
  if (r.checkInAt && r.state !== 'LEAVE') return r.halfDay ? 'Half day' : r.late ? 'Late' : 'Present';
  return STATE_LABEL[r.state as DayState];
};
const dayTone = (r: PersonDay) => {
  if (r.state === 'FUTURE') return 'bg-white text-slate-300 border-slate-100';
  if (r.state === 'LEAVE') return 'bg-sky-50 text-sky-700 border-sky-200';
  if (r.checkInAt) return r.halfDay || r.late ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-green-50 text-green-800 border-green-200';
  if (r.state === 'ABSENT') return 'bg-red-50 text-red-700 border-red-200';
  if (r.state === 'NOT_IN') return 'bg-orange-50 text-orange-700 border-orange-200';
  return 'bg-slate-50 text-slate-400 border-slate-100';
};

/* ───────────── My day ───────────── */
function MyDay() {
  const a = useMyAttendance();
  useTick(10_000);
  const [note, setNote] = useState('');
  const t = a.today;
  if (!t) return <div className="card"><Loading /></div>;
  const rec = t.record;
  const live = liveMinutes(rec, a.nowMs());
  const out = Boolean(rec?.checkOutAt);
  const onBreak = Boolean(rec?.openBreak);
  const onLeave = rec?.status === 'ON_LEAVE';
  const notIn = !rec?.checkInAt && !onLeave;
  const brkOpenMin = rec?.openBreak ? Math.floor((a.nowMs() - new Date(rec.openBreak.startAt).getTime()) / 60000) : 0;
  const over = live.brk > t.config.maxBreakMinutes;

  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-ink-900">My day</h2>
        <span className="text-sm text-slate-500">{new Date(t.day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <span className="ml-auto text-xs text-slate-400">Shift {hhmm(t.config.shiftStart)}–{hhmm(t.config.shiftEnd)} · {t.config.graceMinutes} min grace</span>
      </div>
      {a.err && <p className="err mt-3" role="alert">{a.err}{a.errCode === 'REPORT_REQUIRED' && <> <a href="/reports" className="font-bold underline">Open Reports →</a></>}</p>}

      <div className="mt-4 grid gap-4 md:grid-cols-5">
        <div className="md:col-span-2">
          <div className={`rounded-2xl p-5 text-center ${onLeave ? 'bg-sky-50' : notIn ? 'bg-orange-50' : onBreak ? 'bg-amber-50' : out ? 'bg-slate-100' : 'bg-green-50'}`}>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{onLeave ? 'On leave' : notIn ? 'Not checked in' : out ? 'Day complete' : onBreak ? 'On break' : 'Working'}</p>
            <p className="mt-1 text-4xl font-extrabold tabular-nums text-ink-900">{onBreak ? fmtDur(brkOpenMin) : fmtDur(live.worked)}</p>
            <p className="mt-1 text-xs text-slate-500">{onBreak ? `${BREAK_LABEL[rec!.openBreak!.reason]} break` : out || rec?.checkInAt ? 'worked today (breaks excluded)' : t.workingDay ? 'Tap below to start your day' : 'Day off'}</p>
            {rec?.checkInAt && <p className="mt-3 text-xs text-slate-500">In <b className="text-ink-900">{fmtTime(rec.checkInAt)}</b>{rec.lateMinutes > 0 && <span className="text-amber-600"> · {rec.lateMinutes}m late</span>}{out && <> · Out <b className="text-ink-900">{fmtTime(rec.checkOutAt)}</b></>}</p>}
            {rec?.autoClosed && <p className="mt-2 rounded-lg bg-white/70 px-2 py-1 text-xs text-amber-700">Checked out automatically. Ask your lead to correct it if needed.</p>}
          </div>
          {live.brk > 0 && <p className={`mt-2 text-center text-xs ${over ? 'font-semibold text-red-600' : 'text-slate-500'}`}>Breaks today {fmtDur(live.brk)} of {t.config.maxBreakMinutes}m allowed{over ? ' · over the limit' : ''}</p>}
        </div>

        <div className="space-y-3 md:col-span-3">
          {onLeave && <p className="text-sm text-slate-600">You are marked on leave today. Enjoy! If this is a mistake, tell your team lead.</p>}
          {notIn && (
            <>
              <label className="label">Optional note for your lead</label>
              <input className="input" maxLength={300} placeholder="e.g. Working from the client office today" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <button className="btn !py-3.5 text-base" disabled={a.busy} onClick={() => a.checkIn('OFFICE', note)}>🏢 Check in · Office</button>
                <button className="btn-secondary !py-3.5 text-base" disabled={a.busy} onClick={() => a.checkIn('REMOTE', note)}>🏠 Check in · Remote</button>
              </div>
            </>
          )}
          {rec?.checkInAt && !out && !onBreak && (
            <>
              <p className="text-sm font-semibold text-ink-900">Stepping away? Tell the team why:</p>
              <BreakPicker busy={a.busy} onStart={(r, n) => a.startBreak(r, n)} />
              {t.reportGate?.required && !t.reportGate.submitted && (
                <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">You must submit today’s <a href="/reports" className="font-bold underline">daily report</a> before checking out.</p>
              )}
              <button className="btn-secondary w-full !border-red-200 !py-3 !text-red-700 hover:!bg-red-50" disabled={a.busy} onClick={() => { if (confirm('Check out for today?')) void a.checkOut(); }}>Check out for the day</button>
            </>
          )}
          {onBreak && (
            <div className="space-y-3">
              <p className="text-sm text-amber-800">Your team can see you are on a break. Tap when you are back.</p>
              <button className="btn w-full !py-4 text-base" disabled={a.busy} onClick={() => a.endBreak()}>✅ I’m back — end break</button>
            </div>
          )}
          {out && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">You are done for today. Total worked <b className="text-ink-900">{fmtDur(live.worked)}</b> with <b className="text-ink-900">{fmtDur(live.brk)}</b> of breaks. See you tomorrow!</p>}
        </div>
      </div>

      {rec && rec.breaks.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Today’s breaks</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {rec.breaks.map((b, i) => (
              <li key={b.id ?? i} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span className="text-lg">{BREAK_EMOJI[b.reason]}</span>
                <span><b className="text-ink-900">{BREAK_LABEL[b.reason]}</b>{b.note && <span className="text-slate-500"> · {b.note}</span>}</span>
                <span className="ml-auto text-xs text-slate-500">{fmtTime(b.startAt)} → {b.endAt ? fmtTime(b.endAt) : 'now'} · {fmtDur(Math.floor(((b.endAt ? new Date(b.endAt).getTime() : a.nowMs()) - new Date(b.startAt).getTime()) / 60000))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ───────────── Month calendar (me or any person) ───────────── */
function MonthView({ userId, canExport, onEdit }: { userId: string; canExport: boolean; onEdit?: (d: PersonDay) => void }) {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [data, setData] = useState<Person | null>(null);
  const [sel, setSel] = useState<PersonDay | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setData(null); setSel(null);
    api<Person>(`/attendance/person/${userId}?month=${month}`).then(setData).catch((e) => setErr(e instanceof ApiError ? e.message : 'Load failed'));
  }, [userId, month]);
  const offset = data ? (new Date(data.from + 'T00:00:00Z').getUTCDay() + 6) % 7 : 0; // Monday first
  const s = data?.summary;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn-secondary !px-3" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">←</button>
        <h3 className="min-w-[10rem] text-center font-semibold text-ink-900">{monthLabel(month)}</h3>
        <button className="btn-secondary !px-3" disabled={month >= todayStr().slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">→</button>
        {canExport && <button className="btn-secondary ml-auto !text-xs" onClick={() => downloadFile(`/attendance/export?type=person&userId=${userId}&month=${month}`, 'attendance.xlsx').catch((e) => setErr(e.message))}>⬇ Excel</button>}
      </div>
      {err && <p className="err mb-3" role="alert">{err}</p>}
      {!data ? <Loading /> : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[['Present', s!.present], ['On time', s!.onTime], ['Late', s!.late], ['Half day', s!.halfDay], ['Leave', s!.leave], ['Absent', s!.absent]].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-slate-50 px-2 py-2 text-center"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{k}</p><p className="text-xl font-bold text-ink-900">{v}</p></div>
            ))}
          </div>
          <p className="mb-2 text-xs text-slate-500">Attendance <b className="text-ink-900">{s!.attendancePct}%</b> · average <b className="text-ink-900">{fmtDur(s!.avgWorkedMinutes)}</b> per day · breaks <b className="text-ink-900">{fmtDur(s!.breakMinutes)}</b> total</p>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-slate-400">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: offset }).map((_, i) => <div key={`o${i}`} />)}
            {data.days.map((d) => (
              <button key={d.day} type="button" onClick={() => setSel(sel?.day === d.day ? null : d)} aria-label={`${d.day} ${label(d)}`}
                className={`aspect-square rounded-lg border text-xs font-semibold transition ${dayTone(d)} ${sel?.day === d.day ? 'ring-2 ring-accent-600' : ''}`}>
                {Number(d.day.slice(8))}
                {d.checkInAt && d.state !== 'FUTURE' && <span className="block text-[9px] font-normal leading-none opacity-70">{fmtTime(d.checkInAt).replace(/ ?(AM|PM)/i, '')}</span>}
              </button>
            ))}
          </div>
          {sel && sel.state !== 'FUTURE' && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <p className="font-semibold text-ink-900">{new Date(sel.day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · {label(sel)}</p>
              {sel.checkInAt ? (
                <p className="mt-1 text-slate-600">In {fmtTime(sel.checkInAt)} · Out {sel.checkOutAt ? fmtTime(sel.checkOutAt) : '—'} · Worked {fmtDur(sel.workedMinutes ?? 0)} · Breaks {fmtDur(sel.breakMinutes ?? 0)}{sel.lateMinutes ? ` · ${sel.lateMinutes}m late` : ''}{sel.mode ? ` · ${sel.mode.toLowerCase()}` : ''}</p>
              ) : <p className="mt-1 text-slate-500">No check-in recorded.</p>}
              {sel.note && <p className="mt-1 text-slate-500">Note: {sel.note}</p>}
              {sel.breaks?.map((b, i) => <p key={i} className="text-xs text-slate-500">{BREAK_EMOJI[b.reason]} {BREAK_LABEL[b.reason]} {fmtTime(b.startAt)}–{b.endAt ? fmtTime(b.endAt) : '…'} ({fmtDur(b.minutes)}){b.note ? ` · ${b.note}` : ''}</p>)}
              {onEdit && <button className="btn-ghost mt-2 !text-xs" onClick={() => onEdit(sel)}>Correct this day…</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────── Live board ───────────── */
const FILTERS: { k: string; l: string; test: (r: BoardRow) => boolean }[] = [
  { k: 'all', l: 'Everyone', test: () => true },
  { k: 'in', l: 'Working', test: (r) => r.state === 'WORKING' },
  { k: 'break', l: 'On break', test: (r) => r.state === 'ON_BREAK' },
  { k: 'out', l: 'Checked out', test: (r) => r.state === 'CHECKED_OUT' },
  { k: 'late', l: 'Late', test: (r) => Boolean(r.checkInAt) && r.late && !r.halfDay },
  { k: 'half', l: 'Half day', test: (r) => r.halfDay },
  { k: 'notin', l: 'Not in / absent', test: (r) => r.state === 'NOT_IN' || r.state === 'ABSENT' },
  { k: 'leave', l: 'Leave', test: (r) => r.state === 'LEAVE' },
];

function BoardView({ isAdmin, onOpen }: { isAdmin: boolean; onOpen: (r: BoardRow) => void }) {
  const [date, setDate] = useState(todayStr());
  const [teamId, setTeamId] = useState('');
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const { online } = useAvatars();

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ date });
      if (teamId) p.set('teamId', teamId);
      setBoard(await api<Board>(`/attendance/board?${p}`)); setErr('');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Load failed'); }
  }, [date, teamId]);

  useEffect(() => { setBoard(null); void load(); }, [load]);
  useEffect(() => { if (isAdmin) api<{ id: string; name: string }[]>('/teams').then(setTeams).catch(() => {}); }, [isAdmin]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(timer); timer = setTimeout(load, 1200); }; // many people check in at once: refetch once, not per event
    const s = getSocket();
    s.on('attendance:changed', bump);
    const poll = setInterval(() => { if (!document.hidden && date === todayStr()) void load(); }, 60_000);
    return () => { clearTimeout(timer); clearInterval(poll); s.off('attendance:changed', bump); };
  }, [load, date]);

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.k === filter)!;
    const n = q.trim().toLowerCase();
    return (board?.rows ?? []).filter(f.test).filter((r) => !n || r.name.toLowerCase().includes(n) || (r.teamName ?? '').toLowerCase().includes(n));
  }, [board, filter, q]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.k, (board?.rows ?? []).filter(f.test).length])), [board]);
  const s = board?.summary;
  const tile = (title: string, val: number | string, tone = 'text-ink-900') => (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p><p className={`text-2xl font-extrabold ${tone}`}>{val}</p></div>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input !w-44" type="date" max={todayStr()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
        {isAdmin && (
          <select className="input !w-48" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Team">
            <option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}<option value="none">No team</option>
          </select>
        )}
        <input className="input !w-56" type="search" placeholder="Search name or team…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {date === todayStr() && <span className="ml-auto flex items-center gap-1.5 text-xs text-green-600"><span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />Live</span>}
      </div>
      {err && <p className="err mb-3" role="alert">{err}</p>}
      {!board ? <Loading /> : (
        <>
          {!board.workingDay && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">This is a day off. Nobody is marked absent; people who worked are still listed.</p>}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {tile('Present', `${s!.present}/${(s!.total ?? 0) - (s!.off ?? 0)}`, 'text-green-600')}
            {tile('Working now', s!.working, 'text-green-600')}
            {tile('On break', s!.onBreak, 'text-amber-600')}
            {tile('Late', s!.late, 'text-amber-600')}
            {tile('Leave', s!.leave, 'text-sky-600')}
            {tile('Absent / not in', (s!.absent ?? 0) + (s!.notIn ?? 0), 'text-red-600')}
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button key={f.k} type="button" aria-pressed={filter === f.k} onClick={() => setFilter(f.k)} className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${filter === f.k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {f.l} <span className="opacity-60">{counts[f.k]}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? <p className="card text-center text-sm text-slate-500">No one matches.</p> : (
            <ul className="grid gap-2 lg:grid-cols-2">
              {shown.map((r) => (
                <li key={r.userId}>
                  <button type="button" onClick={() => onOpen(r)} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:shadow-sm">
                    <span className="relative">
                      <Avatar userId={r.userId} name={r.name} size={44} ring={STATE_RING[r.state]} />
                      {online.has(r.userId) && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-green-500" title="Online now" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span className="truncate font-semibold text-ink-900">{r.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_PILL[r.state]}`}>{r.state === 'ON_BREAK' && r.breakReason ? `${BREAK_EMOJI[r.breakReason]} ${BREAK_LABEL[r.breakReason]} break` : STATE_LABEL[r.state]}</span>
                        {r.checkInAt && r.late && !r.halfDay && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Late {r.lateMinutes}m</span>}
                        {r.halfDay && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Half day</span>}
                        {r.overBreak && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Break over limit</span>}
                        {r.autoClosed && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">auto check-out</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {r.teamName ?? 'No team'}{r.checkInAt ? ` · In ${fmtTime(r.checkInAt)}` : ''}{r.checkOutAt ? ` · Out ${fmtTime(r.checkOutAt)}` : ''}{r.checkInAt ? ` · ${fmtDur(r.workedMinutes)} worked` : ''}{r.breakMinutes ? ` · ${fmtDur(r.breakMinutes)} break` : ''}{r.mode === 'REMOTE' ? ' · remote' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────── Exports ───────────── */
function ExportPanel({ isAdmin }: { isAdmin: boolean }) {
  const [date, setDate] = useState(todayStr());
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [fmt, setFmt] = useState<'xlsx' | 'csv'>('xlsx');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [teamId, setTeamId] = useState('');
  const [find, setFind] = useState('');
  const [people, setPeople] = useState<{ id: string; displayName: string; email: string }[]>([]);
  const [person, setPerson] = useState<{ id: string; displayName: string } | null>(null);
  const [pMonth, setPMonth] = useState(todayStr().slice(0, 7));
  const [range, setRange] = useState(false);
  const [from, setFrom] = useState(`${todayStr().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayStr());

  useEffect(() => { if (isAdmin) api<{ id: string; name: string }[]>('/teams').then(setTeams).catch(() => {}); }, [isAdmin]);
  useEffect(() => {
    if (find.trim().length < 2) { setPeople([]); return; }
    const t = setTimeout(() => api<{ data: any[] }>(`/users?limit=8&active=true&search=${encodeURIComponent(find.trim())}`).then((r) => setPeople(r.data)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [find]);

  const go = async (key: string, path: string) => {
    setBusy(key); setErr('');
    try { await downloadFile(`/attendance/export?${path}&format=${fmt}${teamId ? `&teamId=${teamId}` : ''}`, `attendance.${fmt}`); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Download failed'); }
    finally { setBusy(''); }
  };
  const Card = ({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) => (
    <div className="card"><h3 className="font-semibold text-ink-900">{title}</h3><p className="mb-3 text-xs text-slate-500">{sub}</p>{children}</div>
  );
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 p-0.5 text-sm" role="group" aria-label="File format">
          {(['xlsx', 'csv'] as const).map((f) => <button key={f} type="button" aria-pressed={fmt === f} className={`rounded-lg px-4 py-1.5 font-semibold ${fmt === f ? 'bg-brand-600 text-white' : 'text-slate-600'}`} onClick={() => setFmt(f)}>{f === 'xlsx' ? 'Excel (.xlsx)' : 'CSV'}</button>)}
        </div>
        {isAdmin && (
          <select className="input !w-48" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Limit to team">
            <option value="">Everyone (all teams)</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name} only</option>)}
          </select>
        )}
      </div>
      {err && <p className="err mb-3" role="alert">{err}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="📅 Daily sheet" sub="Everyone for one day: summary, by team, who was in/out/late/absent, and every break.">
          <input className="input mb-3" type="date" max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" />
          <button className="btn w-full" disabled={busy === 'day'} onClick={() => go('day', `type=day&date=${date}`)}>{busy === 'day' ? 'Preparing…' : '⬇ Download daily'}</button>
        </Card>
        <Card title="🗓️ Monthly register" sub="Everyone for a month: summary per person, a P/L/A day-by-day register, and every detail row.">
          <input className="input mb-3" type="month" max={todayStr().slice(0, 7)} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
          <button className="btn w-full" disabled={busy === 'month'} onClick={() => go('month', `type=month&month=${month}`)}>{busy === 'month' ? 'Preparing…' : '⬇ Download monthly'}</button>
        </Card>
        <Card title="👤 One person" sub="Complete history of one individual with breaks, for a month or any date range.">
          {person ? (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-slate-50 p-2 text-sm"><Avatar userId={person.id} name={person.displayName} size={28} /><b className="truncate">{person.displayName}</b><button className="ml-auto text-slate-400" onClick={() => setPerson(null)} aria-label="Clear person">✕</button></div>
          ) : (
            <div className="relative mb-3">
              <input className="input" placeholder="Search a person…" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find person" />
              {people.length > 0 && <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">{people.map((p) => <li key={p.id}><button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setPerson(p); setFind(''); setPeople([]); }}><Avatar userId={p.id} name={p.displayName} size={24} />{p.displayName}<span className="ml-auto truncate text-xs text-slate-400">{p.email}</span></button></li>)}</ul>}
            </div>
          )}
          <label className="mb-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={range} onChange={(e) => setRange(e.target.checked)} /> Custom date range</label>
          {range ? <div className="mb-3 grid grid-cols-2 gap-2"><input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><input className="input" type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} aria-label="To" /></div>
            : <input className="input mb-3" type="month" max={todayStr().slice(0, 7)} value={pMonth} onChange={(e) => setPMonth(e.target.value)} aria-label="Month" />}
          <button className="btn w-full" disabled={!person || busy === 'person'} onClick={() => go('person', `type=person&userId=${person!.id}&${range ? `from=${from}&to=${to}` : `month=${pMonth}`}`)}>{busy === 'person' ? 'Preparing…' : '⬇ Download person'}</button>
        </Card>
      </div>
    </div>
  );
}

/* ───────────── Edit / mark modal ───────────── */
function EditModal({ target, onClose, onSaved }: { target: { userId: string; name: string; day: string; status?: string; checkInAt?: string | null; checkOutAt?: string | null } | null; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState('');
  const [inT, setInT] = useState('');
  const [outT, setOutT] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!target) return;
    const toLocal = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
    setStatus(''); setInT(toLocal(target.checkInAt)); setOutT(toLocal(target.checkOutAt)); setReason(''); setErr('');
  }, [target]);
  if (!target) return null;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api('/attendance/mark', { method: 'POST', body: { userId: target!.userId, day: target!.day, reason: reason.trim(), ...(status ? { status } : {}), ...(status !== 'ON_LEAVE' && inT ? { checkIn: inT } : {}), ...(status !== 'ON_LEAVE' && outT ? { checkOut: outT } : {}) } });
      onSaved(); onClose();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`Correct attendance · ${target.name}`}>
      <form onSubmit={save} className="space-y-3">
        {err && <p className="err" role="alert">{err}</p>}
        <p className="text-sm text-slate-500">{new Date(target.day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. The person is notified and the change is recorded in the audit log.</p>
        <div><label className="label">Mark as</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Decide from the times below</option><option value="PRESENT">Present</option><option value="LATE">Late</option><option value="HALF_DAY">Half day</option><option value="ON_LEAVE">On leave (excused)</option>
          </select></div>
        {status !== 'ON_LEAVE' && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Check-in</label><input className="input" type="time" value={inT} onChange={(e) => setInT(e.target.value)} /></div>
            <div><label className="label">Check-out</label><input className="input" type="time" value={outT} onChange={(e) => setOutT(e.target.value)} /></div>
          </div>
        )}
        <div><label className="label">Reason (required)</label><input className="input" required minLength={3} maxLength={500} placeholder="e.g. Forgot to check in, was in the client meeting" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <button className="btn w-full" disabled={busy || reason.trim().length < 3}>{busy ? 'Saving…' : 'Save correction'}</button>
      </form>
    </Modal>
  );
}

/* ───────────── Page ───────────── */
export default function AttendancePage() {
  const { user, loading } = useRequireAuth();
  const a = useMyAttendance();
  const [tab, setTab] = useState<'mine' | 'board' | 'export'>('mine');
  const [open, setOpen] = useState<BoardRow | null>(null);
  const [edit, setEdit] = useState<{ userId: string; name: string; day: string; status?: string; checkInAt?: string | null; checkOutAt?: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  const staff = !!user && ['ADMIN', 'TEAM_LEAD', 'COORDINATOR'].includes(user.role);
  const canEdit = !!user && (user.role === 'ADMIN' || user.role === 'TEAM_LEAD');

  useEffect(() => { if (staff) { const q = new URLSearchParams(window.location.search); if (q.get('summary') || q.get('nudge') || q.get('team') || q.get('board')) setTab('board'); } }, [staff]);

  if (loading || !user) return <Loading />;
  const tabs = [{ k: 'mine', l: 'My attendance' }, ...(staff ? [{ k: 'board', l: user.role === 'ADMIN' ? 'Everyone — live board' : 'My team — live board' }, { k: 'export', l: 'Download reports' }] : [])] as { k: typeof tab; l: string }[];

  return (
    <div>
      <PageHeader title="Attendance" sub="Check in when you start, mark breaks, check out when you finish." />
      {tabs.length > 1 && (
        <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
          {tabs.map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)} className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition ${tab === t.k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-ink-900'}`}>{t.l}</button>)}
        </div>
      )}

      {tab === 'mine' && (
        <div className="space-y-5">
          <MyDay />
          <section className="card"><h2 className="h2">My month</h2><MonthView key={`me${a.today?.record?.checkInAt ?? ''}${a.today?.record?.checkOutAt ?? ''}`} userId={user.id} canExport /></section>
        </div>
      )}
      {tab === 'board' && staff && <BoardView key={tick} isAdmin={user.role === 'ADMIN'} onOpen={setOpen} />}
      {tab === 'export' && staff && <ExportPanel isAdmin={user.role === 'ADMIN'} />}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''}>
        {open && (
          <div className="space-y-3">
            <div className="flex items-center gap-3"><Avatar userId={open.userId} name={open.name} size={52} /><div><p className="font-semibold text-ink-900">{open.name}</p><p className="text-xs text-slate-500">{open.email} · {open.teamName ?? 'No team'}</p></div></div>
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              <p><b className={`rounded-full px-2 py-0.5 text-xs ${STATE_PILL[open.state]}`}>{label(open)}</b> {open.checkInAt && <>In {fmtTime(open.checkInAt)} · Out {open.checkOutAt ? fmtTime(open.checkOutAt) : '—'} · {fmtDur(open.workedMinutes)} worked</>}</p>
              {open.note && <p className="mt-1">Note: {open.note}</p>}
              {open.breaks.map((b, i) => <p key={i} className="text-xs">{BREAK_EMOJI[b.reason]} {BREAK_LABEL[b.reason]} {fmtTime(b.startAt)}–{b.endAt ? fmtTime(b.endAt) : '…'} ({fmtDur(b.minutes)}){b.note ? ` · ${b.note}` : ''}</p>)}
            </div>
            <MonthView userId={open.userId} canExport={canEdit || user.role === 'COORDINATOR' || user.role === 'ADMIN'} onEdit={canEdit ? (d) => { setEdit({ userId: open.userId, name: open.name, day: d.day, checkInAt: d.checkInAt, checkOutAt: d.checkOutAt }); setOpen(null); } : undefined} />
            {canEdit && <button className="btn-secondary w-full" onClick={() => { setEdit({ userId: open.userId, name: open.name, day: open.day, checkInAt: open.checkInAt, checkOutAt: open.checkOutAt }); setOpen(null); }}>Correct {open.day === todayStr() ? 'today' : open.day}…</button>}
          </div>
        )}
      </Modal>
      <EditModal target={edit} onClose={() => setEdit(null)} onSaved={() => setTick((n) => n + 1)} />
    </div>
  );
}
