// Router: /api/* REST endpoints.

import { json, err, HttpError, readJson, str, clientIp } from '../lib/respond.js';
import { validateParentToken, validateDeviceToken, bearerToken } from '../auth/auth.js';
import { handlePairingGenerate, handlePairingClaim } from '../api/pairing.js';
import {
  listDevices, getDevice, revokeDevice, registerFcm, deviceAudit, subscriptionStatus, deviceSettings,
} from '../api/devices.js';
import {
  listPolicies, upsertPolicy, deletePolicy,
} from '../api/policies.js';
import { getUsage, pushUsage } from '../api/usage.js';
import { getLocations, pushLocation } from '../api/location.js';
import { getNotificationSettings, saveNotificationSettings, sendTestPush } from '../api/notifications.js';
import { getTelegramSettings, saveTelegramSettings, testTelegram } from '../api/telegram.js';

async function requireParent(request, env) {
  const user = await validateParentToken(bearerToken(request), env);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required');
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
