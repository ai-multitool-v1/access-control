import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient.js';
import { PREVIEW_MODE, PREVIEW_USER } from '../lib/preview.js';
import { PageHeader, SpatialCard, Stat } from '../components/ui.jsx';
import { api } from '../services/api.js';

/**
 * Profile — the parent's account hub: identity, password change, plan status,
 * and shortcuts to the settings that matter (notifications, Telegram, devices).
 */
export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [devices, setDevices] = useState([]);
  const [sub, setSub] = useState(null);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (PREVIEW_MODE) {
      setUser(PREVIEW_USER);
      return;
    }
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    api('/api/devices').then((d) => setDevices(d.devices || [])).catch(() => {});
    api('/api/subscription').then((s) => setSub(s.subscription)).catch(() => {});
  }, []);

  async function changePassword(e) {
    e.preventDefault();
    setMsg(''); setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== password2) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setMsg('Password updated — use it on your next sign in.');
      setPassword('');
      setPassword2('');
    } catch (err) {
      setError(err.message || 'Could not update the password.');
    } finally {
      setBusy(false);
    }
  }

  const createdAt = user?.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { dateStyle: 'long' }) : '—';
  const lastSignIn = user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const online = devices.filter((d) => d.status === 'online').length;

  return (
    <div>
      <PageHeader title="Profile" subtitle="Your account & preferences" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Devices" value={devices.length} sub="paired" />
        <Stat label="Online now" value={online} sub="connected" accent={online > 0 ? 'text-neon' : 'text-slate-500'} />
        <Stat label="Plan" value={sub?.plan === 'premium' ? 'Premium' : 'Free'} sub={sub?.status || ''} accent={sub?.plan === 'premium' ? 'text-neon' : 'text-slate-300'} />
        <Stat label="Member since" value={createdAt} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SpatialCard className="p-6">
          <h3 className="mb-4 font-mono text-base font-black uppercase tracking-widest text-white">Account</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-2 border-space-600 bg-space-700/40 px-4 py-3">
              <span className="font-mono text-xs uppercase tracking-wider text-slate-500">Email</span>
              <span className="max-w-[60%] truncate font-bold text-slate-200">{user?.email || '…'}</span>
            </div>
            <div className="flex justify-between border-2 border-space-600 bg-space-700/40 px-4 py-3">
              <span className="font-mono text-xs uppercase tracking-wider text-slate-500">User ID</span>
              <span className="max-w-[60%] truncate font-mono text-xs text-slate-400">{user?.id || '…'}</span>
            </div>
            <div className="flex justify-between border-2 border-space-600 bg-space-700/40 px-4 py-3">
              <span className="font-mono text-xs uppercase tracking-wider text-slate-500">Last sign in</span>
              <span className="font-bold text-slate-200">{lastSignIn}</span>
            </div>
          </div>
        </SpatialCard>

        <SpatialCard className="p-6">
          <h3 className="mb-4 font-mono text-base font-black uppercase tracking-widest text-white">Change password</h3>
          {msg && <p className="mb-3 border-2 border-neon/50 bg-neon/10 px-3 py-2 text-sm text-neon">{msg}</p>}
          {error && <p className="mb-3 border-2 border-hazard/60 bg-hazard/10 px-3 py-2 text-sm text-red-300">{error}</p>}
          <form onSubmit={changePassword} className="space-y-3">
            <div>
              <label className="label-text">New password</label>
              <input
                type="password"
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label-text">Repeat new password</label>
              <input
                type="password"
                className="input-field"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy || PREVIEW_MODE}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </SpatialCard>

        <SpatialCard className="p-6">
          <h3 className="mb-4 font-mono text-base font-black uppercase tracking-widest text-white">Preferences</h3>
          <p className="mb-4 text-sm text-slate-400">
            Fine-tune what the dashboard tells you about and how alerts reach you.
          </p>
          <div className="grid gap-2">
            <Link to="/notifications" className="btn-ghost w-full">Event notification settings</Link>
            <Link to="/telegram" className="btn-ghost w-full">Telegram delivery</Link>
            <Link to="/settings" className="btn-ghost w-full">Account settings</Link>
          </div>
        </SpatialCard>

        <SpatialCard className="p-6">
          <h3 className="mb-4 font-mono text-base font-black uppercase tracking-widest text-white">Danger zone</h3>
          <p className="mb-4 text-sm text-slate-400">
            Signing out keeps every paired device and policy running in the background.
            Devices stay paired until you revoke them individually.
          </p>
          <button
            className="btn-danger"
            onClick={async () => { await supabase.auth.signOut(); navigate('/login'); }}
          >
            Sign out
          </button>
        </SpatialCard>
      </div>
    </div>
  );
}
