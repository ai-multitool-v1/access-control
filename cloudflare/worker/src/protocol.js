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
  'allow_uninstall',      // parent-verified uninstall window (device admin off for N minutes)
  'refresh_hardware',     // ask the child to re-post its full hardware report
  'sync_media',           // ask the child to re-index photos/videos for the parent's media view
  'sync_notifications',   // ask the child to flush its queued notification history
  // Parent overlay push (custom text + optional picture, shown instantly)
  'force_overlay',
  // On-device preview relay (files / photos / videos are NEVER stored server-side)
  'media_preview',
  'list_files',
  // Chunked whole-file relay (browser playback + parent downloads)
  'read_file',
  // Remote touch assistance for live remote sessions (accessibility-gated)
  'remote_input',
  // History viewers (usage events; browser apps history)
  'get_usage_timeline',
  'get_browser_history',
]);

// Commands whose responses can be large (chunked base64 previews / history
// dumps) get a longer ack window than the default 15 s.
export const LONG_COMMANDS = new Set([
  'media_preview',
  'list_files',
  'read_file',
  'get_usage_timeline',
  'get_browser_history',
  'get_contacts',
  'get_call_logs',
  'get_sms',
  'sync_media',
  'get_installed_apps',
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

// Server -> child events (relayed through the DO /server-event route).
export const SERVER_CHILD_EVENTS = new Set([
  'policies_updated',
  'zone_alert',     // SOS overlay: the child left every active safe zone
]);

// Structured WebRTC signaling (SDP offers/answers + ICE candidates).
// Relayed through the DO over the existing authenticated WebSocket.
export const RTC_KINDS = new Set(['screen', 'ambient', 'camera']);
export const RTC_ACTIONS_PARENT_TO_CHILD = new Set(['answer', 'ice', 'stop']);
export const RTC_ACTIONS_CHILD_TO_PARENT = new Set(['offer', 'ice', 'stopped', 'error']);
