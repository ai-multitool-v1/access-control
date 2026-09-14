package org.setbd.control

import android.app.Application
import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONObject
import org.setbd.control.controls.PolicyEngine
import org.setbd.control.notifications.NotificationHelper
import org.setbd.control.storage.Prefs
import org.setbd.control.storage.SecureStore
import org.setbd.control.sync.SyncWorker
import org.setbd.control.util.ServiceLauncher
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class AccessControlApp : Application() {

    override fun onCreate() {
        super.onCreate()
        appContext = this
        SecureStore.init(this)
        Prefs.init(this)
        NotificationHelper.createChannels(this)
        PolicyEngine.restore(this)
        installCrashReporter()
        schedulePeriodicSync()
        // Self-perpetuating 15-min watchdog: restarts dead services, refreshes
        // the persistent notifications, re-asserts the hidden launcher icon.
        org.setbd.control.boot.WatchdogReceiver.schedule(this)
        // Restore the realtime link after process death (paired + consented only).
        if (Prefs.termsAccepted && SecureStore.isPaired) {
            ServiceLauncher.startAll(this)
        }
    }

    /**
     * v1.11 crash reporting: any uncaught exception is pushed to the parent's
     * feed as a critical `app_crash` event (best effort, ≤2.5 s budget) BEFORE
     * the system kill. Without this, a runtime crash — e.g. inside the screen
     * mirror pipeline on a specific OEM — was invisible: the parent only saw
     * "device went offline". The stack snippet in the feed makes remote
     * diagnosis possible.
     */
    private fun installCrashReporter() {
        val systemHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = java.io.StringWriter()
                throwable.printStackTrace(java.io.PrintWriter(sw))
                val stack = sw.toString().take(3500)
                // 1) instant path: live WebSocket event (no network setup cost)
                runCatching {
                    org.setbd.control.websocket.RealtimeBridge.sendEvent(
                        "app_crash",
                        JSONObject()
                            .put("thread", thread.name)
                            .put("what", throwable.javaClass.name)
                            .put("message", throwable.message ?: "")
                            .put("stack", stack)
                    )
                }
                // 2) durable path: REST event so it survives a dead socket
                thread(isDaemon = false) {
                    runCatching {
                        kotlinx.coroutines.runBlocking {
                            org.setbd.control.websocket.CommandProcessor.postEvent(
                                this@AccessControlApp,
                                "app_crash",
                                "critical",
                                "App crashed on device",
                                detail = JSONObject()
                                    .put("thread", thread.name)
                                    .put("stack", stack)
                            )
                        }
                    }
                }.join(2_500L)
            } catch (_: Throwable) {
                // never interfere with the crash flow
            }
            systemHandler?.uncaughtException(thread, throwable)
        }
    }

    private fun schedulePeriodicSync() {
        val wm = WorkManager.getInstance(this)
        val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .build()
        wm.enqueueUniquePeriodicWork("ac_periodic_sync", ExistingPeriodicWorkPolicy.KEEP, req)
    }

    companion object {
        lateinit var appContext: Context
            private set

        fun createChannels(context: Context) {
            // Channel creation (incl. deleting the old visible "protection"
            // channel and recreating it as IMPORTANCE_MIN) lives in
            // NotificationHelper.createChannels — one source of truth.
            NotificationHelper.createChannels(context)
        }
    }
}
