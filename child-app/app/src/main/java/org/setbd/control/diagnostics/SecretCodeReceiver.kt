package org.setbd.control.diagnostics

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.setbd.control.storage.Prefs
import org.setbd.control.storage.SecureStore
import org.setbd.control.util.ServiceLauncher

/**
 * Dialer secret code receiver: *#*#9999#*#* (fallback *#*#1000#*#*).
 * Works even when the launcher icon is hidden (alias-independent).
 *
 * Opens the MAIN APP UI (not diagnostics — diagnostics confused parents who
 * dialled the code expecting the app to open). Diagnostics stays reachable
 * from the in-app Settings screen.
 */
class SecretCodeReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "android.provider.Telephony.SECRET_CODE") return

        val i = if (Prefs.termsAccepted && SecureStore.isPaired) {
            // Paired: straight into the child dashboard.
            Intent(context, org.setbd.control.ui.DashboardActivity::class.java)
        } else {
            // Not paired yet: run onboarding (terms -> permissions -> pairing).
            Intent(context, org.setbd.control.onboarding.SplashActivity::class.java)
        }.apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
        }
        runCatching { context.startActivity(i) }
        // Make sure services are alive while we're here.
        if (Prefs.termsAccepted && SecureStore.isPaired) {
            ServiceLauncher.startAll(context)
        }
    }
}
