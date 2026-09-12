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
import org.setbd.control.devicemanagement.DevicePolicy
import org.setbd.control.storage.Prefs
import org.setbd.control.BuildConfig

/** Central permission checks + intents for the onboarding/permissions screens. */
object PermissionManager {

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
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    fun postNotificationsGranted(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    fun notificationListenerGranted(ctx: Context): Boolean =
        android.app.NotificationManagerCompat.getEnabledListenerPackages(ctx)
            .contains(ctx.packageName)

    fun overlayGranted(ctx: Context): Boolean = Settings.canDrawOverlays(ctx)

    fun batteryOptimizationIgnored(ctx: Context): Boolean {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    fun adminActive(ctx: Context): Boolean = DevicePolicy.isAdmin(ctx)

    fun iconHidden(ctx: Context): Boolean = Prefs.iconHidden

    // ---------- intents ----------

    fun openUsageAccessSettings(ctx: Context) {
        startActivity(ctx, Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
    }

    fun openNotificationListenerSettings(ctx: Context) {
        startActivity(ctx, Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
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
        o.put("postNotifications", postNotificationsGranted(ctx))
        o.put("notificationListener", notificationListenerGranted(ctx))
        o.put("overlay", overlayGranted(ctx))
        o.put("batteryOptimizationIgnored", batteryOptimizationIgnored(ctx))
        o.put("deviceAdmin", adminActive(ctx))
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
