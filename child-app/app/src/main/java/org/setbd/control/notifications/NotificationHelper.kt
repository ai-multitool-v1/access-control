package org.setbd.control.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.setbd.control.R
import org.setbd.control.onboarding.SplashActivity

object NotificationHelper {
    const val CH_PROTECTION = "protection"
    const val CH_ALERTS = "alerts"
    const val ENFORCER_NOTIFICATION_ID = 42
    const val REALTIME_NOTIFICATION_ID = 43
    const val ALERT_NOTIFICATION_ID = 44

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CH_PROTECTION, context.getString(R.string.notif_channel_protection), NotificationManager.IMPORTANCE_LOW)
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_ALERTS, context.getString(R.string.notif_channel_alerts), NotificationManager.IMPORTANCE_HIGH)
        )
    }

    fun canPostNotifications(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    private fun contentIntent(ctx: Context): PendingIntent =
        PendingIntent.getActivity(
            ctx, 0,
            Intent(ctx, SplashActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    fun protectionNotification(ctx: Context): Notification =
        NotificationCompat.Builder(ctx, CH_PROTECTION)
            .setSmallIcon(R.drawable.ic_logo)
            .setContentTitle(ctx.getString(R.string.notif_protection_title))
            .setContentText(ctx.getString(R.string.notif_protection_text))
            .setOngoing(true)
            .setContentIntent(contentIntent(ctx))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    fun realtimeNotification(ctx: Context): Notification =
        NotificationCompat.Builder(ctx, CH_PROTECTION)
            .setSmallIcon(R.drawable.ic_logo)
            .setContentTitle(ctx.getString(R.string.notif_protection_title))
            .setContentText(ctx.getString(R.string.notif_protection_text))
            .setOngoing(true)
            .setContentIntent(contentIntent(ctx))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    /** Parent message or device alert. */
    fun showAlert(ctx: Context, title: String, body: String) {
        if (!canPostNotifications(ctx)) return
        val n = NotificationCompat.Builder(ctx, CH_ALERTS)
            .setSmallIcon(R.drawable.ic_logo)
            .setContentTitle(title.take(80))
            .setContentText(body.take(200))
            .setStyle(NotificationCompat.BigTextStyle().bigText(body.take(1000)))
            .setAutoCancel(true)
            .setContentIntent(contentIntent(ctx))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        try {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(ALERT_NOTIFICATION_ID, n)
        } catch (e: SecurityException) {
            // user declined notifications — nothing to do
        }
    }
}
