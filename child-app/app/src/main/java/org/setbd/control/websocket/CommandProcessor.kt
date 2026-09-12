package org.setbd.control.websocket

import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject
import org.setbd.control.BuildConfig
import org.setbd.control.controls.BlockActivity
import org.setbd.control.controls.PolicyEngine
import org.setbd.control.devicemanagement.DevicePolicy
import org.setbd.control.monitoring.DeviceInfoProvider
import org.setbd.control.monitoring.InstalledAppsProvider
import org.setbd.control.monitoring.LocationProvider
import org.setbd.control.monitoring.UsageStatsProvider
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
        "trigger_sync"
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

                else -> Result.Failed("unknown_action", "Action \"$action\" is not allowed")
            }
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
