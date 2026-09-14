package org.setbd.control.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import org.setbd.control.BuildConfig
import org.setbd.control.controls.PolicyEngine
import org.setbd.control.monitoring.LocationProvider
import org.setbd.control.monitoring.UsageStatsProvider
import org.setbd.control.permissions.PermissionManager
import org.setbd.control.storage.SecureStore
import org.setbd.control.storage.Prefs
import org.setbd.control.util.Http

/**
 * Periodic + on-demand sync: uploads usage summaries, location (only when the
 * parent enabled monitoring AND permission is granted) and touches last-seen.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        if (!SecureStore.isPaired || !Prefs.termsAccepted) return Result.success()
        val deviceId = SecureStore.deviceId ?: return Result.success()
        val token = SecureStore.deviceToken ?: return Result.success()

        // 0. KEEP-ALIVE: the periodic worker is the most persistent component
        //    the app owns (WorkManager survives process death and OEM kills).
        //    Whenever it wakes, it also revives any dead foreground service so
        //    the realtime link comes back even if the app was swiped away.
        try {
            if (!org.setbd.control.websocket.RealtimeService.running ||
                !org.setbd.control.controls.PolicyEnforcerService.running
            ) {
                org.setbd.control.util.ServiceLauncher.startAll(applicationContext)
            }
            org.setbd.control.boot.WatchdogReceiver.schedule(applicationContext)
        } catch (e: Exception) {
            // FGS start restrictions on some OEMs — the next cycle retries
        }

        // 1. Usage summaries (needs Usage Access)
        if (PermissionManager.usageAccessGranted(applicationContext)) {
            try {
                val report = UsageStatsProvider.reportJson(applicationContext, today())
                val body = JSONObject()
                    .put("date", report.optString("date"))
                    .put("apps", report.optJSONArray("apps") ?: JSONArray())
                Http.post("${BuildConfig.API_BASE}/api/usage/batch", token, body.toString())
            } catch (e: Exception) {
                return if (runAttemptCount < 3) Result.retry() else Result.success()
            }
        }

        // 1b. Full app inventory (icons + usage + install times) — best effort.
        try {
            org.setbd.control.websocket.CommandProcessor.uploadInventory(applicationContext)
        } catch (e: Exception) {
            // inventory is large and best-effort; retried on the next cycle
        }

        // 2. Location — only when both policy + permission are present
        if (PolicyEngine.locationMonitoringEnabled() &&
            PermissionManager.locationGranted(applicationContext)
        ) {
            try {
                val loc = LocationProvider.reportJson(applicationContext)
                if (loc != null) {
                    Http.post("${BuildConfig.API_BASE}/api/location", token, loc.toString())
                }
            } catch (e: Exception) {
                // location is best-effort; never fail the whole sync for it
            }
        }

        // 2b. Browser history queue — URLs / searches captured by the
        //     accessibility service (best-effort, retried next cycle).
        try {
            org.setbd.control.monitoring.BrowserCapture.flush(applicationContext)
        } catch (e: Exception) {
            // queue stays for the next sync
        }

        // 3. FCM token registration (optional; active when Firebase configured)
        Prefs.fcmToken?.let { fcm ->
            try {
                Http.post(
                    "${BuildConfig.API_BASE}/api/devices/fcm", token,
                    JSONObject().put("fcmToken", fcm).toString()
                )
            } catch (e: Exception) {
            }
        }

        return Result.success()
    }

    private fun today(): String {
        val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
        return fmt.format(java.util.Date())
    }

    companion object {
        fun enqueueOneTime(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>().build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork("ac_sync_now", ExistingWorkPolicy.REPLACE, req)
        }
    }
}
