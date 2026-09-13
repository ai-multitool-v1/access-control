package org.setbd.control.permissions

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.setbd.control.controls.BlockAccessibilityService
import org.setbd.control.devicemanagement.DevicePolicy
import org.setbd.control.storage.Prefs

/**
 * Central permission checks + intents for the onboarding/permissions screens.
 * Every check mirrors exactly what the feature needs; every trigger opens the
 * REAL system screen or fires the REAL runtime dialog (no dead buttons).
 */
object PermissionManager {

    private fun granted(ctx: Context, perm: String): Boolean =
        ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED

    // ---------- checks ----------

    fun usageAccessGranted(ctx: Context): Boolean {
        val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ops.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(), ctx.packageName
            )
        } else {
            @Suppress("DEPRECATION")
            ops.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(), ctx.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    fun locationGranted(ctx: Context): Boolean =
        granted(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ||
            granted(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)

    fun backgroundLocationGranted(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
        return granted(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    }

    fun postNotificationsGranted(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return granted(ctx, Manifest.permission.POST_NOTIFICATIONS)
    }

    fun notificationListenerGranted(ctx: Context): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(ctx)
            .contains(ctx.packageName)

    fun overlayGranted(ctx: Context): Boolean = Settings.canDrawOverlays(ctx)

    fun batteryOptimizationIgnored(ctx: Context): Boolean {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    fun adminActive(ctx: Context): Boolean = DevicePolicy.isAdmin(ctx)

    fun accessibilityEnabled(ctx: Context): Boolean = BlockAccessibilityService.isEnabled(ctx)

    fun micGranted(ctx: Context): Boolean = granted(ctx, Manifest.permission.RECORD_AUDIO)

    fun cameraGranted(ctx: Context): Boolean = granted(ctx, Manifest.permission.CAMERA)

    fun contactsGranted(ctx: Context): Boolean = granted(ctx, Manifest.permission.READ_CONTACTS)

    fun phoneGranted(ctx: Context): Boolean =
        granted(ctx, Manifest.permission.READ_PHONE_STATE) &&
            granted(ctx, Manifest.permission.READ_CALL_LOG)

    fun smsGranted(ctx: Context): Boolean = granted(ctx, Manifest.permission.READ_SMS)

    fun commsGranted(ctx: Context): Boolean =
        contactsGranted(ctx) && phoneGranted(ctx) && smsGranted(ctx)

    fun storageGranted(ctx: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= 33) {
            granted(ctx, Manifest.permission.READ_MEDIA_IMAGES) &&
                granted(ctx, Manifest.permission.READ_MEDIA_VIDEO)
        } else {
            granted(ctx, Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }

    fun installUnknownAppsGranted(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        return try {
            ctx.packageManager.canRequestPackageInstalls()
        } catch (e: Exception) {
            false
        }
    }

    fun iconHidden(ctx: Context): Boolean = Prefs.iconHidden

    // ---------- intents (real system screens / real dialogs) ----------

    fun openUsageAccessSettings(ctx: Context) {
        startActivity(ctx, Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
    }

    fun openNotificationListenerSettings(ctx: Context) {
        startActivity(ctx, Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    fun openAccessibilitySettings(ctx: Context) {
        startActivity(ctx, Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    fun openOverlaySettings(ctx: Context) {
        val i = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${ctx.packageName}")
        )
        startActivity(ctx, i)
    }

    fun requestIgnoreBatteryOptimization(ctx: Context) {
        try {
            val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${ctx.packageName}")
            }
            startActivity(ctx, i)
        } catch (e: Exception) {
            startActivity(ctx, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    fun openInstallUnknownAppsSettings(ctx: Context) {
        val i = try {
            Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${ctx.packageName}")
            )
        } catch (e: Exception) {
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:${ctx.packageName}")
            )
        }
        startActivity(ctx, i)
    }

    fun openLocationPermissionSettings(ctx: Context) {
        startActivity(
            ctx,
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:${ctx.packageName}")
            )
        )
    }

    fun requestAdmin(activity: android.app.Activity, requestCode: Int) {
        DevicePolicy.requestAdmin(activity, requestCode)
    }

    // ---------- report (parent can request this over WS) ----------

    fun report(ctx: Context): org.json.JSONObject {
        val o = org.json.JSONObject()
        o.put("usageAccess", usageAccessGranted(ctx))
        o.put("location", locationGranted(ctx))
        o.put("backgroundLocation", backgroundLocationGranted(ctx))
        o.put("postNotifications", postNotificationsGranted(ctx))
        o.put("notificationListener", notificationListenerGranted(ctx))
        o.put("overlay", overlayGranted(ctx))
        o.put("batteryOptimizationIgnored", batteryOptimizationIgnored(ctx))
        o.put("deviceAdmin", adminActive(ctx))
        o.put("accessibility", accessibilityEnabled(ctx))
        o.put("microphone", micGranted(ctx))
        o.put("camera", cameraGranted(ctx))
        o.put("contacts", contactsGranted(ctx))
        o.put("phone", phoneGranted(ctx))
        o.put("sms", smsGranted(ctx))
        o.put("storage", storageGranted(ctx))
        o.put("installUnknownApps", installUnknownAppsGranted(ctx))
        o.put("iconHidden", iconHidden(ctx))
        return o
    }

    private fun startActivity(ctx: Context, intent: Intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(intent)
        } catch (e: Exception) {
            // Some OEMs remove these settings screens — fail visibly but not fatally.
            android.widget.Toast.makeText(
                ctx, "Settings screen unavailable on this device", android.widget.Toast.LENGTH_SHORT
            ).show()
        }
    }
}
