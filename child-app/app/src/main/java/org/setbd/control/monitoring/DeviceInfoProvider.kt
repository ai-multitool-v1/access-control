package org.setbd.control.monitoring

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import org.json.JSONObject
import org.setbd.control.BuildConfig

/** Device facts for the parent dashboard: model, battery, network, uptime. */
object DeviceInfoProvider {

    fun batteryLevel(ctx: Context): Int {
        val intent = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        if (level < 0) return -1
        return Math.round(level * 100f / scale)
    }

    fun charging(ctx: Context): Boolean {
        val intent = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val plugged =
            intent?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        return status == BatteryManager.BATTERY_STATUS_CHARGING ||
            plugged == BatteryManager.BATTERY_PLUGGED_AC ||
            plugged == BatteryManager.BATTERY_PLUGGED_USB ||
            plugged == BatteryManager.BATTERY_PLUGGED_WIRELESS
    }

    fun network(ctx: Context): String {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "offline"
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile_data"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "connected"
        }
    }

    fun statusJson(ctx: Context): JSONObject {
        val o = JSONObject()
        o.put("model", Build.MODEL ?: "")
        o.put("brand", Build.BRAND ?: "")
        o.put("manufacturer", Build.MANUFACTURER ?: "")
        o.put("androidVersion", Build.VERSION.RELEASE ?: "")
        o.put("sdkInt", Build.VERSION.SDK_INT)
        o.put("appVersion", BuildConfig.VERSION_NAME)
        o.put("batteryLevel", batteryLevel(ctx))
        o.put("charging", charging(ctx))
        o.put("network", network(ctx))
        o.put("screenTimeMinutes", UsageStatsProvider.totalMinutesToday(ctx))
        o.put(
            "deviceAdminActive",
            org.setbd.control.devicemanagement.DevicePolicy.isAdmin(ctx)
        )
        o.put(
            "usageAccessGranted",
            org.setbd.control.permissions.PermissionManager.usageAccessGranted(ctx)
        )
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        o.put("interactive", pm.isInteractive)
        return o
    }
}
