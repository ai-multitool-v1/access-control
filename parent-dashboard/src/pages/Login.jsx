import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { API_BASE } from '../lib/config.js';
import { deviceFingerprint, fetchCaptcha, verifyCaptchaToken, logAuthEvent } from '../lib/security.js';
import { SpatialCard } from '../components/ui.jsx';

export default function Login() {
  const [mode, setMode] = useState('login'); // login | register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState(null); // { challenge, token }
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const navigate = useNavigate();

  async function loadCaptcha() {
    setError('');
    try {
      const c = await fetchCaptcha();
      setCaptcha(c);
      setCaptchaAnswer('');
    } catch (e) {
      setError(e.message || 'Security check unavailable');
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (!captcha) {
        await loadCaptcha();
        setInfo('Solve the security check to continue.');
        return;
      }
      if (mode === 'register') {
        // No email verification needed — the Worker confirms the account
        // server-side with the service-role key, then we sign in directly.
        // Signup is captcha-verified server-side BEFORE the account exists.
        const res = await fetch(`${API_BASE}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            captchaToken: captcha.token,
            captchaAnswer: Number(captchaAnswer),
            fingerprint: deviceFingerprint(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = data?.error?.message || 'Signup failed';
          if (String(data?.error?.code || '').startsWith('captcha_')) setCaptcha(null);
          throw new Error(msg);
        }
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        await logAuthEvent('register');
        navigate('/dashboard');
      } else {
        // Login: verify the math challenge one-time server-side, then sign in.
        const v = await verifyCaptchaToken(captcha.token, Number(captchaAnswer));
        if (!v.ok) {
          setCaptcha(null);
          throw new Error(v.data?.error?.message || 'Security check failed');
        }
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) {
          setCaptcha(null);
          throw err;
        }
        const logged = await logAuthEvent('login');
        if (logged.banned) {
          // Banned account — session revoked and the reason shown.
          await supabase.auth.signOut().catch(() => {});
          setError(logged.message || 'Account suspended');
          return;
        }
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <SpatialCard className="w-full max-w-md animate-fade-up p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="animate-floaty flex h-14 w-14 items-center justify-center border-2 border-neon bg-neon/10 shadow-brutal-neon">
            <ShieldCheck className="h-7 w-7 text-neon" />
          </div>
          <h1 className="font-mono text-2xl font-black uppercase tracking-[0.2em] text-white">Access Control</h1>
          <p className="font-mono text-[11px] uppercase tracking-widest text-neon-dim">Next-gen family protection system</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label-text" htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" className="input-field"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="parent@example.com" />
          </div>
          <div>
            <label className="label-text" htmlFor="password">Password</label>
            <input id="password" type="password" required minLength={6}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              className="input-field" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" />
          </div>

          {captcha && (
            <div>
              <label className="label-text" htmlFor="captcha">Security check — {captcha.challenge} = ?</label>
              <div className="flex gap-2">
                <input id="captcha" type="number" required inputMode="numeric"
                  className="input-field" value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)} placeholder="Answer" />
                <button type="button" onClick={loadCaptcha} disabled={busy}
                  className="btn-ghost whitespace-nowrap font-mono text-[10px] uppercase">
                  New
                </button>
              </div>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-600">
                Worker-signed one-time challenge · 5 min expiry
              </p>
            </div>
          )}

          {error && <p className="border-2 border-hazard/60 bg-hazard/10 px-3 py-2 font-mono text-xs text-red-300">{error}</p>}
          {info && <p className="border-2 border-neon/60 bg-neon/10 px-3 py-2 font-mono text-xs text-neon">{info}</p>}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {mode === 'register' && (
          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-wider text-slate-500">
            No email verification needed — instant access
          </p>
        )}

        <button
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setInfo(''); setCaptcha(null); }}
          className="mt-4 w-full text-center font-mono text-xs text-slate-400 hover:text-neon"
        >
          {mode === 'login' ? 'New parent? Create an account →' : 'Already registered? Sign in →'}
        </button>

        <div className="mt-6 border-t-2 border-space-600 pt-4 text-center">
          <a href="https://t.me/setbd_ceo" target="_blank" rel="noreferrer"
            className="font-mono text-[10px] uppercase tracking-widest text-neon-dim hover:text-neon">
            Developed By Asif Khan — The CEO Of Silent Exploit Team Bd
          </a>
        </div>
      </SpatialCard>
    </div>
  );
}
