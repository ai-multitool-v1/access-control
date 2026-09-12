# Telegram Integration (server-side only)

Parent notifications (device connect/disconnect, policy changes) are sent
from the Cloudflare Worker to the parent's own bot.

## Security model

- Bot tokens are stored **only** server-side (Supabase `telegram_settings`,
  written via the Worker with the service-role key).
- They are never shipped in the child APK, never bundled in the dashboard JS,
  and never returned in full by any API (GET returns a masked token).
- Optional `TELEGRAM_BOT_TOKEN` Worker secret acts as a fallback for
  deployments that want a single shared bot.

## Parent flow (dashboard → /telegram)

1. Create a bot with @BotFather → get the token (`123456:ABC-DEF...`).
2. Send any message to your bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy your `chat.id`.
3. Paste both into the dashboard's Telegram page → **Save Telegram Settings**.
4. Press **Test Telegram** — you should receive a ✅ message.

## Message formats

- `🟢 <name> is now connected.`
- `🔴 <name> went offline.`
- `🛡 Policy updated on <name>: daily_limit`
