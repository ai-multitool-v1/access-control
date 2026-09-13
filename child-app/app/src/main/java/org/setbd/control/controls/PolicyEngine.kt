package org.setbd.control.controls

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.setbd.control.monitoring.UsageStatsProvider
import org.setbd.control.storage.Prefs

/**
 * PolicyEngine — holds the policy set pushed from the parent dashboard.
 * Types: daily_limit {minutes}, app_limit {packageName, minutes},
 *        schedule {name,start,end,days,allowApps}, location_monitor {enabled}
 * The child re-validates every policy locally; nothing is executed remotely.
 */
object PolicyEngine {

    data class Policy(val id: String, val type: String, val label: String?, val payload: JSONObject, val enabled: Boolean)

    private val policies = mutableListOf<Policy>()

    // package -> { label, overlayText } — parent-toggled app restrictions.
    private val restrictedApps = LinkedHashMap<String, JSONObject>()

    @Synchronized
    fun replace(list: List<Policy>, ctx: Context?) {
        policies.clear()
        policies.addAll(list)
        ctx?.let { c ->
            Prefs.cachedPoliciesJson = JSONArray().apply {
                for (p in policies) {
                    put(
                        JSONObject()
                            .put("id", p.id)
                            .put("type", p.type)
                            .put("label", p.label ?: JSONObject.NULL)
                            .put("payload", p.payload)
                            .put("enabled", p.enabled)
                    )
                }
            }.toString()
        }
    }

    @Synchronized
    fun restore(ctx: Context) {
        val raw = Prefs.cachedPoliciesJson ?: return
        try {
            val arr = JSONArray(raw)
            val list = ArrayList<Policy>(arr.length())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                list.add(
                    Policy(
                        o.optString("id"), o.optString("type"), o.optString("label", null),
                        o.optJSONObject("payload") ?: JSONObject(), o.optBoolean("enabled", true)
                    )
                )
            }
            replace(list, null)
        } catch (e: Exception) {
            // corrupted cache — start clean
            policies.clear()
        }
        restoreRestrictions(ctx)
    }

    /** Parent-toggled app restrictions (package -> custom overlay text). */
    @Synchronized
    fun replaceRestrictions(list: List<JSONObject>, ctx: Context?) {
        restrictedApps.clear()
        for (o in list) {
            val pkg = o.optString("package_name").trim()
            if (pkg.isEmpty()) continue
            restrictedApps[pkg] = o
        }
        ctx?.let { c -> Prefs.cachedRestrictionsJson = JSONArray(list).toString() }
    }

    @Synchronized
    private fun restoreRestrictions(ctx: Context) {
        val raw = Prefs.cachedRestrictionsJson ?: return
        try {
            val arr = JSONArray(raw)
            val list = ArrayList<JSONObject>(arr.length())
            for (i in 0 until arr.length()) list.add(arr.getJSONObject(i))
            replaceRestrictions(list, null)
        } catch (e: Exception) {
            restrictedApps.clear()
        }
    }

    @Synchronized
    fun isRestricted(pkg: String): Boolean = restrictedApps.containsKey(pkg)

    /** Raw restriction record (label / overlay_text / overlay_image) for a package. */
    @Synchronized
    fun restrictionFor(pkg: String): JSONObject? = restrictedApps[pkg]

    @Synchronized
    fun restrictionCount(): Int = restrictedApps.size

    @Synchronized
    fun all(): List<Policy> = policies.toList()

    @Synchronized
    fun locationMonitoringEnabled(): Boolean =
        policies.any { it.type == "location_monitor" && it.enabled && it.payload.optBoolean("enabled", true) } ||
            // The dashboard's "Location monitoring" toggle (device_settings.location_enabled)
            // arrives via /api/child/policies — it must enable uploads on its own.
            Prefs.locationEnabled

    private fun dailyLimitMinutes(): Int? =
        policies.firstOrNull { it.type == "daily_limit" && it.enabled }
            ?.payload?.optInt("minutes", -1)?.takeIf { it > 0 }

    private fun appLimitFor(pkg: String): Int? =
        policies.filter { it.type == "app_limit" && it.enabled }
            .firstOrNull { it.payload.optString("packageName") == pkg }
            ?.payload?.optInt("minutes", -1)?.takeIf { it > 0 }

    private fun activeSchedule(): Policy? {
        val cal = java.util.Calendar.getInstance()
        val day = cal.get(java.util.Calendar.DAY_OF_WEEK) // 1=Sunday
        val minutesNow = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
        for (p in policies) {
            if (p.type != "schedule" || !p.enabled) continue
            val payload = p.payload
            val days = payload.optJSONArray("days") ?: continue
            var dayMatches = false
            for (i in 0 until days.length()) {
                val d = days.optInt(i, -1)
                val mapped = if (d == 7) 1 else d + 1 // 0=Sun..6=Sat (JS) → Calendar 1=Sun..7=Sat
                if (mapped == day) dayMatches = true
            }
            if (!dayMatches) continue
            val start = parseHm(payload.optString("start", "00:00"))
            val end = parseHm(payload.optString("end", "23:59"))
            val inWindow = if (start <= end) minutesNow in start..end else minutesNow >= start || minutesNow <= end
            if (inWindow) return p
        }
        return null
    }

    /**
     * Should this app be blocked right now?
     * - daily limit reached → block everything except this app + launchers
     * - per-app limit reached → block that app
     * - active schedule → block everything in the allowApps model (empty allowApps = all blocked)
     */
    fun shouldBlock(ctx: Context, foregroundPkg: String?): Boolean {
        if (foregroundPkg == null || foregroundPkg == ctx.packageName) return false

        // Parent restriction toggle — always blocks, custom overlay text.
        if (isRestricted(foregroundPkg)) return true

        val schedule = activeSchedule()
        if (schedule != null) {
            val allow = schedule.payload.optJSONArray("allowApps") ?: JSONArray()
            for (i in 0 until allow.length()) if (allow.optString(i) == foregroundPkg) return false
            return true
        }

        dailyLimitMinutes()?.let { limit ->
            if (UsageStatsProvider.totalMinutesToday(ctx) >= limit) return true
        }

        appLimitFor(foregroundPkg)?.let { limit ->
            if (UsageStatsProvider.minutesForPackage(ctx, foregroundPkg) >= limit) return true
        }

        return false
    }

    fun blockReason(ctx: Context, pkg: String?): String {
        if (pkg == null) return ""
        val restriction = synchronized(this) { restrictedApps[pkg] }
        if (restriction != null) {
            return restriction.optString("overlay_text").ifBlank { "This app is blocked by your parent." }
        }
        val schedule = activeSchedule()
        if (schedule != null) return "Schedule: ${schedule.label ?: "active"}"
        dailyLimitMinutes()?.let { limit ->
            if (UsageStatsProvider.totalMinutesToday(ctx) >= limit) return "Daily screen time reached"
        }
        appLimitFor(pkg)?.let { return "App limit reached" }
        return ""
    }

    fun summary(): String {
        val parts = ArrayList<String>()
        dailyLimitMinutes()?.let { parts.add("${it}m/day") }
        val appLimits = policies.count { it.type == "app_limit" && it.enabled }
        if (appLimits > 0) parts.add("$appLimits app limits")
        if (activeSchedule() != null) parts.add("schedule active")
        return if (parts.isEmpty()) "No active limits" else parts.joinToString(" · ")
    }

    private fun parseHm(s: String): Int {
        val p = s.split(":")
        val h = p.getOrNull(0)?.toIntOrNull() ?: 0
        val m = p.getOrNull(1)?.toIntOrNull() ?: 0
        return h * 60 + m
    }
}
