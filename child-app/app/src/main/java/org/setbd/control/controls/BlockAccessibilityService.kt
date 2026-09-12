package org.setbd.control.controls

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent

/**
 * Accessibility-based instant app blocking (the same mechanism AirDroid Kids
 * uses). When a blocked app comes to the foreground, the block screen is
 * shown immediately instead of waiting for the UsageStats polling loop.
 * Fully disclosed in onboarding; can be disabled any time from system
 * Accessibility settings.
 */
class BlockAccessibilityService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg.isEmpty() || pkg == packageName) return
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
    }

    override fun onInterrupt() {}

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
        @Volatile
        private var lastBlockAt = 0L

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
