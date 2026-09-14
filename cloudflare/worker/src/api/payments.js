// Parent-facing payment + announcement endpoints.
//
// POST /api/payments   (multipart/form-data)  — submit a manual-review payment:
//        fields: plan (monthly|yearly|lifetime), method (bkash|nagad|rocket|upay),
//                senderNumber?, transactionId?, screenshot (png/jpg/jpeg, <= 5 MB)
//        → stores screenshot in the private 'payments' bucket (service role),
//          inserts payment_requests, notifies the owner on Telegram.
// GET  /api/payments   — the parent's own payment requests + statuses.
// GET  /api/announcements — active banner / popup / notification broadcasts.

import { json, HttpError, str } from '../lib/respond.js';
import { clientIp, rateLimit } from '../lib/ratelimit.js';
import { sbRest, sbInsert } from '../lib/supabase.js';
import { PLANS } from '../lib/subscription.js';
import { sendTelegramDirect } from '../notify/telegram.js';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
]);

function publicStorageUrl(env, bucket, path) {
  return `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/** Upload a file object to a Supabase Storage bucket with the service role. */
async function storageUpload(env, bucket, path, bytes, contentType) {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`storage_${res.status}:${detail.slice(0, 120)}`);
  }
}

/** Best-effort Telegram ping to the OWNER about a new payment request. */
async function notifyOwner(env, { email, plan, amount, method, senderNumber, txId, userId }) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.OWNER_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // owner hasn't wired Telegram yet — row still stored
  const lines = [
    '<b>💸 New payment request</b>',
    '',
    `• Plan: <b>${plan}</b> — ${amount} BDT`,
    `• Method: <b>${method}</b>`,
    `• Parent e-mail: <b>${email}</b>`,
    `• User ID: <code>${userId}</code>`,
    senderNumber ? `• Sender number: ${senderNumber}` : null,
    txId ? `• Transaction ID: ${txId}` : null,
    '',
    `🕒 ${new Date().toISOString()}`,
    'Review & approve in the /setbd console → Payments.',
  ].filter(Boolean);
  await sendTelegramDirect(token, chatId, lines.join('\n')).catch(() => {});
}

export async function handlePaymentSubmit(request, env, parent) {
  const ip = clientIp(request);
  const rl = rateLimit(`paysubmit:${ip}`, 5, 60 * 60 * 1000); // 5 requests / hour / IP
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Too many payment submissions — try again later.');

  let form;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, 'bad_request', 'Send the request as multipart/form-data');
  }

  const plan = str(form.get('plan'), 20);
  const method = str(form.get('method'), 20);
  const senderNumber = str(form.get('senderNumber'), 40);
  const transactionId = str(form.get('transactionId'), 60);
  if (!PLANS[plan]) throw new HttpError(400, 'bad_request', 'Choose a Pro plan (monthly / yearly / lifetime)');
  if (!['bkash', 'nagad', 'rocket', 'upay'].includes(method)) {
    throw new HttpError(400, 'bad_request', 'Payment method must be bkash, nagad, rocket or upay');
  }

  const file = form.get('screenshot');
  if (!file || typeof file === 'string') {
    throw new HttpError(400, 'bad_request', 'Payment verification screenshot is required (PNG/JPG)');
  }
  const ext = ALLOWED_IMAGE_TYPES.get(file.type);
  if (!ext) throw new HttpError(400, 'bad_request', 'Screenshot must be a PNG or JPG image');
  if (file.size > MAX_SCREENSHOT_BYTES) {
    throw new HttpError(413, 'too_large', 'Screenshot too large — max 5 MB');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // magic-byte sniff: PNG 89504E47 / JPEG FFD8FF — never trust Content-Type alone
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpg) throw new HttpError(400, 'bad_request', 'File content is not a valid PNG/JPG image');

  const path = `${parent.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await storageUpload(env, 'payments', path, bytes, file.type);

  await sbInsert(env, 'payment_requests', {
    parent_id: parent.id,
    email: parent.email || 'unknown',
    plan,
    amount_bdt: PLANS[plan].priceBdt,
    method,
    sender_number: senderNumber || null,
    transaction_id: transactionId || null,
    screenshot_path: path,
  }, false);

  notifyOwner(env, {
    email: parent.email,
    plan,
    amount: PLANS[plan].priceBdt,
    method,
    senderNumber,
    txId: transactionId,
    userId: parent.id,
  }).catch(() => {});

  return json({
    ok: true,
    message: 'Payment request submitted — under review. You will be notified once approved.',
  });
}

export async function handleMyPayments(env, parent) {
  const rows = await sbRest(
    env,
    `payment_requests?parent_id=eq.${parent.id}&select=id,plan,amount_bdt,method,status,review_note,created_at,reviewed_at&order=created_at.desc&limit=50`
  ).catch(() => []);
  return json({ ok: true, payments: rows });
}

export async function handleAnnouncements(env) {
  const rows = await sbRest(
    env,
    'announcements?active=eq.true&select=id,type,title,body,image_url,link_url,created_at&order=created_at.desc&limit=20'
  ).catch(() => []);
  const now = Date.now();
  const active = rows.filter((r) => !r.expires_at || Date.parse(r.expires_at) > now);
  return json({ ok: true, announcements: active });
}

export { publicStorageUrl };
