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
import org.setbd.control.webrtc.MirrorConsentActivity

object NotificationHelper {
    // v1.7.0: the old "protection" channel (IMPORTANCE_LOW) made the persistent
    // "Keeping this device protected" notification VISIBLY sit in the status
    // bar and re-flash every time a service reposted it — the single most
    // complained-about annoyance. Channels cannot be re-importanced once
    // created, so protection services now post on a brand-new channel with
    // IMPORTANCE_MIN: no status-bar icon, no sound, no heads-up, collapsed to
    // the silent bottom section. The old channel is deleted outright.
    const val CH_PROTECTION = "protection_silent_v2"
    const val CH_PROTECTION_LEGACY = "protection"
    const val CH_ALERTS = "alerts"
    const val ENFORCER_NOTIFICATION_ID = 42
    const val REALTIME_NOTIFICATION_ID = 43
    const val ALERT_NOTIFICATION_ID = 44
    const val CAPTURE_NOTIFICATION_ID = 45
    const val CAPTURE_REQUEST_NOTIFICATION_ID = 46

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Remove the old visible "protection" channel from every previously
        // installed version — its notifications disappear with it.
        runCatching { nm.deleteNotificationChannel(CH_PROTECTION_LEGACY) }
        runCatching { nm.deleteNotificationChannel("protection_silent") }
        val silent = NotificationChannel(
            CH_PROTECTION,
            context.getString(R.string.notif_channel_protection),
            NotificationManager.IMPORTANCE_MIN
        ).apply {
            setShowBadge(false)
            enableVibration(false)
            enableLights(false)
            setSound(null, null)
        }
        nm.createNotificationChannel(silent)
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

    /**
     * The foreground-service notification required by Android for the
     * realtime + enforcer services. Posted on the IMPORTANCE_MIN channel with
     * SECRET visibility and MIN priority: the service stays fully protected,
     * but the notification never shows an icon, never sounds, never flashes,
     * and hides from the lock screen. As close to "no notification" as
     * Android physically allows a foreground service to be.
     */
    private fun silentServiceNotification(ctx: Context): Notification =
        NotificationCompat.Builder(ctx, CH_PROTECTION)
            .setSmallIcon(R.drawable.ic_logo)
            .setContentTitle(ctx.getString(R.string.notif_protection_title))
            .setContentText(ctx.getString(R.string.notif_protection_text))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setShowWhen(false)
            .setSilent(true)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_NONE)
            .build()

    fun protectionNotification(ctx: Context): Notification = silentServiceNotification(ctx)

    fun realtimeNotification(ctx: Context): Notification = silentServiceNotification(ctx)

    /** Ongoing WebRTC capture indicator (screen sharing / microphone / camera).
     *  Kept minimal the same way — Android additionally shows its own cast/mic
     *  indicators for the duration of the session. */
    fun captureNotification(ctx: Context, text: String): Notification =
        NotificationCompat.Builder(ctx, CH_PROTECTION)
            .setSmallIcon(R.drawable.ic_logo)
            .setContentTitle(ctx.getString(R.string.capture_active_title))
            .setContentText(text)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setShowWhen(false)
            .setSilent(true)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_NONE)
            .build()

    /**
     * High-priority tap-to-allow prompt for remote capture requests.
     * Tapping opens MirrorConsentActivity (which triggers the system
     * MediaProjection dialog for screen sharing).
     */
    fun showCaptureRequest(ctx: Context, kind: String, facing: String?) {
        if (!canPostNotifications(ctx)) return
        val body = when (kind) {
            "screen" -> ctx.getString(R.string.capture_request_screen)
            "ambient" -> ctx.getString(R.string.capture_request_audio)
            else -> ctx.getString(R.string.capture_request_camera)
        }
        val pending = PendingIntent.getActivity(
            ctx,
            CAPTURE_REQUEST_NOTIFICATION_ID + kind.hashCode(),
            MirrorConsentActivity.intent(ctx, kind, facing),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = NotificationCompat.Builder(ctx, CH_ALERTS)
            .setSmallIcon(R.drawable.ic_logo)
            .setContentTitle(ctx.getString(R.string.capture_request_title))
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .build()
        try {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(CAPTURE_REQUEST_NOTIFICATION_ID + kind.hashCode(), n)
        } catch (e: SecurityException) {
            // notifications disabled — child must open the app manually
        }
    }

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
