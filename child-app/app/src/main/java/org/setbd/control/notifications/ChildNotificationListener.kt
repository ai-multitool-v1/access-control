package org.setbd.control.notifications

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Notification listener — disclosed in onboarding; presence enables the
 * "Notification access" status the parent can see. This app intentionally
 * does NOT upload notification contents anywhere.
 */
class ChildNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        // Intentionally a no-op: no content leaves this device.
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // Intentionally a no-op.
    }
}
