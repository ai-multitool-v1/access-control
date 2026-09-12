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
