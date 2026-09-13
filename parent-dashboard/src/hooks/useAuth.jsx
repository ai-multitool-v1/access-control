import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { PREVIEW_MODE, PREVIEW_USER } from '../lib/preview.js';

const AuthCtx = createContext({ session: null, user: null, loading: true });

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (PREVIEW_MODE) {
      setSession({ user: PREVIEW_USER, preview: true });
      setLoading(false);
      return undefined;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = {
    session,
    user: session?.user || null,
    loading,
    signOut: () => (PREVIEW_MODE ? Promise.resolve() : supabase.auth.signOut()),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
