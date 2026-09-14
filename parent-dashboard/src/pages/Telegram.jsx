import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { PageHeader, SpatialCard, ErrorBanner } from '../components/ui.jsx';

export default function Telegram() {
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/telegram/settings').then((d) => {
      setConfigured(d.configured);
      setChatId(d.chatId || '');
      if (!d.configured) return;
      setMsg(`A bot token is already saved (${d.botToken}). Enter a new one to replace it.`);
    }).catch((e) => setError(e.message)).finally(() => setLoaded(true));
  }, []);

  async function save(e) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      await api('/api/telegram/settings', { method: 'POST', body: { botToken, chatId } });
      setConfigured(true);
      setBotToken('');
      setMsg('Saved. The token is stored server-side only — it never appears in this page again.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function test() {
    setMsg(''); setError('');
    try {
      const r = await api('/api/telegram/test', { method: 'POST', body: {} });
      setMsg(r.ok ? String(r.message) : `Failed: ${r.message}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <PageHeader title="Telegram" subtitle="Parent notifications via your own bot" />
      <ErrorBanner message={error} />
      {msg && <p className="animate-fade-up mb-4 border-2 border-neon/40 bg-neon/5 px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-neon shadow-brutal">{msg}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <SpatialCard className="p-6">
          {!loaded ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <form onSubmit={save} className="space-y-4">
              <div>
                <label className="label-text">Bot token {configured && <span className="text-accent-green">(saved)</span>}</label>
                <input className="input-field font-mono" value={botToken} onChange={(e) => setBotToken(e.target.value)}
                  placeholder={configured ? 'Leave blank to keep current token' : '123456789:AA…your-bot-token'} />
              </div>
              <div>
                <label className="label-text">Chat ID</label>
                <input className="input-field font-mono" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="e.g. 123456789" />
                <p className="mt-1.5 text-xs text-slate-500">
                  Send any message to your bot, then open
                  <code className="mx-1 text-accent-soft">api.telegram.org/bot&lt;token&gt;/getUpdates</code>
                  to find your chat id.
                </p>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary flex-1" disabled={!configured && (!botToken || !chatId)}>
                  Save Telegram Settings
                </button>
                <button type="button" className="btn-ghost" onClick={test}>Test Telegram</button>
              </div>
            </form>
          )}
        </SpatialCard>

        <SpatialCard className="p-6 text-sm text-slate-400">
          <h3 className="mb-3 font-mono text-[11px] font-black uppercase tracking-[0.2em] text-neon-dim">How it's used</h3>
          <ul className="list-disc space-y-2 pl-4">
            <li>Device connect / disconnect alerts</li>
            <li>Policy change confirmations</li>
            <li>Bot token + chat ID are stored <b className="text-slate-200">server-side only</b> (Supabase via the Worker)</li>
            <li>Never shipped inside the child APK or this dashboard bundle</li>
          </ul>
        </SpatialCard>
      </div>
    </div>
  );
}
