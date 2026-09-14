// Router: /api/* REST endpoints.

import { json, err, HttpError, readJson, str, clientIp } from '../lib/respond.js';
import { validateParentToken, validateDeviceToken, bearerToken, checkBanned } from '../auth/auth.js';
import { deviceLimitFor } from '../lib/subscription.js';
import { sbRest } from '../lib/supabase.js';
import { handlePairingGenerate, handlePairingClaim } from '../api/pairing.js';
import {
  listDevices, getDevice, revokeDevice, registerFcm, deviceAudit, subscriptionStatus, deviceSettings, childPolicies,
} from '../api/devices.js';
import {
  listPolicies, upsertPolicy, deletePolicy,
} from '../api/policies.js';
import { getUsage, pushUsage } from '../api/usage.js';
import { getLocations, pushLocation } from '../api/location.js';
import { getNotificationSettings, saveNotificationSettings, sendTestPush,
  getWebPushKey, saveWebPushSubscription, deleteWebPushSubscription, sendTestWebPush } from '../api/notifications.js';
import { getTelegramSettings, saveTelegramSettings, testTelegram } from '../api/telegram.js';
import { pushHardware, getHardware } from '../api/hardware.js';
import { pushMedia, getMedia, deleteMedia } from '../api/media.js';
import { pushBrowserHistory, getBrowserHistory } from '../api/browser.js';
import { handleSignup, handleAuthLog } from '../api/auth.js';
import { handleCaptchaNew, handleCaptchaVerify } from '../api/captcha.js';
import {
  handleAdminLogin, handleAdminMfa, handleAdminConfig, handleAdminUsers,
  handleAdminRemoveUser, handleAdminBan, handleAdminUnban, handleAdminSecurity, requireAdmin,
  handleAdminUserTier, handleAdminAnnouncements, handleAdminAnnouncementToggle, handleAdminAnnouncementDelete,
  handleAdminPayments, handleAdminPaymentImage, handleAdminPaymentDecision, handleAdminDevices,
  handleAdminLogs, handleAdminDevicesDelete, handleAdminPaymentsDelete,
} from '../api/admin.js';
import { handlePaymentSubmit, handleMyPayments, handleAnnouncements } from '../api/payments.js';
import { requirePremium } from '../lib/subscription.js';
import { listRestrictions, upsertRestriction, childRestrictions } from '../api/restrictions.js';
import { listZones, createZone, updateZone, deleteZone, childZones } from '../api/zones.js';
import { pushEvent, pushEventsBatch, listEvents, markEventsRead } from '../api/events.js';
import { pushApps, getApps } from '../api/apps.js';

async function requireParent(request, env) {
  const user = await validateParentToken(bearerToken(request), env);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required');
  // Banned parents are locked out of the whole API (with the reason text).
  const ban = await checkBanned(env, user.id);
  if (ban) {
    throw new HttpError(403, 'account_banned', ban.reason
      ? `Your account has been suspended. Reason: ${ban.reason}`
      : 'Your account has been suspended.');
  }
  return user;
}

