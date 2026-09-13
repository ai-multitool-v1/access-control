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
import org.setbd.control.monitoring.UsageStatsProvider
import org.setbd.control.notifications.NotificationHelper
import org.setbd.control.storage.SecureStore

/**
 * Foreground protection service: watches the foreground app with a battery-aware
 * loop and shows the block screen when a policy says so.
 */
class PolicyEnforcerService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var blockShownFor: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(
            NotificationHelper.ENFORCER_NOTIFICATION_ID,
            NotificationHelper.protectionNotification(this)
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        scope.launch { loop() }
        return START_STICKY
    }

    private suspend fun loop() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        while (true) {
            try {
                if (SecureStore.isPaired && PrefsEnabled() && pm.isInteractive) {
                    val fg = UsageStatsProvider.currentForeground(this)
                    if (fg != null && PolicyEngine.shouldBlock(this, fg)) {
                        if (blockShownFor != fg) {
                            blockShownFor = fg
                            showBlock(fg, PolicyEngine.blockReason(this, fg))
                        }
                    } else {
                        blockShownFor = null
                    }
                } else {
                    blockShownFor = null
                }
            } catch (e: Exception) {
                // never crash the protection loop
            }
            delay(12_000)
        }
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
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "PolicyEnforcer"
    }
}
