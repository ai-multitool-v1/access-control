#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Access Control — one-shot Cloudflare deploy (Worker + Durable Objects + Pages)
# Works on Linux, macOS and Termux (Android).
#
# Usage (Termux):
#   pkg install -y nodejs-lts git
#   cd access-control
#   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... bash scripts/deploy-cloudflare.sh
# Values not exported interactively are asked for with a prompt.
#
# Everything typed here stays on this machine / goes only to Cloudflare.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_DIR="$ROOT/cloudflare/worker"
DASH_DIR="$ROOT/parent-dashboard"

ask() { # ask VAR_NAME "prompt"
  local __var="$1" __prompt="$2" __cur="${!1:-}"
  if [ -n "$__cur" ]; then
    echo "• $__var: already set, reusing"
    return 0
  fi
  read -r -p "$__prompt: " "$__var"
}

echo "════════════════════════════════════════════════════"
echo " Access Control → Cloudflare deploy"
echo "════════════════════════════════════════════════════"

ask CLOUDFLARE_API_TOKEN   "Cloudflare API token (Workers+Pages edit)"
ask CLOUDFLARE_ACCOUNT_ID  "Cloudflare Account ID"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

ask SUPABASE_URL           "Supabase URL, e.g. https://xxxx.supabase.co (enter = skip)"
ask SUPABASE_ANON_KEY      "Supabase anon key (enter = skip)"
ask SUPABASE_SERVICE_ROLE_KEY "Supabase service-role key (enter = skip)"
ask TELEGRAM_BOT_TOKEN     "Telegram bot token (enter = skip)"
ask FCM_SERVICE_ACCOUNT_JSON "Firebase service-account JSON (single line, enter = skip)"

echo ""
echo "→ Deploying Worker + Durable Objects..."
cd "$WORKER_DIR"
[ -d node_modules ] || npm install --no-audit --no-fund

ARGS=()
[ -n "${SUPABASE_URL:-}" ]          && ARGS+=(--var "SUPABASE_URL:$SUPABASE_URL")
[ -n "${SUPABASE_ANON_KEY:-}" ]     && ARGS+=(--var "SUPABASE_ANON_KEY:$SUPABASE_ANON_KEY")
npx wrangler deploy "${ARGS[@]}"

put_secret() {
  local name="$1" value="$2"
  if [ -z "$value" ]; then echo "• secret $name: skipped (empty)"; return 0; fi
  printf '%s' "$value" | npx wrangler secret put "$name" >/dev/null \
    && echo "• secret $name: set" || echo "• secret $name: FAILED (check token scopes)"
}
put_secret SUPABASE_SERVICE_ROLE_KEY  "${SUPABASE_SERVICE_ROLE_KEY:-}"
put_secret TELEGRAM_BOT_TOKEN         "${TELEGRAM_BOT_TOKEN:-}"
put_secret FCM_SERVICE_ACCOUNT_JSON   "${FCM_SERVICE_ACCOUNT_JSON:-}"

echo ""
read -r -p "Also deploy the parent dashboard to Cloudflare Pages? [y/N]: " ANS
if [ "${ANS:-n}" = "y" ] || [ "${ANS:-n}" = "Y" ]; then
  ask VITE_SUPABASE_URL    "VITE_SUPABASE_URL (same as SUPABASE_URL)"
  ask VITE_SUPABASE_ANON_KEY "VITE_SUPABASE_ANON_KEY"
  ask VITE_API_BASE        "VITE_API_BASE, e.g. https://access-control-api.<subdomain>.workers.dev"
  ask VITE_WS_BASE         "VITE_WS_BASE, e.g. wss://access-control-api.<subdomain>.workers.dev"
  cd "$DASH_DIR"
  [ -d node_modules ] || npm install --no-audit --no-fund
  VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
  VITE_API_BASE="$VITE_API_BASE" \
  VITE_WS_BASE="$VITE_WS_BASE" \
    npm run build
  npx wrangler pages project create access-control-dashboard \
    --production-branch=main 2>/dev/null || echo "• Pages project already exists"
  npx wrangler pages deploy dist \
    --project-name=access-control-dashboard --branch=main --commit-dirty=true
fi

echo ""
echo "✅ Done. Worker: https://access-control-api.<your-subdomain>.workers.dev"
echo "   Dashboard (if deployed): https://access-control-dashboard.pages.dev"
