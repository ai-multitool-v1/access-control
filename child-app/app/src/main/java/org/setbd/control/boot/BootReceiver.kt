package org.setbd.control.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.setbd.control.storage.Prefs
import org.setbd.control.storage.SecureStore
import org.setbd.control.util.ServiceLauncher
import org.setbd.control.sync.SyncWorker
import org.setbd.control.ui.IconHider

/**
 * After reboot: restore authenticated state, re-apply icon visibility,
 * restart the realtime link + protection, and reschedule periodic sync.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val supported = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            Intent.ACTION_MY_PACKAGE_REPLACED
        )
        if (action !in supported) return
        if (!Prefs.termsAccepted || !SecureStore.isPaired) return

        // Re-apply hidden-icon state (launcher alias lives in PackageManager, but
        // re-asserting keeps OEM launchers consistent).
        IconHider.apply(context, Prefs.iconHidden)

        ServiceLauncher.startAll(context)
        SyncWorker.enqueueOneTime(context)
    }
}
