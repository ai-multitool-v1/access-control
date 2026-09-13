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
