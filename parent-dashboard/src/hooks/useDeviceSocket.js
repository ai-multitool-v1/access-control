import { useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { connect, disconnect, onState } from '../services/ws.js';

// Keeps one live socket for the given device while the component is mounted.
export function useDeviceSocket(deviceId, onStateChange) {
  useEffect(() => {
    if (!deviceId) return undefined;
    let active = true;
    let off = () => {};

    supabase.auth.getSession().then(({ data }) => {
      const token = data?.session?.access_token;
      if (!active || !token) return;
      connect(deviceId, token);
      off = onState((s) => onStateChange && onStateChange(s));
    });

    return () => {
      active = false;
      off();
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);
}
