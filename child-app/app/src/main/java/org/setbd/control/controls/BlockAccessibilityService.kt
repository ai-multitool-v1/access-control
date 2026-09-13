package org.setbd.control.controls

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.setbd.control.monitoring.BrowserCapture
import org.setbd.control.permissions.PermissionManager

/**
 * Accessibility-powered protection core. Three jobs:
 *
 * 1. Instant app blocking — when a blocked app comes to the foreground the
 *    block screen is shown immediately (same mechanism AirDroid Kids uses).
 *
 * 2. Silent command mode confirmation — when Device admin + Accessibility are
 *    ON, the parent's screen-mirror requests open the system MediaProjection
 *    dialog directly and this service confirms it automatically ("Start now"),
 *    so the child no longer taps allow again and again.
 *
 * 3. Browser history capture — visible URLs / search terms typed in browser
 *    apps are captured for the parent's browsing view (see BrowserCapture).
 *    Fully disclosed in onboarding; can be disabled any time from system
 *    Accessibility settings.
 */
class BlockAccessibilityService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg.isEmpty() || pkg == packageName) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                if (isLauncher(pkg)) return
                val now = System.currentTimeMillis()
                if (now - lastBlockAt < BLOCK_THROTTLE_MS) return
                if (PolicyEngine.shouldBlock(this, pkg)) {
                    lastBlockAt = now
                    val intent = Intent(this, BlockActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        .putExtra("package", pkg)
                        .putExtra("reason", PolicyEngine.blockReason(this, pkg))
                    runCatching { startActivity(intent) }
                }
                // A fresh system dialog may be the MediaProjection consent —
                // confirm it when silent mode is active.
                maybeAutoConfirmProjection(pkg)
                // New browser window → capture the visible URL straight away.
                BrowserCapture.onEvent(this, event)
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                // URL bar / search field edits (throttled inside BrowserCapture).
                BrowserCapture.onEvent(this, event)
            }
        }
    }

    override fun onInterrupt() {}

    /**
     * Auto-confirms the system "Start now / Record screen" MediaProjection
     * dialog while silent command mode is active (device admin + accessibility
     * granted). The dialog belongs to SystemUI; we look for its clickable
     * confirm button and click it. Never touches anything else.
     */
    private fun maybeAutoConfirmProjection(pkg: String) {
        if (pkg != SYSTEM_UI_PKG) return
        if (!PermissionManager.silentModeActive(this)) return
        val now = System.currentTimeMillis()
        if (now - lastProjectionClick < PROJECTION_THROTTLE_MS) return
        val root = runCatching { rootInActiveWindow }.getOrNull() ?: return
        if (root.packageName != SYSTEM_UI_PKG) return
        val confirm = findConfirmButton(root) ?: return
        if (confirm.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            lastProjectionClick = now
        }
        runCatching { root.recycle() }
    }

    private fun findConfirmButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        var visited = 0
        while (stack.isNotEmpty() && visited < MAX_SCAN_NODES) {
            visited++
            val node = runCatching { stack.removeFirst() }.getOrNull() ?: continue
            val text = node.text?.toString()?.trim()?.lowercase()
            val desc = node.contentDescription?.toString()?.trim()?.lowercase()
            if (node.isClickable &&
                (PROJECTION_LABELS.any { text?.contains(it) == true } ||
                    PROJECTION_LABELS.any { desc?.contains(it) == true })
            ) {
                return node
            }
            for (i in 0 until node.childCount) {
                runCatching { node.getChild(i) }.getOrNull()?.let { stack.add(it) }
            }
        }
        return null
    }

    private fun isLauncher(pkg: String): Boolean {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        return try {
            val resolve = packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)
            resolve?.activityInfo?.packageName == pkg
        } catch (e: Exception) {
            false
        }
    }

    companion object {
        private const val BLOCK_THROTTLE_MS = 1500L
        private const val PROJECTION_THROTTLE_MS = 4000L
        private const val MAX_SCAN_NODES = 300
        private const val SYSTEM_UI_PKG = "com.android.systemui"

        // System MediaProjection consent dialog labels across Android versions.
        private val PROJECTION_LABELS = listOf(
            "start now", "record screen", "share screen", "start sharing",
            "share entire screen", "cast screen", "share this screen"
        )

        @Volatile
        private var lastBlockAt = 0L
        @Volatile
        private var lastProjectionClick = 0L

        fun isEnabled(ctx: android.content.Context): Boolean {
            val setting = Settings.Secure.getString(
                ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false
            if (setting.isEmpty()) return false
            val flat = "${ctx.packageName}/org.setbd.control.controls.BlockAccessibilityService"
            return setting.split(':').any {
                it.equals(flat, ignoreCase = true) ||
                    it.contains(ctx.packageName) && it.contains("BlockAccessibilityService")
            }
        }
    }
}
