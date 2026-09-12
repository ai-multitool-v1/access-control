// Telegram Bot API — server-side only. Bot tokens are read from the
// per-parent telegram_settings table or the TELEGRAM_BOT_TOKEN secret.

export async function sendTelegramDirect(botToken, chatId, text) {
  if (!botToken || !chatId) return { ok: false, description: 'not_configured' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return { ok: false, description: (data && data.description) || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, description: 'network_error' };
  }
}

export async function sendTelegramTo(env, parentId, text) {
  let settings = null;
  try {
    const rows = await fetch(
      `${env.SUPABASE_URL}/rest/v1/telegram_settings?parent_id=eq.${parentId}&select=bot_token,chat_id`,
      { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const arr = await rows.json().catch(() => []);
    settings = arr[0] || null;
  } catch { /* fall through to env token */ }
  const token = (settings && settings.bot_token) || env.TELEGRAM_BOT_TOKEN;
  const chatId = settings && settings.chat_id;
  if (!token || !chatId) return { ok: false, description: 'not_configured' };
  return sendTelegramDirect(token, chatId, text);
}
