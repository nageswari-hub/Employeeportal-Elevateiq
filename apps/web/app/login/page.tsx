'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { api, ApiError } from '../../lib/api';
import { AuthFrame } from '../../components/AuthFrame';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotMsg, setForgotMsg] = useState('');
  const [isShaking, setIsShaking] = useState(false);

  // If a valid session already exists (access or refresh cookie), go straight in.
  // Reuses the single /auth/me call made by AuthProvider instead of firing a
  // second one on every visit to the login page.
  useEffect(() => {
    if (loading || !user) return;
    router.replace(user.mustChangePassword ? '/change-password' : '/dashboard');
  }, [loading, user, router]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('elevateiq_saved_email');
      if (saved) {
        setEmail(saved);
      }
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  function triggerShake() {
    setIsShaking(false);
    setTimeout(() => setIsShaking(true), 10);
    setTimeout(() => setIsShaking(false), 500);
  }

  async function forgot() {
    setErr('');
    setForgotMsg('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setErr('Enter your work email above first.');
      triggerShake();
      return;
    }
    try {
      const r = await api<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: { email: trimmed },
      });
      setForgotMsg(r.message || 'Notification sent to your administrator.');
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Could not contact administrator');
      triggerShake();
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setForgotMsg('');

    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      setErr('Enter a valid work email.');
      triggerShake();
      return;
    }
    if (!password) {
      setErr('Enter your password.');
      triggerShake();
      return;
    }

    setBusy(true);

    try {
      try {
        localStorage.setItem('elevateiq_saved_email', trimmed);
      } catch {}
      await login(trimmed, password);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : 'Could not sign in. Check your email and password.');
      triggerShake();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <section className={`a card ${isShaking ? 'shake' : ''}`} aria-labelledby="t">
        {/* Flying mail illustration with notification badge */}
        <svg className="a mail" width="96" height="64" viewBox="0 0 96 64" aria-hidden="true">
          <path d="M2 24h18M6 32h14M10 40h10" stroke="#5aa0ff" strokeWidth="2.5" strokeLinecap="round" />
          <rect x="22" y="14" width="64" height="42" rx="6" fill="#1456e8" />
          <path d="M24 18l30 20 30-20" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
          <circle cx="80" cy="14" r="9" fill="#ff5a14" stroke="#fff" strokeWidth="2" />
          <text x="80" y="18" fontSize="11" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="Poppins,sans-serif">1</text>
        </svg>

        <h2 className="a" id="t">Welcome back 👋</h2>
        <p className="a s">Sign in with your work email to open your workspace.</p>

        <form id="f" onSubmit={submit} noValidate>
          {/* Work Email Field */}
          <label className="a lb" htmlFor="em" style={{ top: '185px' }}>
            <svg viewBox="0 0 24 24">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
            WORK EMAIL
          </label>
          <div className="a fd" style={{ top: '209px' }}>
            <input
              id="em"
              type="email"
              placeholder="you@company.com"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* Password Field */}
          <label className="a lb" htmlFor="pw" style={{ top: '257px' }}>
            <svg viewBox="0 0 24 24">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            PASSWORD
          </label>
          <div className="a fd" style={{ top: '281px' }}>
            <input
              id="pw"
              type={show ? 'text' : 'password'}
              placeholder="••••••••••••"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="show"
              id="sh"
              aria-label={show ? 'Hide password' : 'Show password'}
              onClick={() => setShow(!show)}
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>

          {/* Submit Sign In Button */}
          <button className="a btn" type="submit" disabled={busy}>
            {busy ? (
              <span>Signing in…</span>
            ) : (
              <>
                <svg viewBox="0 0 24 24">
                  <path d="M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
                </svg>
                <span>Sign in</span>
              </>
            )}
          </button>

          {/* Alert Message Area */}
          {err && <p className="a msg" id="m" role="alert">{err}</p>}
          {forgotMsg && <p className="a msg !text-emerald-600" id="m" role="status">{forgotMsg}</p>}
        </form>

        {/* Forgot Password Note */}
        <p className="a note">
          Forgot your password?{' '}
          <a
            href="#notify"
            onClick={(e) => {
              e.preventDefault();
              forgot();
            }}
          >
            Notify my admin
          </a>{' '}
          - they will give you a temporary one.
        </p>
      </section>
    </AuthFrame>
  );
}
