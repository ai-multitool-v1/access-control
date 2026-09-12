package org.setbd.control.diagnostics

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.setbd.control.storage.Prefs
import org.setbd.control.util.ServiceLauncher

/**
 * Dialer secret code receiver: *#*#9999#*#* (fallback *#*#1000#*#*).
 * Works even when the launcher icon is hidden (alias-independent).
 */
class SecretCodeReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "android.provider.Telephony.SECRET_CODE") return
        val i = Intent(context, DiagnosticsActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(i) }
        // If already paired, make sure services are alive while we're here.
        if (Prefs.termsAccepted && org.setbd.control.storage.SecureStore.isPaired) {
            ServiceLauncher.startAll(context)
        }
    }
}
