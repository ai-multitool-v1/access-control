# Access Control

A production-quality, consent-based parental-control system:

- **Child Android app** (Kotlin, package `org.setbd.control`, Claymorphism UI)
- **Parent web dashboard** (React + Vite + Tailwind, Spatial UI, deployed to Cloudflare Pages)
- **Cloudflare Worker** — API gateway, auth validation, pairing, server-side Telegram/FCM
- **Cloudflare Durable Objects** — authenticated realtime WebSocket hub (no polling)
- **Supabase** — Auth + PostgreSQL (RLS-secured); used **only** for auth/data, never realtime
- **GitHub Actions** — automatic debug APK build on every push

```
Parent Browser ──HTTPS/WSS──► Cloudflare Worker ──► Durable Object (per device)
                                     │                   │        │
                                     │             WS ───┘        WS
                                     ▼                             ▼
                              Supabase (Auth + Postgres)     Child Android app
                                     │                             │
                                     └── FCM / Telegram (server-side) ◄┘
```

## Repository layout

```
access-control/
├── child-app/            Kotlin Android app (Gradle, package org.setbd.control)
│   └── app/src/main/java/org/setbd/control/
│       ├── onboarding/   Splash → credit → Terms → Permissions → Pairing
│       ├── permissions/  Usage Access, location, overlay, battery, admin checks
│       ├── devicemanagement/ DeviceAdminReceiver + DevicePolicy wrapper
│       ├── monitoring/   device info, usage stats, installed apps, location
│       ├── controls/     PolicyEngine + enforcement service + block screen
│       ├── websocket/    WsClient, CommandProcessor (strict allowlist), RealtimeService
│       ├── boot/         BootReceiver — restore services after reboot
│       ├── diagnostics/  *#*#9999#*#* (fallback *#*#1000#*#*) + diagnostics screen
│       ├── notifications/ FCM service (optional) + notification listener + helpers
│       ├── storage/      EncryptedSharedPreferences + prefs
│       ├── sync/         WorkManager periodic usage/location upload
│       └── ui/           Claymorphism helpers, dashboard, settings, icon hide
├── parent-dashboard/     React 18 + Vite 5 + Tailwind (12 routes)
├── cloudflare/
│   ├── worker/           REST API, auth, pairing endpoints (wrangler project)
│   └── durable-object/   DeviceHub (WS hub) + PairingHub (single-use codes)
├── supabase/migrations/  Full schema + RLS policies
├── notifications/        FCM + Telegram integration guides
├── docs/                 Privacy policy / ToS placeholders
└── .github/workflows/    build-android.yml (APK + dashboard CI)
```

---

## Quickstart ($0 / VPS-free)

### 1. Supabase (auth + database)

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. SQL Editor → paste and run `supabase/migrations/0001_init.sql`.
3. Note the **Project URL**, **anon key** (public) and **service_role key**
   (server-only, treat as a password).

### 2. Cloudflare Worker

```bash
cd cloudflare/worker
npm install
# Public config — edit wrangler.toml [vars] with YOUR Supabase URL + anon key
npx wrangler login
npx wrangler deploy            # → https://access-control-api.<your-subdomain>.workers.dev

# SERVER SECRETS (never commit these):
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# optional:
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON   # see notifications/fcm/README.md
```

Verify: `curl https://access-control-api.<subdomain>.workers.dev/api/health`
→ `{"ok":true,"config":{"supabase":true,...}}`

### 3. Parent dashboard → Cloudflare Pages

```bash
cd parent-dashboard
cp .env.example .env    # fill in your Worker + Supabase PUBLIC values
npm install && npm run build
npx wrangler pages deploy dist --project-name access-control-dashboard
```

In the Pages project settings → Environment variables, add the four
`VITE_*` variables from `.env.example`, then redeploy.

Create your parent account at the Pages URL (`/login` → Create Account).

### 4. Child app

CI builds the APK on every push to `main` (artifact
`AccessControl-child-debug-apk`), or build locally:

```bash
cd child-app
# point the app at YOUR worker:
./gradlew assembleDebug \
  -PAC_API_BASE=https://access-control-api.<subdomain>.workers.dev \
  -PAC_WS_BASE=wss://access-control-api.<subdomain>.workers.dev
# APK: app/build/outputs/apk/debug/app-debug.apk
```

