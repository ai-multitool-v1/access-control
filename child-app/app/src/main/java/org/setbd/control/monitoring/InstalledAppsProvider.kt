package org.setbd.control.monitoring

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/** Installed app list (Usage Access + QUERY_ALL_PACKAGES permission). */
object InstalledAppsProvider {

    data class AppInfo(
        val packageName: String,
        val label: String,
        val versionName: String?,
        val installedAt: Long,
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
}
