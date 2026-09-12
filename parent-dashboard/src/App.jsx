import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { useAuth } from './hooks/useAuth.jsx';
import { assertConfig } from './lib/config.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Devices from './pages/Devices.jsx';
import DeviceDetail from './pages/DeviceDetail.jsx';
import Pairing from './pages/Pairing.jsx';
import Monitoring from './pages/Monitoring.jsx';
import Usage from './pages/Usage.jsx';
import Location from './pages/Location.jsx';
import Policies from './pages/Policies.jsx';
import Notifications from './pages/Notifications.jsx';
import Settings from './pages/Settings.jsx';
import Telegram from './pages/Telegram.jsx';
import NotFound from './pages/NotFound.jsx';

export default function App() {
  const { loading } = useAuth();
  const missing = assertConfig();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (missing.length > 0) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20">
        <div className="spatial-card p-6">
          <h1 className="text-xl font-bold text-white">Configuration needed</h1>
          <p className="mt-2 text-sm text-slate-400">
            This dashboard is missing public environment variables. Set them in a{' '}
            <code className="text-accent-soft">.env</code> file (local) or in Cloudflare Pages
            environment settings (production), then rebuild:
          </p>
          <ul className="mt-3 space-y-1 text-sm text-red-300">
            {missing.map((m) => (
              <li key={m}>• {m}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/devices" element={<Devices />} />
        <Route path="/devices/:id" element={<DeviceDetail />} />
        <Route path="/pairing" element={<Pairing />} />
        <Route path="/monitoring" element={<Monitoring />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="/location" element={<Location />} />
        <Route path="/policies" element={<Policies />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/telegram" element={<Telegram />} />
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
