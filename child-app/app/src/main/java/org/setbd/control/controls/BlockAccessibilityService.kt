package org.setbd.control.controls

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.setbd.control.monitoring.BrowserCapture
import org.setbd.control.permissions.PermissionManager

/**
 * Accessibility-powered protection core. Four jobs:
 *
 * 1. Instant app blocking — when a blocked app comes to the foreground the
 *    block screen is shown immediately (same mechanism AirDroid Kids uses).
 *
 * 2. Silent command mode confirmation — when Device admin + Accessibility are
 *    ON, the parent's screen-mirror requests open the system MediaProjection
 *    dialog directly and this service confirms it automatically ("Start now"),
 *    so the child no longer taps allow again and again. The confirm watcher is
 *    ARMED right before the dialog opens and scans ALL SystemUI windows on
 *    both window-state and window-content events (the dialog builds its
 *    buttons asynchronously — state events alone missed them), with
 *    multilingual labels including Bengali.
 *
 * 3. Remote touch assistance — remote sessions dispatch taps / swipes /
 *    scrolls and global actions (back / home / recents) here. See RemoteInput.
 *
 * 4. Browser history capture — visible URLs / search terms typed in browser
 *    apps are captured for the parent's browsing view (see BrowserCapture).
 *    Fully disclosed in onboarding; can be disabled any time from system
 *    Accessibility settings.
 */
class BlockAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onUnbind(intent: Intent?): Boolean {
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

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
                // The projection dialog populates its buttons ASYNCHRONOUSLY:
                // content-changed events must also trigger the auto-confirm
                // scan, otherwise the dialog opens and silently disappears.
                maybeAutoConfirmProjection(pkg)
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
     *
     * The scan only runs while armed (armProjectionConfirm, 40 s window) so the
     * rest of the UI is never touched by mistake.
     */
    private fun maybeAutoConfirmProjection(pkg: String) {
        if (pkg != SYSTEM_UI_PKG && pkg != "com.android.settings") return
        val now = System.currentTimeMillis()
        if (now > consentArmedUntil) return
        if (!PermissionManager.silentModeActive(this)) return
        if (now - lastProjectionClick < PROJECTION_THROTTLE_MS) return
        if (now - lastProjectionScan < 400L) return
        lastProjectionScan = now
        val confirm = findConfirmInAllWindows() ?: return
        if (confirm.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            lastProjectionClick = now
            consentArmedUntil = 0L
        }
    }

    private fun findConfirmInAllWindows(): AccessibilityNodeInfo? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            for (w in windows) {
                val root = runCatching { w.root }.getOrNull() ?: continue
                if (root.packageName == SYSTEM_UI_PKG) {
                    findConfirmButton(root)?.let { return it }
                }
                runCatching { root.recycle() }
            }
        }
        val active = runCatching { rootInActiveWindow }.getOrNull() ?: return null
        return if (active.packageName == SYSTEM_UI_PKG) findConfirmButton(active) else null
    }

    private fun findConfirmButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        // The system dialog exposes its buttons as button1 (positive) /
        // button2 (negative). On several OEM skins the ORDER IS REVERSED —
        // blindly clicking button1 used to press "Cancel", which cancelled the
        // dialog instantly and looked like "cast permission pops up then goes
        // away". Pick the button whose TEXT actually matches a positive label;
        // if neither matches, do NOT click anything.
        val stdButtons = runCatching {
            listOf("android:id/button1", "android:id/button2", "android:id/button3")
                .flatMap { id -> root.findAccessibilityNodeInfosByViewId(id) }
        }.getOrNull().orEmpty().filter { it.isClickable }
        if (stdButtons.isNotEmpty()) {
            val positive = stdButtons.firstOrNull { node -> hasPositiveLabel(node) }
            if (positive != null) return positive
            // Buttons exist but labels are unknown — fall through to the text
            // scan instead of gambling on a cancel button.
        }
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        var visited = 0
        while (stack.isNotEmpty() && visited < MAX_SCAN_NODES) {
            visited++
            val node = runCatching { stack.removeFirst() }.getOrNull() ?: continue
            if (node.isClickable && hasPositiveLabel(node)) return node
            for (i in 0 until node.childCount) {
                runCatching { node.getChild(i) }.getOrNull()?.let { stack.add(it) }
            }
        }
        return null
    }

    private fun hasPositiveLabel(node: AccessibilityNodeInfo): Boolean {
        val text = node.text?.toString()?.trim()?.lowercase()
        val desc = node.contentDescription?.toString()?.trim()?.lowercase()
        return PROJECTION_LABELS.any { text?.contains(it) == true } ||
            PROJECTION_LABELS.any { desc?.contains(it) == true }
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
        // Tight enough that reopening a restricted app is blocked in under a
        // second (PolicyEnforcerService's 3 s loop is the backstop).
        private const val BLOCK_THROTTLE_MS = 900L
        private const val PROJECTION_THROTTLE_MS = 1200L
        private const val MAX_SCAN_NODES = 300
        private const val SYSTEM_UI_PKG = "com.android.systemui"
        private const val CONSENT_ARM_MS = 40_000L

        // System MediaProjection consent dialog labels across Android versions
        // AND locales (device language matters — English-only matching silently
        // failed on Bengali/other-locale devices, so the dialog was left to
        // time out and the parent saw "cast permission appears then goes away").
        private val PROJECTION_LABELS = listOf(
            "start now", "record screen", "share screen", "start sharing",
            "share entire screen", "cast screen", "share this screen", "allow",
            "whole screen", "entire screen", "yes, share",
            // Bengali
            "শুরু করুন", "এখন শুরু", "স্ক্রিন শেয়ার", "শেয়ার করুন", "সম্পূর্ণ",
            "অনুমতি দিন", "রেকর্ড", "হ্যাঁ",
            // Hindi / Indonesian / Spanish / Portuguese / Arabic / Russian / Turkish / Vietnamese / Thai
            "शुरू करें", "अनुमति दें", "mulai", "izinkan", "compartir", "permitir",
            "السماح", "начать", "izin ver", "bắt đầu", "เริ่ม", "開始"
        )

        /** Live instance for remote-touch dispatch (see RemoteInput). */
        @Volatile
        var instance: BlockAccessibilityService? = null
            private set

        @Volatile
        private var lastBlockAt = 0L
        @Volatile
        private var lastProjectionClick = 0L
        @Volatile
        private var lastProjectionScan = 0L
        @Volatile
        private var consentArmedUntil = 0L

        /**
         * Arm the auto-confirm watcher for the next [CONSENT_ARM_MS]. Called
         * immediately before MirrorConsentActivity opens the system dialog.
         */
        fun armProjectionConfirm() {
            consentArmedUntil = System.currentTimeMillis() + CONSENT_ARM_MS
        }

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
