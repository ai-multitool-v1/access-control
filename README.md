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
│       ├── onboarding/   Splash → credit → Terms → Permissions (14-step wizard) → Pairing
│       ├── permissions/  Checks + REAL intents for every permission row
│       ├── devicemanagement/ DeviceAdminReceiver + DevicePolicy wrapper
│       ├── monitoring/   device info, usage stats, installed apps, location, comms
│       ├── controls/     PolicyEngine + enforcement + block screen + accessibility
│       ├── websocket/    WsClient, CommandProcessor (strict allowlist), RealtimeService
│       ├── webrtc/       Screen mirror / one-way audio / remote camera (libwebrtc)
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

## Child-app permissions (full matrix — AirDroid-Kids-style, all user-visible)

Every row below appears in the in-app **Permissions wizard** with a working
GRANT button that opens the real system screen or fires the real runtime
dialog, and re-validates itself when you come back:

| # | Permission | Used for | How it's granted |
|---|------------|----------|------------------|
| 1 | **Accessibility** | instant app block, screen-time limits, instant block | Settings → Accessibility → Access Control |
| 2 | **Notification access** | monitor notifications (Facebook, Instagram, WhatsApp…) | Settings → Notification access |
| 3 | **Location (precise)** | real-time location, route history, geofence alerts | Runtime dialog |
| 4 | **Location — all the time** | background location for history/geofence | Runtime dialog → "Allow all the time" |
| 5 | **Usage access** | screen-time reports, app usage stats | Settings → Usage access |
| 6 | **Display over other apps** | limit/block screens + tap-to-allow prompts | Settings → overlay |
| 7 | **Battery unrestricted** | keep-alive (background running) | System dialog (+ OEM auto-start) |
| 8 | **Microphone** | one-way audio / voice chat (WebRTC) | Runtime dialog |
| 9 | **Camera** | remote camera & screen mirroring (WebRTC) | Runtime dialog |
| 10 | **Notifications** | parent messages + status + prompts | Runtime dialog (Android 13+) |
| 11 | **Contacts / Phone / SMS** *(optional)* | call & SMS monitoring, safety contacts | Runtime dialogs (skippable) |
| 12 | **Storage / photos** | file & media features | Runtime dialog |
| 13 | **Install unknown apps** | update wizard | Settings → install unknown apps |
| 14 | **Device admin** *(optional)* | schedule screen lock, uninstall protection | Device-admin activation flow |

Parent dashboard (browser) side: camera/mic are only used by the WebRTC
viewer after YOU start a session; the child device always shows Android's
mic/camera indicators and an ongoing "Sharing with parent" notification.

## Remote access over WebRTC

Real-time screen mirroring, one-way audio (listen to surroundings) and
remote camera ride the SAME authenticated WebSocket through the Durable
Object — no extra servers, no polling:

```
Parent dashboard            Durable Object              Child device
────────────────            ──────────────              ────────────
start_screen_mirror ──────► relay (allowlist) ────────► consent notification
                                                    └─► system MediaProjection dialog
                        ◄──── SDP offer (rtc) ────────  capture starts
SDP answer, ICE ───────► relay ──────────────────────►  peer connection
        ◄═════════════ live video/audio track ══════════
stop (button/child) ───► relay ──────────────────────►  capture stops + notification clears
```

Consent model (nothing is ever covert):

- **Screen mirroring** always requires the system MediaProjection dialog —
  the child taps a notification to open it, every session.
- **Audio/camera** start directly only when the app is foreground; otherwise
  a tap-to-allow notification is posted. Ongoing sessions show a
  "Sharing with parent" notification plus Android's own indicators.
- Optional **contacts / call log / SMS** reading happens only per command,
  only if that permission was explicitly granted on the child.
- No TURN server is bundled; devices behind symmetric NAT may need one —
  add `turn:` credentials to `RTC_CONFIG` (dashboard) and
  `PeerConnection.RTCConfiguration` (`WebRtcCore.kt`) if required.

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

---

## Complete production deployment (step-by-step with every credential)

Follow this top-to-bottom. Total time ≈ 20 minutes, everything is free-tier.

### STEP 0 — Collect your credentials

| # | Credential | Where you get it | Where it goes |
|---|-----------|------------------|---------------|
| 1 | Supabase **Project URL** | supabase.com → your project → Settings → API | wrangler.toml `[vars]`, dashboard `.env`, child Gradle not needed |
| 2 | Supabase **anon key** | Settings → API → `anon` `public` | wrangler.toml `[vars]`, dashboard `.env` |
| 3 | Supabase **service_role key** | Settings → API → `service_role` | Worker secret only (`SUPABASE_SERVICE_ROLE_KEY`) |
| 4 | Supabase **JWT Secret** | Settings → API → JWT Settings → JWT Secret | Worker secret only (`SUPABASE_JWT_SECRET`) if set in wrangler.toml vars |
| 5 | Cloudflare account | dash.cloudflare.com (free) | `wrangler login` |
| 6 | Telegram **Bot Token** | @BotFather → `/newbot` → copy token | Worker secret `TELEGRAM_BOT_TOKEN` (and/or per-parent in dashboard → Telegram) |
| 7 | Telegram **Chat ID** | @userinfobot (send any message, it replies with your ID) | dashboard → Telegram page (stored server-side) |
| 8 | Firebase service account JSON | console.firebase.google.com → Project settings → Service accounts → Generate new private key | Worker secret `FCM_SERVICE_ACCOUNT_JSON` (optional, for wake pushes) |
| 9 | `google-services.json` | Firebase → Android app `org.setbd.control` → download | `child-app/app/google-services.json` (optional) |
| 10 | GitHub secrets (CI signing, optional) | create a keystore, base64 it | repo → Settings → Secrets → Actions |