async function requireDevice(request, env) {
  const dev = await validateDeviceToken(bearerToken(request), env);
  if (!dev) throw new HttpError(401, 'unauthorized', 'Invalid device credential');
  return dev;
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  // ---- auth (signup needs NO email verification) ----
  if (p === '/api/auth/signup' && method === 'POST') {
    return handleSignup(request, env);
  }
  if (p === '/api/auth/log' && method === 'POST') {
    return handleAuthLog(request, env);
  }

  // ---- captcha (math challenge, signed one-time token) ----
  if (p === '/api/captcha/new' && method === 'GET') {
    return handleCaptchaNew(request, env);
  }
  if (p === '/api/captcha/verify' && method === 'POST') {
    return handleCaptchaVerify(request, env);
  }

  // ---- admin (/setbd dashboard) ----
  if (p.startsWith('/api/admin/')) {
    // public, pre-auth endpoints: config booleans + login step 1/2
    if (p === '/api/admin/config' && method === 'GET') {
      return handleAdminConfig(env);
    }
    if (p === '/api/admin/login' && method === 'POST') {
      return handleAdminLogin(request, env);
    }
    if (p === '/api/admin/mfa' && method === 'POST') {
      return handleAdminMfa(request, env);
    }
    await requireAdmin(request, env);
    if (p === '/api/admin/users' && method === 'GET') {
      return handleAdminUsers(env);
    }
    if (p === '/api/admin/users/remove' && method === 'POST') {
      return handleAdminRemoveUser(request, env);
    }
    if (p === '/api/admin/users/ban' && method === 'POST') {
      return handleAdminBan(request, env);
    }
    if (p === '/api/admin/users/unban' && method === 'POST') {
      return handleAdminUnban(request, env);
    }
    if (p === '/api/admin/users/tier' && method === 'POST') {
      return handleAdminUserTier(request, env);
    }
    if (p === '/api/admin/security' && method === 'GET') {
      return handleAdminSecurity(env);
    }
    // ---- broadcast (banner / popup / notification) ----
    if (p === '/api/admin/announcements' && (method === 'GET' || method === 'POST')) {
      return handleAdminAnnouncements(request, env);
    }
    if (p === '/api/admin/announcements/toggle' && method === 'POST') {
      return handleAdminAnnouncementToggle(request, env);
    }
    if (p === '/api/admin/announcements/delete' && method === 'POST') {
      return handleAdminAnnouncementDelete(request, env);
    }
    // ---- payments (manual review) ----
    if (p === '/api/admin/payments' && method === 'GET') {
      return handleAdminPayments(env);
    }
    if (p === '/api/admin/payments/decision' && method === 'POST') {
      return handleAdminPaymentDecision(request, env);
    }
    if (p === '/api/admin/payments/image' && method === 'GET') {
      return handleAdminPaymentImage(request, env);
    }
    // ---- all connected child devices + hardware ----
    if (p === '/api/admin/devices' && method === 'GET') {
      return handleAdminDevices(request, env);
    }
    // ---- mark & remove devices (online OR offline) ----
    if (p === '/api/admin/devices/delete' && method === 'POST') {
      return handleAdminDevicesDelete(request, env);
    }
    // ---- mark & remove payment requests (typically rejected ones) ----
    if (p === '/api/admin/payments/delete' && method === 'POST') {
      return handleAdminPaymentsDelete(request, env);
    }
    // ---- access logs: parents (auth_login_logs) + admin (admin_logs) ----
    if (p === '/api/admin/logs' && method === 'GET') {
      return handleAdminLogs(request, env);
    }
    throw new HttpError(404, 'not_found', 'Unknown admin endpoint');
  }

  // ---- pairing ----
  if (p === '/api/pairing/generate' && method === 'POST') {
    const parent = await requireParent(request, env);
    // Free plan binds a SINGLE child device — stop early with a clear message.
    const limit = await deviceLimitFor(env, parent.id);
    const bound = await sbRest(env, `devices?parent_id=eq.${parent.id}&select=id&status=neq.revoked`).catch(() => []);
    if (bound.length >= limit) {
      throw new HttpError(402, 'device_limit_reached',
        limit === 1
          ? 'Free plan binds only ONE child device. Upgrade to Pro to add more devices.'
          : 'Device limit reached.');
    }
    return handlePairingGenerate(request, env, parent);
  }
  if (p === '/api/pairing/claim' && method === 'POST') {
    return handlePairingClaim(request, env);
  }

  // ---- devices (parent) ----
  if (p === '/api/devices' && method === 'GET') {
    const parent = await requireParent(request, env);
    return listDevices(env, parent);
  }
  let m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})$/);
  if (m) {
    const parent = await requireParent(request, env);
    if (method === 'GET') return getDevice(env, parent, m[1]);
    if (method === 'DELETE') return revokeDevice(request, env, parent, m[1]);
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/settings$/);
  if (m && (method === 'GET' || method === 'POST')) {
    const parent = await requireParent(request, env);
    return deviceSettings(request, env, parent, m[1], method);
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/policies$/);
  if (m && (method === 'GET' || method === 'POST')) {
    const parent = await requireParent(request, env);
    return method === 'GET' ? listPolicies(env, parent, m[1]) : upsertPolicy(request, env, parent, m[1]);
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/policies\/([0-9a-fA-F-]{36})$/);
  if (m && method === 'DELETE') {
    const parent = await requireParent(request, env);
    return deletePolicy(request, env, parent, m[1], m[2]);
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/usage$/);
  if (m && method === 'GET') {
    const parent = await requireParent(request, env);
    return getUsage(env, parent, m[1], url.searchParams.get('date'));
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/locations$/);
  if (m && method === 'GET') {
    const parent = await requireParent(request, env);
    await requirePremium(env, parent.id, 'Live location');
    return getLocations(env, parent, m[1], Number(url.searchParams.get('limit') || 50));
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/audit$/);
  if (m && method === 'GET') {
    const parent = await requireParent(request, env);
    return deviceAudit(env, parent, m[1]);
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/apps$/);
  if (m && method === 'GET') {
    const parent = await requireParent(request, env);
    return getApps(env, parent, m[1]);
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/restrictions$/);
  if (m && (method === 'GET' || method === 'POST')) {
    const parent = await requireParent(request, env);
    return method === 'GET'
      ? listRestrictions(env, parent, m[1])
      : upsertRestriction(request, env, parent, m[1]);
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/zones$/);
  if (m && (method === 'GET' || method === 'POST')) {
    const parent = await requireParent(request, env);
    return method === 'GET'
      ? listZones(env, parent, m[1])
      : createZone(request, env, parent, m[1]);
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/events$/);
  if (m && method === 'GET') {
    const parent = await requireParent(request, env);
    return listEvents(env, parent, m[1], url.searchParams.get('limit'), url.searchParams.get('type'), url.searchParams.get('sort'), url.searchParams.get('unread'));
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/events\/read$/);
  if (m && method === 'POST') {
    const parent = await requireParent(request, env);
    return markEventsRead(request, env, parent, m[1]);
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/hardware$/);
  if (m && method === 'GET') {
    const parent = await requireParent(request, env);
    return getHardware(env, parent, m[1]);
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/media$/);
  if (m && (method === 'GET' || method === 'DELETE')) {
    const parent = await requireParent(request, env);
    await requirePremium(env, parent.id, 'Media (audio / video)');
    return method === 'GET'
      ? getMedia(env, parent, m[1])
      : deleteMedia(request, env, parent, m[1]);
  }
  m = p.match(/^\/api\/devices\/([0-9a-fA-F-]{36})\/browser$/);
  if (m && method === 'GET') {
    const parent = await requireParent(request, env);
    return getBrowserHistory(env, parent, m[1], url);
  }
  m = p.match(/^\/api\/zones\/([0-9a-fA-F-]{36})$/);
  if (m && (method === 'PATCH' || method === 'DELETE')) {
    const parent = await requireParent(request, env);
    return method === 'PATCH'
      ? updateZone(request, env, parent, m[1])
      : deleteZone(env, parent, m[1]);
  }

  // ---- child endpoints (device token auth) ----
  if (p === '/api/usage/batch' && method === 'POST') {
    const device = await requireDevice(request, env);
    return pushUsage(request, env, device);
  }
  if (p === '/api/location' && method === 'POST') {
    const device = await requireDevice(request, env);
    return pushLocation(request, env, device);
  }
  if (p === '/api/devices/fcm' && method === 'POST') {
    const device = await requireDevice(request, env);
    return registerFcm(request, env, device);
  }
  if (p === '/api/apps/sync' && method === 'POST') {
    const device = await requireDevice(request, env);
    return pushApps(request, env, device);
  }
  if (p === '/api/events' && method === 'POST') {
    const device = await requireDevice(request, env);
    return pushEvent(request, env, device);
  }
  if (p === '/api/events/batch' && method === 'POST') {
    const device = await requireDevice(request, env);
    return pushEventsBatch(request, env, device);
  }
  if (p === '/api/media/sync' && method === 'POST') {
    const device = await requireDevice(request, env);
    return pushMedia(request, env, device);
  }
  if (p === '/api/browser/sync' && method === 'POST') {
    const device = await requireDevice(request, env);
    return pushBrowserHistory(request, env, device);
  }
  if (p === '/api/hardware' && method === 'POST') {
    const device = await requireDevice(request, env);
    return pushHardware(request, env, device);
  }
  if (p === '/api/child/restrictions' && method === 'GET') {
    const device = await requireDevice(request, env);
    return childRestrictions(env, device);
  }
  if (p === '/api/child/policies' && method === 'GET') {
    const device = await requireDevice(request, env);
    return childPolicies(env, device);
  }
  if (p === '/api/child/zones' && method === 'GET') {
    const device = await requireDevice(request, env);
    return childZones(env, device);
  }
  if (p === '/api/child/bootstrap' && method === 'GET') {
    const device = await requireDevice(request, env);
    const settings = await deviceSettings(request, env, { id: device.parent_id }, device.id, 'GET');
    const policies = await listPolicies(env, { id: device.parent_id }, device.id);
    return json({ device, ...settings, policies });
  }

  // ---- notifications & telegram & subscription (parent) ----
  if (p === '/api/notifications/settings' && (method === 'GET' || method === 'POST')) {
    const parent = await requireParent(request, env);
    return method === 'GET'
      ? getNotificationSettings(env, parent)
      : saveNotificationSettings(request, env, parent);
  }
  if (p === '/api/notifications/test' && method === 'POST') {
    const parent = await requireParent(request, env);
    return sendTestPush(request, env, parent);
  }
  // ---- parent browser push (Web Push / VAPID) ----
  if (p === '/api/notifications/push-key' && method === 'GET') {
    return getWebPushKey(env);
  }
  if (p === '/api/notifications/push-subscription' && method === 'POST') {
    const parent = await requireParent(request, env);
    return saveWebPushSubscription(request, env, parent);
  }
  if (p === '/api/notifications/push-subscription' && method === 'DELETE') {
    const parent = await requireParent(request, env);
    return deleteWebPushSubscription(request, env, parent);
  }
  if (p === '/api/notifications/push-test' && method === 'POST') {
    const parent = await requireParent(request, env);
    return sendTestWebPush(env, parent);
  }
  if (p === '/api/telegram/settings' && (method === 'GET' || method === 'POST')) {
    const parent = await requireParent(request, env);
    return method === 'GET'
      ? getTelegramSettings(env, parent)
      : saveTelegramSettings(request, env, parent);
  }
  if (p === '/api/telegram/test' && method === 'POST') {
    const parent = await requireParent(request, env);
    return testTelegram(env, parent);
  }
  if (p === '/api/subscription' && method === 'GET') {
    const parent = await requireParent(request, env);
    return subscriptionStatus(env, parent);
  }

  // ---- payments (manual review via Telegram) ----
  if (p === '/api/payments' && method === 'POST') {
    const parent = await requireParent(request, env);
    return handlePaymentSubmit(request, env, parent);
  }
  if (p === '/api/payments' && method === 'GET') {
    const parent = await requireParent(request, env);
    return handleMyPayments(env, parent);
  }

  // ---- announcements (admin broadcasts) ----
  if (p === '/api/announcements' && method === 'GET') {
    const parent = await requireParent(request, env);
    return handleAnnouncements(env);
  }

  throw new HttpError(404, 'not_found', 'Unknown API endpoint');
}
