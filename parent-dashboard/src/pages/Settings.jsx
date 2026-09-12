import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient.js';
import { PageHeader, SpatialCard } from '../components/ui.jsx';

export default function Settings() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  return (
    <div>
      <PageHeader title="Settings" subtitle="Account" />
      <div className="grid gap-6 lg:grid-cols-2">
        <SpatialCard className="p-6">
          <h3 className="mb-3 text-lg font-semibold text-white">Profile</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between rounded-xl bg-white/5 px-4 py-3">
              <span className="text-slate-400">Email</span>
              <span className="font-medium text-slate-200">{user?.email || '…'}</span>
            </div>
            <div className="flex justify-between rounded-xl bg-white/5 px-4 py-3">
              <span className="text-slate-400">User ID</span>
              <span className="max-w-[220px] truncate font-mono text-xs text-slate-400">{user?.id || '…'}</span>
            </div>
          </div>
        </SpatialCard>

        <SpatialCard className="p-6">
          <h3 className="mb-3 text-lg font-semibold text-white">Session</h3>
          <p className="mb-4 text-sm text-slate-400">
            Sign out of this dashboard. Paired devices and policies keep running in the background.
          </p>
          <button className="btn-ghost" onClick={async () => { await supabase.auth.signOut(); navigate('/login'); }}>
            Sign out
          </button>
        </SpatialCard>
      </div>
    </div>
  );
}
