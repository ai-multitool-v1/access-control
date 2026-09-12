import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient.js';
import { SpatialCard } from '../components/ui.jsx';

export default function Login() {
  const [mode, setMode] = useState('login'); // login | register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'register') {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        setInfo('Account created. Check your email to confirm, then sign in.');
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
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
          <div className="animate-floaty flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-cyan shadow-glow">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="h-7 w-7">
              <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Access Control</h1>
          <p className="text-sm text-slate-400">Parent sign-in for family protection</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label-text" htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" className="input-field"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="parent@example.com" />
          </div>
          <div>
            <label className="label-text" htmlFor="password">Password</label>
            <input id="password" type="password" required minLength={6} autoComplete="current-password"
              className="input-field" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" />
          </div>

          {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
          {info && <p className="rounded-lg border border-accent-green/30 bg-accent-green/10 px-3 py-2 text-sm text-accent-green">{info}</p>}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <button
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setInfo(''); }}
          className="mt-4 w-full text-center text-sm text-slate-400 hover:text-slate-200"
        >
          {mode === 'login' ? "New parent? Create an account →" : 'Already registered? Sign in →'}
        </button>
      </SpatialCard>
    </div>
  );
}
