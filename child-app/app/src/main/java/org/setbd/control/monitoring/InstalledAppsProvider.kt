package org.setbd.control.monitoring

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Installed app list (Usage Access + QUERY_ALL_PACKAGES permission).
 * buildInventory() adds small icons, usage minutes and install/update times
 * for the parent dashboard's Apps view.
 */
object InstalledAppsProvider {

    private const val MAX_APPS = 200
    private const val ICON_PX = 48

    data class AppInfo(
        val packageName: String,
        val label: String,
        val versionName: String?,
        val installedAt: Long,
        val lastUpdatedAt: Long,
        val system: Boolean
    )

    fun list(ctx: Context, includeSystem: Boolean = false): List<AppInfo> {
        val pm = ctx.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 33) {
            PackageManager.PackageInfoFlags.of(0L)
        } else null
        val packages = if (flags != null) {
            pm.getInstalledPackages(flags)
        } else {
            @Suppress("DEPRECATION")
            pm.getInstalledPackages(0)
        }
        return packages.mapNotNull { info ->
            val app = info.applicationInfo ?: return@mapNotNull null
            val system = (app.flags and ApplicationInfo.FLAG_SYSTEM) != 0
            if (system && !includeSystem) return@mapNotNull null
            AppInfo(
                packageName = info.packageName,
                label = try { pm.getApplicationLabel(app).toString() } catch (e: Exception) { info.packageName },
                versionName = info.versionName,
                installedAt = info.firstInstallTime,
                lastUpdatedAt = info.lastUpdateTime,
                system = system
            )
        }.sortedBy { it.label.lowercase() }
    }

    fun reportJson(ctx: Context, includeSystem: Boolean): JSONObject {
        val arr = JSONArray()
        for (a in list(ctx, includeSystem).take(300)) {
            arr.put(
                JSONObject()
                    .put("packageName", a.packageName)
                    .put("label", a.label)
                    .put("versionName", a.versionName ?: JSONObject.NULL)
                    .put("installedAt", a.installedAt)
                    .put("system", a.system)
            )
        }
        return JSONObject().put("apps", arr)
    }

    /**
     * Full inventory for the dashboard Apps view: icon data-URIs, today's usage
     * minutes, install/update times. Icons are 48px PNGs (~2-4 KB each).
     */
    fun buildInventoryJson(ctx: Context, includeSystem: Boolean = false): JSONObject {
        val pm = ctx.packageManager
        val usage = UsageStatsProvider.minutesPerPackageToday(ctx)
        val arr = JSONArray()
        for (a in list(ctx, includeSystem).take(MAX_APPS)) {
            val app = JSONObject()
                .put("packageName", a.packageName)
                .put("label", a.label)
                .put("versionName", a.versionName ?: JSONObject.NULL)
                .put("installedAt", a.installedAt)
                .put("lastUpdatedAt", a.lastUpdatedAt)
                .put("system", a.system)
                .put("usageMinutes", usage[a.packageName] ?: 0)
            val iconB64 = iconBase64(pm, a.packageName)
            if (iconB64 != null) app.put("icon", iconB64)
            arr.put(app)
        }
        return JSONObject().put("apps", arr)
    }

    private fun iconBase64(pm: PackageManager, pkg: String): String? = try {
        val drawable: Drawable = pm.getApplicationIcon(pkg)
        val w = ICON_PX
        val bitmap = Bitmap.createBitmap(w, w, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, w, w)
        drawable.draw(canvas)
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 80, out)
        bitmap.recycle()
        Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    } catch (e: Exception) {
        null
    }
}
