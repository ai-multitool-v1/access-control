# Sessions

Per-device session state (pending command timeouts, socket registries,
child connection status) lives inside the `DeviceHub` Durable Object —
one DO instance per device id (`env.DEVICE_HUB.idFromName(deviceId)`).

Durable Objects provide single-threaded, strongly-consistent state, so
no extra session store is required. Long-term session credentials
(device token hashes) are stored in Supabase `device_sessions`.

See `../websocket/device-hub.js`.
