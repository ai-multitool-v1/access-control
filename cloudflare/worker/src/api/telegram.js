// Telegram settings: stored server-side (Supabase), never exposed to clients.
// GET returns a masked token. test sends a real message.

import { json, HttpError, readJson, str } from '../lib/respond.js';
import { sbRest, sbSingle, sbInsert } from '../lib/supabase.js';
import { sendTelegramDirect } from '../notify/telegram.js';

export async function getTelegramSettings(env, parent) {
  const s = await sbSingle(env, `telegram_settings?parent_id=eq.${parent.id}&select=bot_token,chat_id`);
  if (!s || !s.bot_token) return json({ ok: true, configured: false, botToken: '', chatId: '' });
  const masked = s.bot_token.length > 10 ? `${s.bot_token.slice(0, 6)}•••••${s.bot_token.slice(-4)}` : '•••••';
  return json({ ok: true, configured: true, botToken: masked, chatId: s.chat_id || '' });
}

export async function saveTelegramSettings(request, env, parent) {
  const body = await readJson(request);
  const botToken = str(body.botToken, 200);
  const chatId = str(body.chatId, 100);
  if (!botToken || !chatId) throw new HttpError(400, 'bad_request', 'botToken and chatId are required');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    throw new HttpError(400, 'bad_request', 'botToken does not look like a Telegram bot token (format: 123456:ABC-DEF...)');
  }

  await sbRest(env, 'telegram_settings', {
    method: 'POST',
    body: { parent_id: parent.id, bot_token: botToken, chat_id: chatId, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  await sbInsert(env, 'audit_logs', { parent_id: parent.id, action: 'telegram_settings_saved' }, false);
  return json({ ok: true });
}

export async function testTelegram(env, parent) {
  const s = await sbSingle(env, `telegram_settings?parent_id=eq.${parent.id}&select=bot_token,chat_id`);
  const token = (s && s.bot_token) || env.TELEGRAM_BOT_TOKEN;
  const chatId = s && s.chat_id;
  if (!token || !chatId) {
    return json({ ok: false, code: 'not_configured', message: 'Save a bot token and chat ID first (or set TELEGRAM_BOT_TOKEN secret as fallback).' });
  }
  const res = await sendTelegramDirect(token, chatId, '✅ <b>Access Control</b>\nTelegram notifications are working.');
  if (!res.ok) {
    return json({ ok: false, code: 'telegram_error', message: `Telegram said: ${res.description || 'failed'}` });
  }
  return json({ ok: true, message: 'Test message sent — check your Telegram.' });
}
