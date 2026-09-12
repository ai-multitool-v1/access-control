// PUBLIC CONFIG — safe to bundle into the frontend.
// Copy .env.example to .env and fill these in.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
export const WS_BASE = (import.meta.env.VITE_WS_BASE || API_BASE.replace(/^http/, 'ws') || '').replace(/\/+$/, '');

export function assertConfig() {
  const missing = [];
  if (!SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) missing.push('VITE_SUPABASE_ANON_KEY');
  if (!API_BASE) missing.push('VITE_API_BASE');
  if (!WS_BASE) missing.push('VITE_WS_BASE');
  return missing;
}
