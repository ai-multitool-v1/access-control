package org.setbd.control.notifications

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.setbd.control.storage.Prefs
import org.setbd.control.util.ServiceLauncher
import org.setbd.control.sync.SyncWorker
import org.setbd.control.websocket.CommandProcessor

/**
 * FCM receiver — used ONLY as a wake-up / notification channel.
 * Firebase is optional: this service is inert unless google-services.json
 * is bundled. The primary transport is the WebSocket (not FCM).
 */
class ChildMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        Prefs.fcmToken = token
        // Registration happens on the next successful sync.
        SyncWorker.enqueueOneTime(this)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["type"]) {
            "wake" -> {
                // Server asked us to come back online (e.g. parent sent a command).
                if (org.setbd.control.storage.SecureStore.isPaired) {
                    ServiceLauncher.startRealtime(this)
                    SyncWorker.enqueueOneTime(this)
                }
            }
            else -> {
                NotificationHelper.showAlert(
                    this,
                    message.notification?.title ?: data["title"] ?: getString(org.setbd.control.R.string.app_name),
                    message.notification?.body ?: data["body"] ?: ""
                )
            }
        }
    }
}
