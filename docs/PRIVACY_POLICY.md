# Privacy Policy (placeholder — replace before public release)

Access Control is a consent-based parental-control service.

**Data collected (only after explicit onboarding consent + pairing):**
- Device model, Android version, app version, battery, charging, network state
- Installed app list and daily per-app usage durations (requires Usage Access)
- Location, only while the parent has enabled location monitoring AND the
  location permission is granted; status is visible on the child dashboard
- Parental policies configured by the parent account

**Data never collected:**
- Message or email contents, keylogging data, credentials
- Microphone or camera recordings
- Screen recordings or arbitrary screenshots
- Any data without a corresponding, visible feature

**Storage & security:** data is stored in Supabase (PostgreSQL with Row Level
Security) and transported over HTTPS/WSS via Cloudflare Workers. Device
credentials are stored encrypted on the child device.

**Child/parent rights:** a parent can revoke a device (which deletes its
session credentials and stops all collection); the child can see every
active monitoring state on its dashboard; uninstall protection is optional
and deactivatable.

Contact: replace with your support contact (e.g. the Telegram handle shown
in the app).
