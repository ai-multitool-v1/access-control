// Helper: push a server-originated event into a device's DeviceHub DO so it
// reaches the connected child socket (and only whitelisted event types pass).

export function deviceHubStub(env, deviceId) {
  return env.DEVICE_HUB.get(env.DEVICE_HUB.idFromName(deviceId));
}

export async function pushServerEvent(env, deviceId, event, payload) {
  try {
    await deviceHubStub(env, deviceId).fetch('https://device-hub.local/server-event', {
      method: 'POST',
      body: JSON.stringify({ type: 'event', event, payload }),
    });
  } catch {
    // child likely offline — periodic sync will pick the change up
  }
}

/**
 * Fan an event out to every connected PARENT socket on a device's hub
 * (dashboard toast + bell). Used when events arrive over REST (notification
 * capture) and for persisted event types. Never throws.
 */
export async function pushParentEvent(env, deviceId, event, payload) {
  try {
    await deviceHubStub(env, deviceId).fetch('https://device-hub.local/parent-event', {
      method: 'POST',
      body: JSON.stringify({ type: 'event', event, payload }),
    });
  } catch {
    // no parents connected — the feed still shows it on next load
  }
}