> Gradle defaults live in `child-app/gradle.properties` — set them once there
> instead of passing `-P` flags every build.

Install, open → Splash → developer credit (Telegram button) → **Terms →
"I Agree"** → permission setup → enter pairing code from the dashboard
(`/pairing` → Generate) → **CONNECT**.

### 5. Optional integrations

- **FCM wake-ups**: `notifications/fcm/README.md` (drop `google-services.json`
  into `child-app/app/`, add the service-account secret to the Worker).
- **Telegram notifications**: `notifications/telegram/README.md`
  (dashboard → Telegram → Save + Test).

---

## Environment variables

### PUBLIC CONFIG (safe in frontend/APK)

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_SUPABASE_URL` | dashboard env | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | dashboard env | Supabase anon key (RLS-protected) |
| `VITE_API_BASE` | dashboard env | Worker HTTPS base |
| `VITE_WS_BASE` | dashboard env | Worker WSS base |
| `AC_API_BASE` / `AC_WS_BASE` | child Gradle | Worker HTTPS/WSS base |

### SERVER SECRETS (Worker only — never in a bundle/APK)

| Secret | Purpose |
|--------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS for pairing + child-device writes |
| `TELEGRAM_BOT_TOKEN` | Optional shared bot fallback (per-parent tokens live in DB) |
| `FCM_SERVICE_ACCOUNT_JSON` | Full service-account JSON for FCM HTTP v1 |

### ANDROID CONFIG

| Item | Where |
|------|-------|
| `google-services.json` | `child-app/app/` (optional, enables FCM) |
| Signing keys | GitHub Secrets (`ANDROID_KEYSTORE_*`) or local keystore |

---

## Security model

- **Pairing codes**: 8 chars (unambiguous alphabet), 10-minute TTL, single-use
  (atomic consume in a Durable Object), per-IP brute-force limiting (30/h).
- **Child credentials**: random 32-byte token, issued once, stored hashed
  (`device_sessions.token_hash`), revocable per device.
- **WebSockets**: every upgrade authenticates (parent JWT against Supabase;
  child device token against hashed sessions); parent ownership is verified
  per device before any DO route.
- **Command allowlist**: enforced on the Worker (`src/protocol.js`) *and*
  re-validated on the child (`CommandProcessor.ACTIONS`). No arbitrary
  execution, shell, or dynamic code — ever.
- **RLS**: parents read only their own devices/data; the client-side anon key
  cannot read other rows even if extracted.
- **Secrets**: Telegram tokens and FCM keys never leave the server.
- **Audit logs**: pairing, policy changes, revocation, Telegram saves.

## Child-app permissions (all user-visible)

| Permission | Used for | Where granted |
|------------|----------|----------------|
| Usage Access | app list, screen time, limits | Settings → Usage access |
| Location | parent-enabled monitoring only | Runtime dialog |
| Notifications | parent messages + service status | Runtime (13+) |
| Display over apps | friendly "time is up" screen | Settings → overlay |
| Battery optimization | reliable connection | System dialog |
| Device admin (optional) | screen lock in schedules, uninstall protection | Device admin flow |
| Boot completed | restart monitoring after reboot | automatic (manifest) |

**Icon hiding** uses the launcher alias only — the app stays reachable via
`*#*#9999#*#*` (fallback `*#*#1000#*#*`) and its services keep running.
There is no stealth mode, no disguised UI, and protection can always be
deactivated from the app's Settings.

## Android reality check (documented limitations)

- Android may still kill background services under aggressive OEM
  battery managers (Xiaomi/Huawei etc.). The app requests the battery
  optimization exemption and reconnects with backoff + FCM wake, but no app
  can promise uninterrupted background execution on every OEM.
- Secret dial codes depend on the OEM dialer implementing
  `android.provider.Telephony.SECRET_CODE`; if unsupported, use the
  diagnostics route from Settings.
- FCM requires your own Firebase project (the repo ships without keys).

## Development

```bash
# Worker (local):    cd cloudflare/worker && npx wrangler dev
# Dashboard (local): cd parent-dashboard && npm run dev
# Child (local):     open child-app/ in Android Studio
```

CI: `.github/workflows/build-android.yml` builds the APK **and** the dashboard
on every push. Tag `child-v*` to publish a release APK.
