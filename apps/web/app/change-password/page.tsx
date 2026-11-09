'use client';
import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { AuthFrame } from '../../components/AuthFrame';

export default function ChangePasswordPage() {
  const { reload, logout } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCur, setShowCur] = useState(false);
  const [showNext, setShowNext] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setOk('');
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword: next } });
      setOk('Password changed successfully. Loading your workspace…');
      await reload();
      window.location.href = '/dashboard';
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Change failed');
    } finally {
      setBusy(false);
    }
  }

  const strong = next.length >= 8 && /[A-Za-z]/.test(next) && /\d/.test(next);

  return (
    <AuthFrame>
      <div className="relative rounded-3xl border border-slate-200/85 bg-white p-7 sm:p-10 shadow-[0_20px_50px_rgba(11,36,71,0.08)] backdrop-blur-sm transition duration-300">
        <div className="mb-6 flex flex-col items-center justify-center lg:hidden">
          <img
            src="/elevateiq-logo.png"
            alt="ElevateIQ Logo"
            className="h-10 w-auto object-contain"
          />
          <span className="mt-2 text-[10px] font-bold tracking-[0.2em] text-[#006ADA] uppercase">
            SECURITY SETUP
          </span>
        </div>

        <div className="mb-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0B2447] tracking-tight">Set a new password</h2>
          <p className="mt-2 text-sm text-slate-500 leading-normal">
            Required on your first login. Use at least 8 characters with a letter and a number.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600" htmlFor="cur">
              Current / Temporary Password
            </label>
            <div className="relative">
              <input
                id="cur"
                className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-4 pr-16 text-sm text-slate-800 placeholder-slate-400 transition focus:border-[#006ADA] focus:outline-none focus:ring-4 focus:ring-[#006ADA]/10"
                type={showCur ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrent(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#006ADA] hover:text-[#0058B8]"
                onClick={() => setShowCur(!showCur)}
              >
                {showCur ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-600" htmlFor="nxt">
              New Password
            </label>
            <div className="relative">
              <input
                id="nxt"
                className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-4 pr-16 text-sm text-slate-800 placeholder-slate-400 transition focus:border-[#006ADA] focus:outline-none focus:ring-4 focus:ring-[#006ADA]/10"
                type={showNext ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#006ADA] hover:text-[#0058B8]"
                onClick={() => setShowNext(!showNext)}
              >
                {showNext ? 'Hide' : 'Show'}
              </button>
            </div>
            {next && (
              <p className={`mt-2 text-xs font-medium ${strong ? 'text-emerald-600' : 'text-amber-600'}`}>
                {strong ? '✓ Password criteria met' : 'Needs 8+ characters, a letter and a number'}
              </p>
            )}
          </div>

          {err && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs sm:text-sm text-red-700">
              {err}
            </div>
          )}
          {ok && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs sm:text-sm text-emerald-700">
              {ok}
            </div>
          )}

          <button
            className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#F03D0A] to-[#E03405] py-3.5 text-sm font-bold text-white shadow-[0_4px_16px_rgba(240,61,10,0.32)] transition hover:from-[#E03405] hover:to-[#C92B00] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || !strong}
          >
            {busy ? 'Saving…' : 'Save new password'}
          </button>
          <button
            type="button"
            className="w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
            onClick={logout}
          >
            Log out
          </button>
        </form>
      </div>
    </AuthFrame>
  );
}
