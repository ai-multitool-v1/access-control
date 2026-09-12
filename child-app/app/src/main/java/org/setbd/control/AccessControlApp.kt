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
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(
                    NotificationHelper.CH_PROTECTION,
                    context.getString(R.string.notif_channel_protection),
                    NotificationManager.IMPORTANCE_LOW
                )
            )
            nm.createNotificationChannel(
                NotificationChannel(
                    NotificationHelper.CH_ALERTS,
                    context.getString(R.string.notif_channel_alerts),
                    NotificationManager.IMPORTANCE_HIGH
                )
            )
        }
    }
}
