package org.setbd.control.monitoring

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.concurrent.TimeUnit

/** Screen-time + per-app usage via Usage Access (PACKAGE_USAGE_STATS). */
object UsageStatsProvider {

    data class AppUsage(val packageName: String, val label: String?, val minutes: Long)

    fun queryToday(ctx: Context, excludeLauncher: Boolean = true): List<AppUsage> {
        if (!org.setbd.control.permissions.PermissionManager.usageAccessGranted(ctx)) return emptyList()

        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val start = cal.timeInMillis
        val now = System.currentTimeMillis()
        if (now <= start) return emptyList()

        val launcherPkgs = if (excludeLauncher) launcherPackages(ctx) else emptySet()
        val totals = HashMap<String, Long>()
        for (stats in usm.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY, start, now
        )) {
            val pkg = stats.packageName ?: continue
            if (pkg == ctx.packageName || pkg in launcherPkgs) continue
            val ms = stats.totalTimeInForeground ?: 0
            if (ms <= 0) continue
            totals[pkg] = (totals[pkg] ?: 0L) + ms
        }
        val pm = ctx.packageManager
        return totals.entries
            .sortedByDescending { it.value }
            .map { (pkg, ms) ->
                AppUsage(pkg, appLabel(pm, pkg), TimeUnit.MILLISECONDS.toMinutes(ms))
            }
            .filter { it.minutes > 0 }
    }

    fun totalMinutesToday(ctx: Context): Long =
        queryToday(ctx).sumOf { it.minutes }

    fun minutesForPackage(ctx: Context, packageName: String): Long =
        queryToday(ctx).firstOrNull { it.packageName == packageName }?.minutes ?: 0L

    /** Most recently resumed foreground app (last 20 seconds of usage events). */
    fun currentForeground(ctx: Context): String? {
        if (!org.setbd.control.permissions.PermissionManager.usageAccessGranted(ctx)) return null
        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val now = System.currentTimeMillis()
        val events = usm.queryEvents(now - TimeUnit.SECONDS.toMillis(20), now)
        val e = UsageEvents.Event()
        var last: String? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            if (e.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
                if (e.packageName != ctx.packageName) last = e.packageName
            }
        }
        return last
    }

    fun reportJson(ctx: Context, date: String): JSONObject {
        val apps = queryToday(ctx)
        val arr = JSONArray()
        for (a in apps.take(150)) {
            arr.put(
                JSONObject()
                    .put("packageName", a.packageName)
                    .put("label", a.label ?: JSONObject.NULL)
                    .put("minutes", a.minutes)
            )
        }
        return JSONObject()
            .put("date", date)
            .put("totalMinutes", apps.sumOf { it.minutes })
            .put("apps", arr)
    }

    private fun launcherPackages(ctx: Context): Set<String> {
        val intent = android.content.Intent(android.content.Intent.ACTION_MAIN).apply {
            addCategory(android.content.Intent.CATEGORY_HOME)
        }
        return ctx.packageManager.queryIntentActivities(intent, 0)
            .mapNotNull { it.activityInfo?.packageName }
            .toSet()
    }

    fun appLabel(pm: android.content.pm.PackageManager, pkg: String): String? = try {
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) {
        null
    }
}
