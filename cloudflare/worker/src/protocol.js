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
  // WebRTC remote access (screen mirror / ambient audio / remote camera)
  'start_screen_mirror',
  'stop_screen_mirror',
  'start_ambient_audio',
  'stop_ambient_audio',
  'start_remote_camera',
  'stop_remote_camera',
  // Optional communications monitoring (permission-gated on the child)
  'get_contacts',
  'get_call_logs',
  'get_sms',
  // Device management
  'set_icon_hidden',
]);

// Child -> parent events the DO forwards to parents.
export const CHILD_EVENTS = new Set([
  'status',
  'connection',
  'policy_applied',
  'sync_done',
  'notification',
  'capture_state',
]);

// Structured WebRTC signaling (SDP offers/answers + ICE candidates).
// Relayed through the DO over the existing authenticated WebSocket.
export const RTC_KINDS = new Set(['screen', 'ambient', 'camera']);
export const RTC_ACTIONS_PARENT_TO_CHILD = new Set(['answer', 'ice', 'stop']);
export const RTC_ACTIONS_CHILD_TO_PARENT = new Set(['offer', 'ice', 'stopped', 'error']);
