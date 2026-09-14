package org.setbd.control

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.setbd.control.controls.PolicyEngine
import org.setbd.control.notifications.NotificationHelper
import org.setbd.control.storage.Prefs
import org.setbd.control.storage.SecureStore
import org.setbd.control.sync.SyncWorker
import org.setbd.control.util.ServiceLauncher
import java.util.concurrent.TimeUnit

class AccessControlApp : Application() {

    override fun onCreate() {
        super.onCreate()
        appContext = this
        SecureStore.init(this)
        Prefs.init(this)
        NotificationHelper.createChannels(this)
        PolicyEngine.restore(this)
        schedulePeriodicSync()
        // Self-perpetuating 15-min watchdog: restarts dead services, refreshes
        // the persistent notifications, re-asserts the hidden launcher icon.
        org.setbd.control.boot.WatchdogReceiver.schedule(this)
        // Restore the realtime link after process death (paired + consented only).
        if (Prefs.termsAccepted && SecureStore.isPaired) {
            ServiceLauncher.startAll(this)
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
