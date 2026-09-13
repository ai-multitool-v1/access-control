package org.setbd.control.monitoring

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import org.json.JSONArray
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

    /**
     * Full hardware / sensor / configuration report: SOC, RAM, storage, screen,
     * battery health, every sensor, cameras, SIM/operator, security patch.
     * Read-only facts — no identifiers beyond what Build already exposes.
     */
    fun hardwareJson(ctx: Context): JSONObject {
        val o = JSONObject()

        // ---- build / board ----
        o.put("manufacturer", Build.MANUFACTURER ?: "")
        o.put("brand", Build.BRAND ?: "")
        o.put("model", Build.MODEL ?: "")
        o.put("device", Build.DEVICE ?: "")
        o.put("product", Build.PRODUCT ?: "")
        o.put("board", Build.BOARD ?: "")
        o.put("hardware", Build.HARDWARE ?: "")
        o.put("androidVersion", Build.VERSION.RELEASE ?: "")
        o.put("sdkInt", Build.VERSION.SDK_INT)
        o.put("buildId", Build.ID ?: "")
        o.put("fingerprint", Build.FINGERPRINT ?: "")
        o.put("bootloader", Build.BOOTLOADER ?: "")
        o.put("radioVersion", Build.getRadioVersion() ?: "")
        o.put("kernelVersion", System.getProperty("os.version") ?: "")
        if (Build.VERSION.SDK_INT >= 23) o.put("securityPatch", Build.VERSION.SECURITY_PATCH ?: "")
        o.put("supportedAbis", JSONArray(Build.SUPPORTED_ABIS?.toList() ?: emptyList()))
        o.put("appVersion", BuildConfig.VERSION_NAME)

        // ---- memory ----
        try {
            val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val mem = ActivityManager.MemoryInfo()
            am.getMemoryInfo(mem)
            o.put("ramTotalGb", round1(mem.totalMem.toDouble() / 1_073_741_824))
            o.put("ramAvailableGb", round1(mem.availMem.toDouble() / 1_073_741_824))
            o.put("lowRamDevice", mem.lowRamDevice)
        } catch (e: Exception) { }

        // ---- storage ----
        try {
            val stat = StatFs(Environment.getDataDirectory().path)
            val block = stat.blockSizeLong
            o.put("storageTotalGb", round1(stat.totalBytes.toDouble() / 1_073_741_824))
            o.put("storageFreeGb", round1(stat.availableBytes.toDouble() / 1_073_741_824))
        } catch (e: Exception) { }

        // ---- screen ----
        try {
            val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager
            val metrics = wm.defaultDisplay.let { d ->
                val m = android.util.DisplayMetrics()
                @Suppress("DEPRECATION") d.getRealMetrics(m)
                m
            }
            o.put("screen", JSONObject()
                .put("widthPx", metrics.widthPixels)
                .put("heightPx", metrics.heightPixels)
                .put("densityDpi", metrics.densityDpi)
                .put("xdpi", round1(metrics.xdpi.toDouble()))
                .put("ydpi", round1(metrics.ydpi.toDouble()))
                .put("refreshHz", wm.defaultDisplay.refreshRate.toDouble())
            )
        } catch (e: Exception) { }

        // ---- battery health ----
        try {
            val intent = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            if (intent != null) {
                val tech = intent.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY)
                o.put("battery", JSONObject()
                    .put("level", batteryLevel(ctx))
                    .put("charging", charging(ctx))
                    .put("technology", tech ?: JSONObject.NULL)
                    .put("health", healthLabel(intent.getIntExtra(BatteryManager.EXTRA_HEALTH, 0)))
                    .put("temperatureC", round1(intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0))
                    .put("voltageMv", intent.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0))
                )
            }
        } catch (e: Exception) { }

        // ---- sensors (full inventory) ----
        try {
            val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
            val sensors = JSONArray()
            for (s in sm.getSensorList(Sensor.TYPE_ALL)) {
                sensors.put(JSONObject()
                    .put("name", s.name)
                    .put("vendor", s.vendor)
                    .put("type", s.stringType)
                    .put("powerMa", round1(s.power.toDouble()))
                    .put("maxRange", round1(s.maximumRange.toDouble()))
                    .put("resolution", round1(s.resolution.toDouble()))
                )
            }
            o.put("sensors", sensors)
            o.put("sensorCount", sensors.length())
        } catch (e: Exception) { }

        // ---- cameras ----
        try {
            val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val cams = JSONArray()
            for (id in cm.cameraIdList) {
                val ch = cm.getCameraCharacteristics(id)
                val facing = when (ch.get(CameraCharacteristics.LENS_FACING)) {
                    CameraCharacteristics.LENS_FACING_FRONT -> "front"
                    CameraCharacteristics.LENS_FACING_BACK -> "back"
                    CameraCharacteristics.LENS_FACING_EXTERNAL -> "external"
                    else -> "unknown"
                }
                val sizes = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                    ?.getOutputSizes(android.graphics.ImageFormat.JPEG)
                    ?.maxByOrNull { it.width * it.height }
                cams.put(JSONObject()
                    .put("id", id)
                    .put("facing", facing)
                    .put("maxJpeg", sizes?.let { "${it.width}x${it.height}" } ?: JSONObject.NULL)
                    .put("flash", ch.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true)
                )
            }
            o.put("cameras", cams)
        } catch (e: Exception) { }

        // ---- telephony / network ----
        try {
            val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as android.telephony.TelephonyManager
            o.put("telephony", JSONObject()
                .put("operator", safe { tm.networkOperatorName } ?: JSONObject.NULL)
                .put("country", safe { tm.networkCountryIso } ?: JSONObject.NULL)
                .put("simState", simStateLabel(safe { tm.simState } ?: -1))
                .put("phoneType", safe { tm.phoneType } ?: JSONObject.NULL)
            )
        } catch (e: Exception) { }
        o.put("network", network(ctx))

        // ---- features snapshot ----
        val pm2 = ctx.packageManager
        o.put("features", JSONObject()
            .put("telephony", pm2.hasSystemFeature(pm2.FEATURE_TELEPHONY))
            .put("wifi", pm2.hasSystemFeature(pm2.FEATURE_WIFI))
            .put("bluetooth", pm2.hasSystemFeature(pm2.FEATURE_BLUETOOTH))
            .put("nfc", pm2.hasSystemFeature(pm2.FEATURE_NFC))
            .put("fingerprint", pm2.hasSystemFeature(pm2.FEATURE_FINGERPRINT))
            .put("usbHost", pm2.hasSystemFeature(pm2.FEATURE_USB_HOST))
        )
        o.put("generatedAt", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).apply {
            timeZone = java.util.TimeZone.getTimeZone("UTC")
        }.format(java.util.Date()))
        return o
    }

    private fun <T> safe(block: () -> T): T? = try { block() } catch (e: Exception) { null }

    private fun round1(v: Double): Double = Math.round(v * 10.0) / 10.0

    private fun healthLabel(h: Int): String = when (h) {
        BatteryManager.BATTERY_HEALTH_GOOD -> "good"
        BatteryManager.BATTERY_HEALTH_OVERHEAT -> "overheat"
        BatteryManager.BATTERY_HEALTH_DEAD -> "dead"
        BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "over_voltage"
        BatteryManager.BATTERY_HEALTH_COLD -> "cold"
        BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "failure"
        else -> "unknown"
    }

    private fun simStateLabel(s: Int): String = when (s) {
        android.telephony.TelephonyManager.SIM_STATE_READY -> "ready"
        android.telephony.TelephonyManager.SIM_STATE_ABSENT -> "absent"
        android.telephony.TelephonyManager.SIM_STATE_PIN_REQUIRED -> "pin_required"
        android.telephony.TelephonyManager.SIM_STATE_NETWORK_LOCKED -> "network_locked"
        else -> "unknown"
    }
}
