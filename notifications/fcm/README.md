# FCM Integration (optional wake-up channel)

FCM is **not** the primary transport (that is the authenticated WebSocket via
Cloudflare Durable Objects). FCM is only used to wake the child app when a
command arrives while it is offline, and for the dashboard's "Send test push".

## Enable it

1. Create a Firebase project → Add an Android app with package
   `org.setbd.control`.
2. Download `google-services.json` and drop it into `child-app/app/`.
   The Gradle build auto-enables the google-services plugin when the file
   exists (the build works without it too).
3. In Firebase console → Project settings → Service accounts →
   **Generate new private key** (JSON).
4. Give the whole JSON to the Worker:

   ```bash
   cd cloudflare/worker
   npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON
   # paste the full service-account JSON
   ```

The Worker signs an RS256 JWT with the service-account key (WebCrypto) and
calls the FCM HTTP v1 API — no legacy server keys.

## Message types sent by the backend

| data.type | Purpose | Child behaviour |
|-----------|---------|-----------------|
| `wake`    | Child offline when a command arrives | Start RealtimeService + immediate sync |
| (none/notification) | Dashboard test push | Show alert notification |

---

## Parent browser push (Web Push / VAPID) — since v1.9.0

Parents no longer depend on having the dashboard open to see alerts. The
dashboard site is a PWA: parents enable "Phone notifications" in Settings →
**Enable push notifications**, and the browser registers a Web Push
subscription (stored in the `push_subscriptions` table, migration 0008).

The Worker then fires encrypted pushes (RFC 8291 `aes128gcm`, VAPID RFC 8292)
on: device connect / disconnect (respects the notification toggles), policy
changes, and critical events (SOS, safe-zone exit) — alongside Telegram.

### Owner setup (once, ~1 minute)

```bash
node scripts/gen-vapid-keys.mjs
```

Add the printed keys as GitHub repository secrets — CI deploys them to the
Worker automatically:

| Secret             | Value                                  |
|--------------------|----------------------------------------|
| `VAPID_PUBLIC_KEY` | base64url P-256 public key (65 bytes)  |
| `VAPID_PRIVATE_KEY`| base64url private scalar (32 bytes)    |
| `VAPID_SUBJECT`    | optional `mailto:you@example.com`      |

Until the keys are set, the Settings card shows the server as not configured
and everything else keeps working (Telegram + in-app toasts unaffected).

### Notes

- Works on Android Chrome/Firefox, desktop Chrome/Edge/Firefox; iOS 16.4+
  requires the site installed to the home screen first.
- Subscriptions that the push service reports as gone (404/410) are
  auto-deleted by the Worker.
- Child-side FCM (wake push) is unchanged and independent of this feature.
