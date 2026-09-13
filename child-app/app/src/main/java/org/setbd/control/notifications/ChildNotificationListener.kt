package org.setbd.control.notifications

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import org.setbd.control.BuildConfig
import org.setbd.control.storage.SecureStore
import org.setbd.control.util.Http

/**
 * Notification listener — disclosed in onboarding. When the child device
 * granted "Notification access", each user-visible notification is queued
 * (app name, title, text) and flushed in small batches to the parent
 * dashboard, so the parent can see WHICH apps sent WHICH notifications.
 * Ongoing/system notifications (silent, progress, media) are skipped.
 */
class ChildNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val n = sbn ?: return
        try {
            if (n.packageName == packageName) return           // never capture our own prompts
            if (n.isOngoing) return                            // silent/progress/system
            val extras = n.notification?.extras ?: return
            if (extras.getBoolean("android.isGroupSummary")) return

            val title = extras.getCharSequence("android.title")?.toString().orEmpty().trim()
            val text = extras.getCharSequence("android.text")?.toString().orEmpty().trim()
            if (title.isBlank() && text.isBlank()) return

            val appLabel = try {
                packageManager.getApplicationLabel(
                    packageManager.getApplicationInfo(n.packageName, 0)
                ).toString()
            } catch (e: Exception) {
                n.packageName
            }

            val item = JSONObject()
                .put("type", "notification")
                .put("severity", "info")
                .put("title", appLabel.take(140))
                .put("packageName", n.packageName.take(160))
                .put(
                    "detail",
                    JSONObject()
                        .put("text", text.take(500))
                        .put("notifTitle", title.take(200))
                        .put("postedAt", n.postTime)
                )

            synchronized(queueLock) {
                // Skip exact consecutive duplicates (some apps repost).
                val sig = "${n.packageName}|$title|$text"
                if (sig == lastSignature) return
                lastSignature = sig
                queue.put(item)
                while (queue.length() > 40) queue.remove(0)
            }
            flushIfDue()
        } catch (e: Exception) {
            // never crash the listener service
        }
    }

    private fun flushIfDue() {
        val now = System.currentTimeMillis()
        val batch = JSONArray()
        synchronized(queueLock) {
            if (now - lastFlush < 20_000 && queue.length() < 10) return
            lastFlush = now
            while (queue.length() > 0) batch.put(queue.remove(0))
        }
        if (batch.length() > 0) {
            // Network must never run on the listener's main thread.
            Thread { postBatch(batch) }.start()
        }
    }

    private fun postBatch(events: JSONArray) {
        if (!SecureStore.isPaired) return
        try {
            val token = SecureStore.deviceToken ?: return
            Http.post(
                "${BuildConfig.API_BASE}/api/events/batch",
                token,
                JSONObject().put("events", events).toString()
            )
        } catch (e: Exception) {
            // dropped — the next flush will retry with fresh items
        }
    }

    companion object {
        private val queueLock = Any()
        private val queue = JSONArray()
        private var lastFlush = 0L
        private var lastSignature: String? = null
    }
}
