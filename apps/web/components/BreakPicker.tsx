'use client';
import { useState } from 'react';
import { BREAK_EMOJI, BREAK_LABEL } from '../lib/attendance';

/** Pick why you are stepping away. One tap for the common reasons; "Other" asks for a few words. */
export function BreakPicker({ onStart, busy, compact }: { onStart: (reason: string, note?: string) => void; busy?: boolean; compact?: boolean }) {
  const [other, setOther] = useState(false);
  const [note, setNote] = useState('');
  return (
    <div className="space-y-2">
      <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
        {(['LUNCH', 'TEA', 'PERSONAL'] as const).map((r) => (
          <button key={r} type="button" disabled={busy} onClick={() => onStart(r)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-ink-900 transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50">
            <span className="mr-1.5">{BREAK_EMOJI[r]}</span>{BREAK_LABEL[r]}
          </button>
        ))}
        <button type="button" disabled={busy} onClick={() => setOther(!other)} aria-expanded={other} className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${other ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50'}`}>
          <span className="mr-1.5">{BREAK_EMOJI.OTHER}</span>{BREAK_LABEL.OTHER}
        </button>
      </div>
      {other && (
        <div className="flex gap-2">
          <input className="input" autoFocus maxLength={300} placeholder="Why? (a few words)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && note.trim().length >= 3 && onStart('OTHER', note.trim())} />
          <button type="button" className="btn" disabled={busy || note.trim().length < 3} onClick={() => onStart('OTHER', note.trim())}>Start</button>
        </div>
      )}
    </div>
  );
}
