// Router: /api/* REST endpoints.

import { json, err, HttpError, readJson, str, clientIp } from '../lib/respond.js';
import { validateParentToken, validateDeviceToken, bearerToken, checkBanned } from '../auth/auth.js';
import { handlePairingGenerate, handlePairingClaim } from '../api/pairing.js';
import {
  listDevices, getDevice, revokeDevice, registerFcm, deviceAudit, subscriptionStatus, deviceSettings, childPolicies,
} from '../api/devices.js';
import {
  listPolicies, upsertPolicy, deletePolicy,
} from '../api/policies.js';
import { getUsage, pushUsage } from '../api/usage.js';
import { getLocations, pushLocation } from '../api/location.js';
import { getNotificationSettings, saveNotificationSettings, sendTestPush } from '../api/notifications.js';
import { getTelegramSettings, saveTelegramSettings, testTelegram } from '../api/telegram.js';
import { pushHardware, getHardware } from '../api/hardware.js';
import { pushMedia, getMedia, deleteMedia } from '../api/media.js';
import { pushBrowserHistory, getBrowserHistory } from '../api/browser.js';
import { handleSignup, handleAuthLog } from '../api/auth.js';
import { handleCaptchaNew, handleCaptchaVerify } from '../api/captcha.js';
import {
  handleAdminLogin, handleAdminUsers, handleAdminRemoveUser,
  handleAdminBan, handleAdminUnban, handleAdminSecurity, requireAdmin,
} from '../api/admin.js';
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
    if (p === '/api/admin/login' && method === 'POST') {
      return handleAdminLogin(request, env);
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
    if (p === '/api/admin/security' && method === 'GET') {
      return handleAdminSecurity(env);
    }
    throw new HttpError(404, 'not_found', 'Unknown admin endpoint');
  }

  // ---- pairing ----
  if (p === '/api/pairing/generate' && method === 'POST') {
    const parent = await requireParent(request, env);
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

  throw new HttpError(404, 'not_found', 'Unknown API endpoint');
}
