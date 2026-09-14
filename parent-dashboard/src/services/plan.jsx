// Plan / subscription context — the parent dashboard's view of Free vs Pro.
// The SERVER is the enforcer (Worker + DO); this context only drives UI
// (lock chips, upgrade banners, pricing links) and stays in sync with
// /api/subscription. Preview mode resolves to premium so every screen
// stays explorable in local preview builds.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { PREVIEW_MODE } from '../lib/preview.js';

const PlanCtx = createContext({
  loading: true,
  premium: false,
  plan: 'free',
  tier: null,
  expiresAt: null,
  deviceLimit: 1,
  boundDevices: 0,
  features: {},
  refresh: () => {},
});

export function PlanProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    premium: false,
    plan: 'free',
    tier: null,
    expiresAt: null,
    deviceLimit: 1,
    boundDevices: 0,
    features: {
      screenMirror: false, fileManager: false, mediaGallery: false,
      liveLocation: false, multipleDevices: false,
    },
  });

  const refresh = useCallback(async () => {
    if (PREVIEW_MODE) {
      setState((s) => ({
        ...s, loading: false, premium: true, plan: 'premium', tier: 'lifetime',
        deviceLimit: 100,
        features: { screenMirror: true, fileManager: true, mediaGallery: true, liveLocation: true, multipleDevices: true },
      }));
      return;
    }
    try {
      const d = await api('/api/subscription');
      setState({
        loading: false,
        premium: Boolean(d.premium),
        plan: d.subscription?.plan || 'free',
        tier: d.subscription?.tier || null,
        expiresAt: d.subscription?.current_period_end || null,
        deviceLimit: d.deviceLimit ?? 1,
        boundDevices: d.boundDevices ?? 0,
        features: d.features || {},
      });
    } catch {
      setState((s) => ({ ...s, loading: false })); // keep last known / default free
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh the plan when the tab becomes visible again (expiry decay,
  // approvals landing while the parent was away).
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <PlanCtx.Provider value={value}>{children}</PlanCtx.Provider>;
}

export function usePlan() {
  return useContext(PlanCtx);
}
