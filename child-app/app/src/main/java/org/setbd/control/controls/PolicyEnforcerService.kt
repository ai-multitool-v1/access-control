package org.setbd.control.controls

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.setbd.control.R
import org.setbd.control.devicemanagement.DevicePolicy
import org.setbd.control.monitoring.UsageStatsProvider
import org.setbd.control.notifications.NotificationHelper
import org.setbd.control.storage.SecureStore

/**
 * Foreground protection service: watches the foreground app with a battery-aware
 * loop and shows the block screen when a policy says so.
 *
 * v1.11 hard block: the loop now RE-SHOWS the block screen whenever a blocked
 * app is still in the foreground and the block screen is not visible — closing
 * the overlay (OK / Back) can no longer buy even a second of access. The
 * screen-on cadence is 3 s (12 s while the screen is off), so reopening a
 * restricted app is cut off almost immediately.
 */
class PolicyEnforcerService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        startForeground(
            NotificationHelper.ENFORCER_NOTIFICATION_ID,
            NotificationHelper.protectionNotification(this)
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        scope.launch { loop() }
        return START_STICKY
    }

    /** Called when the task is swiped away — restart with everything else. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiping the app away on aggressive OEM skins kills foreground
        // services too — restart immediately while the process is still
        // alive, and schedule a watchdog tick as the safety net.
        runCatching { org.setbd.control.util.ServiceLauncher.startAll(this) }
        org.setbd.control.boot.WatchdogReceiver.schedule(this, 2_500L)
        super.onTaskRemoved(rootIntent)
    }

    private suspend fun loop() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        while (true) {
            try {
                maybeReArmUninstallProtection()
                if (SecureStore.isPaired && PrefsEnabled() && pm.isInteractive) {
                    val fg = UsageStatsProvider.currentForeground(this)
                    if (fg != null && PolicyEngine.shouldBlock(this, fg)) {
                        val uiVisible = BlockActivity.visible &&
                            blockShownFor == fg
                        if (!uiVisible) {
                            val now = System.currentTimeMillis()
                            // Re-block fast: first show is immediate, repeats
                            // are throttled to 1.5 s so a kid hammering the
                            // launcher cannot race the loop.
                            if (now - lastReshowAt >= RESHOW_THROTTLE_MS) {
                                lastReshowAt = now
                                blockShownFor = fg
                                val reason = PolicyEngine.blockReason(this, fg)
                                showBlock(fg, reason)
                                // Feed entry for the parent's GUI timeline (best
                                // effort, only on the FIRST block of this app).
                                if (blockAnnouncedFor != fg) {
                                    blockAnnouncedFor = fg
                                    val restricted = PolicyEngine.isRestricted(fg)
                                    org.setbd.control.websocket.CommandProcessor.postEvent(
                                        this,
                                        if (restricted) "app_blocked" else "app_open",
                                        if (restricted) "warning" else "info",
                                        if (restricted) "Blocked app opened" else "Limit reached — app blocked",
                                        fg
                                    )
                                }
                            }
                        }
                    } else {
                        blockShownFor = null
                        blockAnnouncedFor = null
                    }
                } else {
                    blockShownFor = null
                    blockAnnouncedFor = null
                }
            } catch (e: Exception) {
                // never crash the protection loop
            }
            // 3 s while the screen is on (tight block response), 12 s off-screen.
            delay(if (pm.isInteractive) LOOP_ACTIVE_MS else LOOP_IDLE_MS)
        }
    }

    /**
     * When a parent-approved uninstall window ends, notify ONCE so the child
     * can re-arm device admin from Settings. Never nag on every broadcast —
     * one prompt per expired window, nothing more.
     */
    private suspend fun maybeReArmUninstallProtection() {
        if (DevicePolicy.graceActive()) return
        if (DevicePolicy.isAdmin(this)) return
        val graceEnd = org.setbd.control.storage.Prefs.uninstallGraceUntil
        // Only after an actual parent-approved grace window has expired.
        if (graceEnd <= 0L || System.currentTimeMillis() <= graceEnd) return
        // Already reminded for this expiry — stay silent (fixes the repeated
        // "allow" prompts the child kept receiving every 30 minutes).
        if (org.setbd.control.storage.Prefs.uninstallReArmNotifiedAt >= graceEnd) return
        org.setbd.control.storage.Prefs.uninstallReArmNotifiedAt = System.currentTimeMillis()
        NotificationHelper.showAlert(
            this,
            getString(org.setbd.control.R.string.uninstall_expired_title),
            getString(org.setbd.control.R.string.uninstall_expired_body)
        )
    }

    private fun PrefsEnabled(): Boolean = org.setbd.control.storage.Prefs.termsAccepted

    private fun showBlock(pkg: String, reason: String) {
        val intent = Intent(this, BlockActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
            putExtra("package", pkg)
            putExtra("reason", reason)
        }
        try {
            startActivity(intent)
        } catch (e: Exception) {
            // Some OEMs block activity starts from background — retry on next loop.
        }
    }

    override fun onDestroy() {
        running = false
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "PolicyEnforcer"
        private const val LOOP_ACTIVE_MS = 3_000L
        private const val LOOP_IDLE_MS = 12_000L
        private const val RESHOW_THROTTLE_MS = 1_500L

        /** Liveness flag for WatchdogReceiver. */
        @Volatile
        var running = false
            private set

        /** Foreground package currently covered by a visible block screen. */
        @Volatile
        private var blockShownFor: String? = null

        /** Last foreground package we announced to the parent feed. */
        @Volatile
        private var blockAnnouncedFor: String? = null

        @Volatile
        private var lastReshowAt = 0L

        /**
         * BlockActivity dismissed (OK / Back / task swipe) — clear the shown
         * flag so the next loop tick (≤3 s) re-blocks a still-foreground app
         * immediately instead of assuming the overlay is still up.
         */
        fun notifyBlockDismissed() {
            blockShownFor = null
            lastReshowAt = 0L
        }
    }
}
