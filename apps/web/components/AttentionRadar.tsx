'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { Avatar, Empty } from './ui';

interface Item { userId: string; name: string; severity: 'high' | 'medium' | 'low'; score: number; reasons: string[]; taskIds: string[] }

const TONE = {
  high: 'border-red-200 bg-red-50/60',
  medium: 'border-amber-200 bg-amber-50/60',
  low: 'border-slate-200 bg-slate-50/60',
} as const;
const DOT = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-slate-400' } as const;

/** "Who needs a human today, and why": rule-based early warnings so leads act before a problem becomes a miss. */
export function AttentionRadar({ teamId }: { teamId?: string | null }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => api<{ items: Item[] }>(`/dashboard/attention${teamId ? `?teamId=${teamId}` : ''}`).then((r) => alive && setItems(r.items)).catch(() => alive && setItems([]));
    load();
    const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, [teamId]);

  if (items === null) return null;
  const shown = all ? items : items.slice(0, 6);
  return (
    <section className="card">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-semibold text-ink-900">Attention radar</h2>
        <span className="text-xs text-slate-400">people who may need help today</span>
        {items.length > 6 && <button className="btn-ghost ml-auto !text-xs" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length}`}</button>}
      </div>
      {items.length === 0 ? <Empty icon="🟢" text="All clear. Nobody is behind right now." /> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((i) => (
            <li key={i.userId} className={`rounded-xl border p-3 ${TONE[i.severity]}`}>
              <div className="flex items-center gap-2">
                <Avatar userId={i.userId} name={i.name} size={30} />
                <p className="truncate text-sm font-semibold text-ink-900">{i.name}</p>
                <span className={`ml-auto h-2.5 w-2.5 shrink-0 rounded-full ${DOT[i.severity]}`} title={`${i.severity} priority`} />
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-slate-600">{i.reasons.map((r) => <li key={r}>• {r}</li>)}</ul>
              {i.taskIds[0] && <Link href={`/tasks/${i.taskIds[0]}`} className="mt-2 inline-block text-xs font-semibold text-accent-600 hover:underline">Open task →</Link>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
