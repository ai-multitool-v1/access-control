package org.setbd.control.monitoring

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import org.setbd.control.permissions.PermissionManager
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * App / browser history for the parent dashboard, built from UsageStats
 * activity events (the same source Android's own Digital Wellbeing uses).
 *
 * Browser URL history: modern Chrome / Samsung Internet no longer expose a
 * public history provider, so where a provider exists it is read best-effort
 * and the result is otherwise an app-level timeline of browser sessions.
 * Nothing is invented — the payload reports which mode produced the rows.
 */
object UsageTimelineProvider {

    // Well-known browser packages + anything that registers a http(s) viewer.
    private val KNOWN_BROWSERS = setOf(
        "com.android.chrome", "com.chrome.beta", "com.chrome.dev",
        "org.mozilla.firefox", "org.mozilla.focus",
        "com.sec.android.app.sbrowser", "com.sec.android.app.sbrowser.beta",
        "com.opera.browser", "com.opera.mini.native", "com.opera.browser.beta",
        "com.brave.browser", "com.microsoft.emmx", "com.UCMobile",
        "com.duckduckgo.mobile.android", "com.vivaldi.browser",
        "com.android.browser", "com.heytap.browser", "com.mi.globalbrowser",
        "com.samsung.android.internet",
    )

    fun browserPackages(ctx: Context): Set<String> {
        val set = HashSet(KNOWN_BROWSERS)
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("http://www.example.com"))
            ctx.packageManager.queryIntentActivities(intent, 0).forEach {
                it.activityInfo?.packageName?.let { p -> set.add(p) }
            }
        } catch (_: Exception) {
        }
        return set
    }

    /**
     * App-open timeline for the last N days: [{packageName, label, ts, browser}].
     * Capped at 1500 newest events. Excludes our own package + launchers.
     */
    fun timeline(ctx: Context, days: Int): JSONObject {
        if (!PermissionManager.usageAccessGranted(ctx)) {
            return JSONObject()
                .put("mode", "usage")
                .put("permissionMissing", true)
                .put("items", JSONArray())
        }
        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val end = System.currentTimeMillis()
        val start = end - TimeUnit.DAYS.toMillis(days.coerceIn(1, 14).toLong())

        val launchers = launcherPackages(ctx)
        val browsers = browserPackages(ctx)
        val pm = ctx.packageManager

        val events = usm.queryEvents(start, end)
        val e = UsageEvents.Event()
        val out = JSONArray()
        try {
            while (events.hasNextEvent() && out.length() < 1500) {
                events.getNextEvent(e)
                if (e.eventType != UsageEvents.Event.ACTIVITY_RESUMED) continue
                val pkg = e.packageName ?: continue
                if (pkg == ctx.packageName || pkg in launchers) continue
                out.put(
                    JSONObject()
                        .put("packageName", pkg.take(160))
                        .put("label", UsageStatsProvider.appLabel(pm, pkg)?.take(120) ?: JSONObject.NULL)
                        .put("ts", e.timeStamp)
                        .put("browser", pkg in browsers)
                )
            }
        } catch (_: Exception) {
            // partial timeline is fine
        }
        return JSONObject()
            .put("mode", "usage")
            .put("days", days.coerceIn(1, 14))
            .put("items", out)
    }

    /**
     * Browser history: try the legacy AOSP browser provider first (rarely
     * present), then fall back to browser-session events from the timeline.
     * URL rows are {url, title, ts}; session rows are {packageName, label, ts}.
     */
    fun browserHistory(ctx: Context, days: Int): JSONObject {
        val providerRows = tryLegacyProviders(ctx)
        if (providerRows.length() > 0) {
            return JSONObject()
                .put("mode", "urls")
                .put("days", days.coerceIn(1, 14))
                .put("items", providerRows)
        }
        // Fallback: browser app sessions (honest app-level history).
        val since = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(days.coerceIn(1, 14).toLong())
        val timeline = timeline(ctx, days.coerceIn(1, 14))
        val items = JSONArray()
        val arr = timeline.optJSONArray("items") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (!o.optBoolean("browser")) continue
            if (o.optLong("ts", 0) < since) continue
            items.put(o)
        }
        return JSONObject()
            .put("mode", "usage")
            .put("days", days.coerceIn(1, 14))
            .put("note", "Browsers no longer expose URL history — showing browser app sessions.")
            .put("items", items)
    }

    /** Legacy AOSP browser bookmarks/history provider (API < 30 devices). */
    private fun tryLegacyProviders(ctx: Context): JSONArray {
        val out = JSONArray()
        val uris = listOf(
            Uri.parse("content://com.android.browser/bookmarks"),
            Uri.parse("content://browser/bookmarks"),
        )
        for (uri in uris) {
            try {
                ctx.contentResolver.query(
                    uri,
                    arrayOf("url", "title", "date"),
                    "bookmarks=1",
                    null,
                    "date DESC"
                )?.use { c ->
                    val uC = c.getColumnIndex("url")
                    val tC = c.getColumnIndex("title")
                    val dC = c.getColumnIndex("date")
                    while (c.moveToNext() && out.length() < 400) {
                        val url = if (uC >= 0) c.getString(uC) ?: continue else continue
                        out.put(
                            JSONObject()
                                .put("url", url.take(300))
                                .put("title", (if (tC >= 0) c.getString(tC) else null)?.take(200) ?: JSONObject.NULL)
                                .put("ts", if (dC >= 0) c.getLong(dC) else 0L)
                        )
                    }
                }
                if (out.length() > 0) break
            } catch (_: Exception) {
                // provider not readable — try the next one
            }
        }
        return out
    }

    private fun launcherPackages(ctx: Context): Set<String> = try {
        val intent = Intent(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_HOME) }
        ctx.packageManager.queryIntentActivities(intent, 0)
            .mapNotNull { it.activityInfo?.packageName }
            .toSet()
    } catch (_: Exception) {
        emptySet()
    }
}
