#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Access Control — apply Supabase migrations (12 tables + RLS) via the CLI.
# Works on Linux, macOS and Termux (Android).
#
# Usage (Termux):
#   pkg install -y nodejs-lts git
#   npm install -g supabase        # or: npx supabase (no global install)
#   cd access-control
#   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_ID=... SUPABASE_DB_PASSWORD=... \
#     bash scripts/deploy-supabase.sh
#
# No-CLI alternative: paste supabase/migrations/0001_init.sql into
# Supabase Dashboard → SQL Editor → Run. Identical result.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ask() {
  local __var="$1" __prompt="$2" __cur="${!1:-}"
  if [ -n "$__cur" ]; then
    echo "• $__var: already set, reusing"
    return 0
  fi
  read -r -p "$__prompt: " "$__var"
}

echo "════════════════════════════════════════════════════"
echo " Access Control → Supabase migrations"
echo "════════════════════════════════════════════════════"

ask SUPABASE_ACCESS_TOKEN "Supabase access token (Dashboard → Account → Access Tokens)"
ask SUPABASE_PROJECT_ID   "Supabase project ref (Settings → General → Reference ID)"
ask SUPABASE_DB_PASSWORD  "Supabase database password"
export SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_ID SUPABASE_DB_PASSWORD

cd "$ROOT/supabase"

if command -v supabase >/dev/null 2>&1; then
  SUPABASE_CMD=(supabase)
else
  echo "→ supabase CLI not found globally, using npx…"
  SUPABASE_CMD=(npx --yes supabase)
fi

echo "→ Linking project…"
"${SUPABASE_CMD[@]}" link --project-ref "$SUPABASE_PROJECT_ID"

echo "→ Pushing migrations…"
"${SUPABASE_CMD[@]}" db push

echo ""
echo "✅ Done. Verify in Supabase Dashboard → Table Editor (12 tables) and"
echo "   Authentication → Policies (RLS enabled on every table)."
