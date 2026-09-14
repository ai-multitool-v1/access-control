package org.setbd.control.boot

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.setbd.control.storage.Prefs
import org.setbd.control.storage.SecureStore
import org.setbd.control.ui.IconHider
import org.setbd.control.util.ServiceLauncher
import org.setbd.control.websocket.RealtimeService
import org.setbd.control.controls.PolicyEnforcerService

/**
 * Self-perpetuating 15-minute watchdog — the reason notifications and the
 * protection services keep running "for a while and then die" on aggressive
 * OEMs (MIUI, ColorOS, Vivo, Realme):
 *
 *  - restarts the realtime + enforcer foreground services if either died,
 *  - re-posts their persistent notifications (OEMs strip stale ones),
 *  - re-asserts the hidden launcher icon ( PackageManager state survives
 *    reboots, but some launchers resurrect the alias after updates).
 *
 * Inexact alarms only — no SCHEDULE_EXACT_ALARM permission needed.
 */
class WatchdogReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val active = Prefs.termsAccepted && SecureStore.isPaired
        if (active) {
            val realtimeDead = !RealtimeService.running
            val enforcerDead = !PolicyEnforcerService.running
            if (realtimeDead || enforcerDead) {
                runCatching { ServiceLauncher.startAll(context) }
            }
            // OEM launchers sometimes re-enable the alias after an app update —
            // re-assert the parent's hidden-icon choice.
            if (Prefs.iconHidden && !IconHider.isHidden(context)) {
                IconHider.apply(context, true)
            }
            // NOTE: notifications are intentionally NOT re-posted here. The
            // services re-post their own silent foreground notification via
            // startForeground(); an extra notify() made the "Keeping this
            // device protected" entry re-flash in the tray every 15 minutes,
            // which was the #1 complaint. The foreground notification is
            // IMPORTANCE_MIN — silent, no status-bar icon, never refreshed.
        }
        schedule(context, INTERVAL_MS)
    }

    companion object {
        private const val REQUEST_CODE = 9901
        private const val INTERVAL_MS = 15 * 60_000L

        /** Schedule the next watchdog tick after [delayMs]. */
        fun schedule(context: Context, delayMs: Long = INTERVAL_MS) {
            try {
                val pi = PendingIntent.getBroadcast(
                    context,
                    REQUEST_CODE,
                    Intent(context, WatchdogReceiver::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + delayMs, pi)
            } catch (_: Exception) {
                // AlarmManager unavailable on some skins — WorkManager sync still covers us
            }
        }
    }
}
