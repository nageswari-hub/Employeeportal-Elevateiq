'use client';
import { Loading } from '../../components/ui';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth-context';

interface Batch {
  id: string;
  name: string;
}
interface Assessment {
  id: string;
  title: string;
  type: string;
  _count: { questions: number; attempts: number };
}
interface Question {
  id: string;
  prompt: string;
  options: string[] | null;
  correctIndex: number | null;
  points: number;
}
interface Detail extends Assessment {
  questions: Question[];
}

export default function AssessmentsPage() {
  const { user, loading } = useRequireAuth();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState('');
  const [rows, setRows] = useState<Assessment[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [attempts, setAttempts] = useState<any[]>([]);
  const [best, setBest] = useState<any>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [title, setTitle] = useState('');
  const [qPrompt, setQPrompt] = useState('');
  const [qOptions, setQOptions] = useState('');
  const [qCorrect, setQCorrect] = useState('0');

  useEffect(() => {
    api<Batch[]>('/batches').then(setBatches).catch(() => {});
  }, []);

  async function load(bid: string) {
    setBatchId(bid);
    setDetail(null);
    if (!bid) {
      setRows([]);
      return;
    }
    try {
      setRows(await api<Assessment[]>(`/assessments?batchId=${bid}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Load failed');
    }
  }

  async function open(id: string) {
    setErr('');
    setMsg('');
    try {
      const d = await api<Detail>(`/assessments/${id}`);
      setDetail(d);
      setAnswers({});
      const m = await api<{ attempts: any[]; best: any }>(`/assessments/${id}/my-attempts`);
      setAttempts(m.attempts);
      setBest(m.best);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Load failed');
    }
  }

  async function submit() {
    if (!detail) return;
    setErr('');
    setMsg('');
    try {
      const ordered = detail.questions.map((q, i) => answers[q.id] ?? answers[String(i)] ?? -1);
      const r = await api<any>(`/assessments/${detail.id}/attempts`, { method: 'POST', body: { answers: ordered, questionIds: detail.questions.map((q) => q.id) } });
      setMsg(detail.type === 'QUIZ' ? `Submitted. Auto-graded score: ${r.score}/${r.maxScore}` : 'Submitted for lead grading.');
      await open(detail.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Submit failed');
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/assessments', { method: 'POST', body: { batchId, title, type: 'QUIZ' } });
      setTitle('');
      await load(batchId);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Create failed');
    }
  }

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    try {
      await api(`/assessments/${detail.id}/questions`, {
        method: 'POST',
        body: { prompt: qPrompt, options: qOptions.split(',').map((s) => s.trim()).filter(Boolean), correctIndex: Number(qCorrect), points: 1 },
      });
      setQPrompt('');
      setQOptions('');
      await open(detail.id);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Add failed');
    }
  }

  if (loading || !user) return <Loading />;
  const isLead = user.role === 'ADMIN' || user.role === 'TEAM_LEAD';

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Assessments</h1>
      {err && <p className="err">{err}</p>}
      {msg && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}
      <div className="card">
        <select className="input max-w-xs" value={batchId} onChange={(e) => load(e.target.value)}>
          <option value="">Select a batch…</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      {batchId && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="card">
            <h2 className="mb-2 font-semibold">Quizzes ({rows.length})</h2>
            <ul className="space-y-1 text-sm">
              {rows.map((a) => (
                <li key={a.id}>
                  <button className="text-left hover:underline" onClick={() => open(a.id)}>
                    <b>{a.title}</b> <span className="text-slate-500">· {a.type} · {a._count.questions} Q</span>
                  </button>
                </li>
              ))}
            </ul>
            {isLead && (
              <form onSubmit={create} className="mt-3 flex gap-2">
                <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New quiz title" />
                <button className="btn">Add</button>
              </form>
            )}
          </div>
          <div className="card md:col-span-2">
            {!detail ? (
              <p className="text-sm text-slate-500">Pick an assessment to attempt it.</p>
            ) : (
              <>
                <h2 className="font-semibold">{detail.title} <span className="text-sm font-normal text-slate-500">({detail.type})</span></h2>
                <ol className="my-3 space-y-3 text-sm">
                  {detail.questions.map((q, i) => (
                    <li key={q.id} className="rounded bg-slate-50 p-2">
                      <p><b>Q{i + 1}.</b> {q.prompt} <span className="text-slate-500">({q.points} pt)</span></p>
                      {q.options ? (
                        <div className="mt-1 space-y-1">
                          {q.options.map((op, oi) => (
                            <label key={oi} className="flex items-center gap-2">
                              <input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => setAnswers((p) => ({ ...p, [q.id]: oi }))} />
                              {op}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <input className="input mt-1" placeholder="Your answer (text)" onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value as any }))} />
                      )}
                    </li>
                  ))}
                  {detail.questions.length === 0 && <p className="text-sm text-slate-500">No questions yet.</p>}
                </ol>
                {detail.questions.length > 0 && <button className="btn" onClick={submit}>Submit attempt</button>}
                {best && <p className="mt-2 text-sm">Best score so far: <b>{String(best.score)}/{best.maxScore}</b> ({attempts.length} attempts)</p>}
                {isLead && (
                  <form onSubmit={addQuestion} className="mt-4 space-y-2 rounded border border-slate-200 p-2">
                    <p className="text-sm font-semibold">Add MCQ</p>
                    <input className="input" required value={qPrompt} onChange={(e) => setQPrompt(e.target.value)} placeholder="Prompt" />
                    <input className="input" required value={qOptions} onChange={(e) => setQOptions(e.target.value)} placeholder="Options, comma separated" />
                    <input className="input" type="number" min={0} value={qCorrect} onChange={(e) => setQCorrect(e.target.value)} placeholder="Correct index (0-based)" />
                    <button className="btn">Add question</button>
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
