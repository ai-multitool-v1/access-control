// Explicit command allowlist. The child app re-validates this list locally;
// anything not listed here is rejected on BOTH sides. No arbitrary commands,
// no shell, no code execution — ever.

export const ALLOWED_ACTIONS = new Set([
  'ping',
  'get_device_status',
  'get_permission_status',
  'get_installed_apps',
  'get_app_usage',
  'get_location',
  'get_policies',
  'sync_policies',
  'lock_screen',
  'send_notification',
  'trigger_sync',
]);

// Child -> parent events the DO forwards to parents.
export const CHILD_EVENTS = new Set([
  'status',
  'connection',
  'policy_applied',
  'sync_done',
  'notification',
]);