### STEP 1 — Supabase (database + auth)

1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste the whole of `supabase/migrations/0001_init.sql` → **Run**.
   You should see 12 tables + policies created with no errors.
3. Copy Project URL, anon key, service_role key, JWT secret (table above).

### STEP 2 — Cloudflare Worker (API + realtime + DO)

```bash
cd cloudflare/worker
npm install
npx wrangler login                       # opens the browser; approve
# edit wrangler.toml [vars]: SUPABASE_URL + SUPABASE_ANON_KEY
npx wrangler deploy                      # → https://access-control-api.<subdomain>.workers.dev

# SERVER SECRETS (interactive prompts — paste, Enter):
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN            # optional
npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON      # optional (paste the whole JSON)
```

Verify: `curl https://access-control-api.<subdomain>.workers.dev/api/health`
→ `{"ok":true,...}`.

### STEP 3 — Parent dashboard (Cloudflare Pages)

```bash
cd parent-dashboard
cp .env.example .env
# fill .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
#            VITE_API_BASE=https://access-control-api.<subdomain>.workers.dev
#            VITE_WS_BASE=wss://access-control-api.<subdomain>.workers.dev
npm install && npm run build
npx wrangler pages deploy dist --project-name access-control-dashboard
```

Open the Pages URL → `/login` → **Create Account** (first user = you).

### STEP 4 — Child APK

Easiest: GitHub Actions already builds it — repo → **Actions** → latest run →
artifact `AccessControl-child-debug-apk`. For your own endpoints, rebuild
with your Worker URL:

```bash
cd child-app
# one-time: put your URLs in gradle.properties (AC_API_BASE / AC_WS_BASE)
./gradlew assembleDebug \
  -PAC_API_BASE=https://access-control-api.<subdomain>.workers.dev \
  -PAC_WS_BASE=wss://access-control-api.<subdomain>.workers.dev
# → app/build/outputs/apk/debug/app-debug.apk
```

Install on the child device → open → **Terms → I Agree** → **Permissions
wizard (14 rows)** → dashboard `/pairing` → **Generate code** → type it on
the child → **CONNECT**.

### STEP 5 — Smoke test

1. Dashboard → Monitoring → select device → **Ping device status**.
2. **Start screen mirroring** → the child gets a prompt → tap → allow the
   system dialog → live video appears on the dashboard.
3. **Start one-way audio** → confirm the child notification appears.
4. Policies → set a daily limit → watch the child block apps when reached.

---

## Deploying from Termux (Android phone — no PC needed)

You can run the ENTIRE deployment from Termux on your Android device.

### 1. One-time Termux setup

```bash
pkg update -y
pkg install -y git nodejs-lts openjdk-17
npm install -g wrangler
```

### 2. Clone + authenticate

```bash
git clone https://github.com/ai-multitool-v1/access-control.git
cd access-control

# GitHub CLI auth (for pushes) — use a fine-grained PAT, then revoke it after:
git remote set-url origin https://<YOUR_GH_TOKEN>@github.com/ai-multitool-v1/access-control.git

# Cloudflare auth:
npx wrangler login     # opens browser; if it fails on-device use an API token instead:
export CLOUDFLARE_API_TOKEN=cf_xxxxxxxxxxxxxxxxxxxxx   # dash → My Profile → API Tokens → Edit Cloudflare Workers
```

### 3. Deploy everything from Termux

```bash
# ---- Supabase: open supabase.com in your browser, run the migration SQL ----

# ---- Worker ----
cd cloudflare/worker
npm install
nano wrangler.toml            # set SUPABASE_URL + SUPABASE_ANON_KEY in [vars]
npx wrangler deploy
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN          # optional

# ---- Dashboard ----
cd ../../parent-dashboard
cp .env.example .env && nano .env                # your 4 VITE_* values
npm install && npm run build
npx wrangler pages deploy dist --project-name access-control-dashboard

# ---- Child APK (CI does it, but you can also build on-device) ----
cd ../child-app
./gradlew assembleDebug \
  -PAC_API_BASE=https://access-control-api.<subdomain>.workers.dev \
  -PAC_WS_BASE=wss://access-control-api.<subdomain>.workers.dev
# Termux tip: if Gradle memory runs low, add to gradle.properties:
#   org.gradle.jvmargs=-Xmx1536m
```

### 4. Add GitHub Actions secrets from Termux (optional signing)

```bash
# create keystore on-device, then base64 + gh secret set via API:
keytool -genkeypair -v -keystore ac-release.jks -alias ac \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 ac-release.jks > ac-release.b64
curl -X PUT \
  -H "Authorization: token <YOUR_GH_TOKEN>" \
  https://api.github.com/repos/ai-multitool-v1/access-control/actions/secrets/ANDROID_KEYSTORE_BASE64 \
  -d "{\"encrypted_value\":\"$(cat ac-release.b64)\"}"
# repeat for ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
```

### 5. Credential hygiene (IMPORTANT)

- Never commit tokens/keys — everything above goes into **wrangler secrets**,
  **`.env`** (git-ignored) or **GitHub Secrets**.
- The GitHub PAT used for the initial clone/push should be **revoked** after
  the session: GitHub → Settings → Developer settings → Personal access tokens.
- Rotating a secret: `npx wrangler secret put <NAME>` again; Durable Objects
  pick up the new value on the next deploy.
