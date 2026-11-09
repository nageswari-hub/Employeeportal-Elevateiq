'use client';
import { Loading } from '../../components/ui';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';

interface Batch {
  id: string;
  name: string;
}
interface Plan {
  id: string;
  title: string;
  batch: { name: string };
  _count: { items: number };
}
interface Item {
  id: string;
  dayNumber: number;
  topic: string;
  description: string | null;
  practiceTask: string | null;
  materials: Array<{ id: string; kind: string; title: string; url: string | null }>;
}
interface PlanDetail extends Plan {
  items: Item[];
  myPct: number;
  myDone: number;
  myTotal: number;
}

export default function TrainingPage() {
  const { user, loading } = useRequireAuth();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const [title, setTitle] = useState('');
  const [day, setDay] = useState('1');
  const [topic, setTopic] = useState('');

  useEffect(() => {
    api<Batch[]>('/batches').then(setBatches).catch(() => {});
  }, []);

  async function loadPlans(bid: string) {
    setBatchId(bid);
    setPlan(null);
    if (!bid) {
      setPlans([]);
      return;
    }
    try {
      setPlans(await api<Plan[]>(`/training-plans?batchId=${bid}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Load failed');
    }
  }

  async function openPlan(id: string) {
    try {
      const d = await api<PlanDetail>(`/training-plans/${id}`);
      setPlan(d);
      // derive done set by fetching progress implicitly: items lack flags, so check each via batch-progress? Simpler: keep local toggles.
      setDone(new Set());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Load failed');
    }
  }

  async function toggle(itemId: string, isDone: boolean) {
    try {
      await api(`/training-items/${itemId}/progress`, { method: 'POST', body: { isDone } });
      setDone((prev) => {
        const n = new Set(prev);
        if (isDone) n.add(itemId);
        else n.delete(itemId);
        return n;
      });
      if (plan) await openPlan(plan.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
    }
  }

  async function createPlan(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await api('/training-plans', { method: 'POST', body: { batchId, title } });
      setTitle('');
      await loadPlans(batchId);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Create failed');
    }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!plan) return;
    try {
      await api(`/training-plans/${plan.id}/items`, { method: 'POST', body: { dayNumber: Number(day), topic } });
      setTopic('');
      await openPlan(plan.id);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Add failed');
    }
  }

  if (loading || !user) return <Loading />;
  const isLead = user.role === 'ADMIN' || user.role === 'TEAM_LEAD';

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Training</h1>
      {err && <p className="err">{err}</p>}
      <div className="card flex flex-wrap gap-2">
        <select className="input max-w-xs" value={batchId} onChange={(e) => loadPlans(e.target.value)}>
          <option value="">Select a batch…</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      {batchId && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="card">
            <h2 className="mb-2 font-semibold">Plans ({plans.length})</h2>
            <ul className="space-y-1 text-sm">
              {plans.map((p) => (
                <li key={p.id}>
                  <button className="text-left hover:underline" onClick={() => openPlan(p.id)}>
                    <b>{p.title}</b> <span className="text-slate-500">· {p._count.items} days</span>
                  </button>
                </li>
              ))}
              {plans.length === 0 && <p className="text-sm text-slate-500">No plan for this batch yet.</p>}
            </ul>
            {isLead && (
              <form onSubmit={createPlan} className="mt-3 flex gap-2">
                <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New plan title" />
                <button className="btn">Add</button>
              </form>
            )}
          </div>
          <div className="card md:col-span-2">
            {!plan ? (
              <p className="text-sm text-slate-500">Pick a plan to see the day-wise checklist.</p>
            ) : (
              <>
                <h2 className="font-semibold">{plan.title}</h2>
                <p className="mb-2 text-sm text-slate-600">My progress: {plan.myDone}/{plan.myTotal} ({plan.myPct}%)</p>
                <div className="mb-3 h-2 rounded bg-slate-200">
                  <div className="h-2 rounded bg-brand-600" style={{ width: `${plan.myPct}%` }} />
                </div>
                <ul className="space-y-2 text-sm">
                  {plan.items.map((it) => (
                    <li key={it.id} className="rounded bg-slate-50 p-2">
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          defaultChecked={done.has(it.id)}
                          onChange={(e) => toggle(it.id, e.target.checked)}
                        />
                        <span>
                          <b>Day {it.dayNumber}:</b> {it.topic}
                          {it.practiceTask && <span className="block text-slate-600">Practice: {it.practiceTask}</span>}
                          {it.materials.map((m) => (
                            <span key={m.id} className="block">
                              [{m.kind}] {m.url ? <a className="text-brand-600 hover:underline" href={m.url} target="_blank" rel="noreferrer">{m.title}</a> : m.title}
                            </span>
                          ))}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {isLead && (
                  <form onSubmit={addItem} className="mt-3 flex gap-2">
                    <input className="input max-w-[100px]" required type="number" min={1} value={day} onChange={(e) => setDay(e.target.value)} placeholder="Day" />
                    <input className="input" required value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic" />
                    <button className="btn">Add day</button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
