// PUBLIC CONFIG — safe to bundle into the frontend.
// Copy .env.example to .env and fill these in.
import { PREVIEW_MODE } from './preview.js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || (PREVIEW_MODE ? 'https://preview.placeholder.supabase.co' : '');
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || (PREVIEW_MODE ? 'preview-placeholder-anon-key' : '');
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
export const WS_BASE = (import.meta.env.VITE_WS_BASE || API_BASE.replace(/^http/, 'ws') || '').replace(/\/+$/, '');

export function assertConfig() {
  if (PREVIEW_MODE) return [];
  const missing = [];
  if (!SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) missing.push('VITE_SUPABASE_ANON_KEY');
  if (!API_BASE) missing.push('VITE_API_BASE');
  if (!WS_BASE) missing.push('VITE_WS_BASE');
  return missing;
}
