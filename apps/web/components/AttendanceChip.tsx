'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMyAttendance, useTick } from './AttendanceProvider';
import { BREAK_LABEL, fmtDur, fmtTime, liveMinutes } from '../lib/attendance';
import { BreakPicker } from './BreakPicker';

/** Always-visible attendance control in the header: check in, take a break, check out without leaving the page you are on. */
export function AttendanceChip() {
  const a = useMyAttendance();
  useTick(20_000);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setPicking(false); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const t = a.today;
  if (!t) return null;
  const rec = t.record;
  const live = liveMinutes(rec, a.nowMs());
  const onLeave = rec?.status === 'ON_LEAVE';
  const out = Boolean(rec?.checkOutAt);
  const onBreak = Boolean(rec?.openBreak);
  const notIn = !rec?.checkInAt && !onLeave;

  let label = '', tone = '';
  if (onLeave) { label = 'On leave'; tone = 'bg-sky-50 text-sky-700 border-sky-200'; }
  else if (notIn) { label = t.workingDay ? 'Check in' : 'Day off'; tone = t.workingDay ? 'bg-accent-600 text-white border-accent-600 animate-pulse' : 'bg-slate-50 text-slate-500 border-slate-200'; }
  else if (out) { label = `Done · ${fmtDur(live.worked)}`; tone = 'bg-slate-100 text-slate-600 border-slate-200'; }
  else if (onBreak) { label = `On break · ${fmtDur(Math.floor((a.nowMs() - new Date(rec!.openBreak!.startAt).getTime()) / 60000))}`; tone = 'bg-amber-50 text-amber-800 border-amber-300'; }
  else { label = `Working · ${fmtDur(live.worked)}`; tone = 'bg-green-50 text-green-700 border-green-200'; }

  const act = async (fn: () => Promise<boolean>) => { const ok = await fn(); if (ok) { setOpen(false); setPicking(false); } };

  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${tone}`}>
        <span className={`h-2 w-2 rounded-full ${notIn ? 'bg-white' : onBreak ? 'bg-amber-500' : out || onLeave ? 'bg-slate-400' : 'bg-green-500'}`} />
        {label}
      </button>
      {open && (
        <div role="dialog" aria-label="Attendance" className="absolute right-0 z-50 mt-2 w-[19rem] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
          {a.err && <p className="err mb-3" role="alert">{a.err}{a.errCode === 'REPORT_REQUIRED' && <Link href="/reports" onClick={() => setOpen(false)} className="ml-1 font-bold underline">Open Reports →</Link>}</p>}
          {onLeave && <p className="text-sm text-slate-600">You are marked on leave today. Talk to your team lead if this is wrong.</p>}
          {notIn && t.workingDay && (
            <>
              <p className="mb-3 text-sm text-slate-600">Good to see you! Where are you working from today?</p>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn" disabled={a.busy} onClick={() => act(() => a.checkIn('OFFICE'))}>🏢 Office</button>
                <button className="btn-secondary" disabled={a.busy} onClick={() => act(() => a.checkIn('REMOTE'))}>🏠 Remote</button>
              </div>
            </>
          )}
          {notIn && !t.workingDay && <p className="text-sm text-slate-600">Today is a day off. You can still check in if you are working.</p>}
          {notIn && !t.workingDay && <button className="btn mt-3 w-full" disabled={a.busy} onClick={() => act(() => a.checkIn('OFFICE'))}>Check in anyway</button>}
          {rec?.checkInAt && !out && (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">In at <b className="text-ink-900">{fmtTime(rec.checkInAt)}</b>{rec.lateMinutes > 0 && <span className="ml-1 text-amber-600">({rec.lateMinutes}m late)</span>}</p>
                <p className="text-slate-500">Worked <b className="text-ink-900">{fmtDur(live.worked)}</b> · breaks <b className="text-ink-900">{fmtDur(live.brk)}</b></p>
              </div>
              {t.reportGate?.required && !t.reportGate.submitted && (
                <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">You must submit today’s <Link href="/reports" onClick={() => setOpen(false)} className="font-bold underline">daily report</Link> before you can check out.</p>
              )}
              {onBreak ? (
                <>
                  <p className="text-sm text-amber-800">You are on a <b>{BREAK_LABEL[rec.openBreak!.reason].toLowerCase()}</b> break since {fmtTime(rec.openBreak!.startAt)}.</p>
                  <button className="btn w-full" disabled={a.busy} onClick={() => act(a.endBreak)}>I’m back — end break</button>
                </>
              ) : picking ? (
                <>
                  <p className="text-sm font-medium text-ink-900">What kind of break?</p>
                  <BreakPicker compact busy={a.busy} onStart={(r, n) => act(() => a.startBreak(r, n))} />
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-secondary" disabled={a.busy} onClick={() => setPicking(true)}>☕ Take a break</button>
                  <button className="btn-secondary !border-red-200 !text-red-700 hover:!bg-red-50" disabled={a.busy} onClick={() => { if (confirm('Check out for today?')) void act(() => a.checkOut()); }}>Check out</button>
                </div>
              )}
            </div>
          )}
          {out && <p className="text-sm text-slate-600">You checked out at <b>{fmtTime(rec!.checkOutAt)}</b>. Worked <b>{fmtDur(live.worked)}</b> today. See you tomorrow!</p>}
          <Link href="/attendance" onClick={() => setOpen(false)} className="mt-3 block text-center text-xs font-semibold text-accent-600 hover:underline">Open full attendance →</Link>
        </div>
      )}
    </div>
  );
}
