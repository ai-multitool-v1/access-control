package org.setbd.control.monitoring

import android.content.Context
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import org.setbd.control.controls.BlockActivity
import org.setbd.control.storage.Prefs
import org.setbd.control.storage.SecureStore
import org.setbd.control.util.Http
import org.setbd.control.BuildConfig
import org.setbd.control.websocket.CommandProcessor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Browser history + search capture for the parent dashboard.
 *
 * Modern browsers (Chrome / Samsung Internet) no longer expose a URL history
 * provider, so the visible URL bar and search field text is captured through
 * the accessibility service while the child browses. Rows are queued locally
 * (capped), flagged against the parent's adult/NSFW configuration and flushed
 * to /api/browser/sync in batches. Nothing is invented: only text actually
 * visible in a browser URL/search field is recorded.
 */
object BrowserCapture {

    private const val MAX_QUEUE = 400
    private const val MIN_INTERVAL_MS = 1500L
    private const val DUPE_WINDOW_MS = 5 * 60 * 1000L
    private const val FLUSH_THRESHOLD = 12
    private const val MAX_TEXT = 300

    /** Apps whose window text we treat as URL/search candidates. */
    private val SEARCH_APPS = setOf(
        "com.google.android.googlequicksearchbox", // Google app / search widget
        "com.google.android.youtube",
        "com.google.android.apps.youtube.kids",
    )

    /** Adult / NSFW domain + keyword blocks (matched against the host). */
    private val NSFW_KEYWORDS = listOf(
        "porn", "xnxx", "xvideos", "xhamster", "redtube", "youporn",
        "pornhub", "stripchat", "chaturbate", "brazzers", "onlyfans",
        "adult", "sex", "xxx", "nude", "nudes", "escort", "bangla sex",
        "desi porn", "horny", "nsfw", "18plus", "18+"
    )

    private val URL_RE = Regex(
        "^(https?://)?([a-z0-9-]+\\.)+[a-z]{2,}(/\\S*)?$",
        RegexOption.IGNORE_CASE
    )
    private val IP_URL_RE = Regex(
        "^(https?://)?(\\d{1,3}\\.){3}\\d{1,3}(:\\d+)?(/\\S*)?$"
    )

    @Volatile private var lastAt = 0L
    @Volatile private var lastText = ""

    // ------------------------------------------------------------------
    // Accessibility entry point
    // ------------------------------------------------------------------

    fun onEvent(ctx: Context, event: AccessibilityEvent) {
        val pkg = event.packageName?.toString() ?: return
        val now = System.currentTimeMillis()
        if (now - lastAt < MIN_INTERVAL_MS) return
        val candidates = collectText(event)
        for (raw in candidates) {
            val text = raw.trim().take(MAX_TEXT)
            if (text.isEmpty() || text.length < 3) continue
            if (text.equals(lastText, ignoreCase = true)) continue
            val isSearchApp = pkg in SEARCH_APPS
            val looksUrl = URL_RE.matches(text) || IP_URL_RE.matches(text)
            if (!looksUrl && !isSearchApp) continue
            if (!looksUrl && isSearchApp && !isSearchQuery(text)) continue

            lastAt = now
            lastText = text

            val isSearch = !looksUrl || isSearchQuery(text)
            val host = if (isSearch) text else hostOf(text)
            val nsfw = isNsfw(host, Prefs.nsfwDomains)
            enqueue(
                JSONObject()
                    .put("kind", if (isSearch) "search" else "url")
                    .put("value", text)
                    .put("packageName", pkg.take(120))
                    .put("nsfw", nsfw)
                    .put("ts", now)
            )
            if (nsfw) {
                onNsfwDetected(ctx, pkg, text)
            }
            if (Prefs.browserQueueCount() >= FLUSH_THRESHOLD) {
                org.setbd.control.sync.SyncWorker.enqueueOneTime(ctx)
            }
            return
        }
    }

    /** Search queries usually read like short human text, not domains. */
    private fun isSearchQuery(text: String): Boolean {
        if (text.startsWith("http") || text.startsWith("www.")) return false
        if (text.contains(' ')) return true
        // single word with a known TLD is a URL; otherwise treat as search
        return !text.contains('.')
    }

    private fun hostOf(url: String): String = runCatching {
        val withScheme = if (url.startsWith("http")) url else "https://$url"
        java.net.URI(withScheme).host?.lowercase() ?: url.lowercase()
    }.getOrDefault(url.lowercase())

    /** Walk a couple of accessible nodes and return their text. */
    private fun collectText(event: AccessibilityEvent): List<String> {
        val out = ArrayList<String>(4)
        event.text?.forEach { t -> t?.toString()?.let { out.add(it) } }
        val source = runCatching { event.source }.getOrNull() ?: return out
        collectFromNode(source, out, 0)
        return out
    }

    private fun collectFromNode(node: AccessibilityNodeInfo, out: MutableList<String>, depth: Int) {
        if (depth > 3 || out.size >= 6) return
        node.text?.toString()?.let { if (it.isNotBlank()) out.add(it) }
        for (i in 0 until node.childCount) {
            val child = runCatching { node.getChild(i) }.getOrNull() ?: continue
            collectFromNode(child, out, depth + 1)
        }
    }

    // ------------------------------------------------------------------
    // NSFW matching (built-in list + parent's custom domains)
    // ------------------------------------------------------------------

    fun isNsfw(hostOrQuery: String, customDomains: String?): Boolean {
        val v = hostOrQuery.lowercase().trim(' ', '/', '.')
        if (NSFW_KEYWORDS.any { v.contains(it) }) return true
        val custom = customDomains?.split(',', '\n', ';')
            ?.map { it.trim().lowercase().removePrefix("https://").removePrefix("http://").removePrefix("www.").trim(' ', '/', '.') }
            ?.filter { it.isNotBlank() }
            ?: emptyList()
        return custom.any { c -> v.contains(c) }
    }

    private fun onNsfwDetected(ctx: Context, pkg: String, value: String) {
        // Parent alert through the GUI event feed (postEvent is suspend —
        // fire-and-forget from the accessibility callback via a scope).
        CoroutineScope(Dispatchers.IO).launch {
            CommandProcessor.postEvent(
                ctx, "nsfw_detected", "critical",
                "Adult / NSFW content detected",
                pkg,
                JSONObject().put("value", value.take(200))
            )
        }
        // Optional hard block: cover the browser with the block screen.
        if (Prefs.nsfwBlock) {
            val i = Intent(ctx, BlockActivity::class.java)
                .addFlags(
                    android.content.Intent.FLAG_ACTIVITY_NEW_TASK or
                        android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP
                )
                .putExtra("package", pkg)
                .putExtra("reason", "Adult content is blocked by your parent")
            runCatching { ctx.startActivity(i) }
        }
    }

    // ------------------------------------------------------------------
    // Queue (Prefs-backed) + flush
    // ------------------------------------------------------------------

    private fun enqueue(item: JSONObject) {
        val q = Prefs.browserQueueJson ?: "[]"
        val arr = try { JSONArray(q) } catch (e: Exception) { JSONArray() }
        // dedupe: same value within the dupe window
        val now = item.optLong("ts", 0L)
        for (i in arr.length() - 1 downTo 0) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("value") == item.optString("value") &&
                now - o.optLong("ts", 0L) < DUPE_WINDOW_MS
            ) return
        }
        arr.put(item)
        while (arr.length() > MAX_QUEUE) arr.remove(0)
        Prefs.browserQueueJson = arr.toString()
    }

    /** Flush the queued rows to the worker. Returns rows uploaded. */
    fun flush(ctx: Context): Int {
        if (!SecureStore.isPaired) return 0
        val raw = Prefs.browserQueueJson ?: return 0
        val arr = try { JSONArray(raw) } catch (e: Exception) { return 0 }
        if (arr.length() == 0) return 0
        return try {
            val body = JSONObject().put("items", arr)
            val res = Http.post("${BuildConfig.API_BASE}/api/browser/sync", SecureStore.deviceToken, body.toString())
            val stored = JSONObject(res).optInt("stored", 0)
            if (stored >= 0) Prefs.browserQueueJson = "[]"
            stored
        } catch (e: Exception) {
            0
        }
    }

    /**
     * Merge the freshly captured URLs / search terms (queued, maybe not yet
     * synced) into the provider response so the parent's live "Browser history"
     * request shows SEARCHED data immediately, not just browser app sessions.
     */
    fun mergeWithCaptured(ctx: Context, base: JSONObject): JSONObject {
        val raw = Prefs.browserQueueJson
        val queue = if (raw != null) try { JSONArray(raw) } catch (e: Exception) { null } else null
        if (queue == null || queue.length() == 0) return base

        val items = JSONArray()
        val since = System.currentTimeMillis() - 14L * 24 * 60 * 60 * 1000
        var captured = 0
        for (i in 0 until queue.length()) {
            val o = queue.optJSONObject(i) ?: continue
            if (o.optLong("ts", 0L) < since) continue
            items.put(
                JSONObject()
                    .put("kind", o.optString("kind", "url"))
                    .put("url", o.optString("value"))
                    .put("packageName", o.optString("packageName"))
                    .put("nsfw", o.optBoolean("nsfw", false))
                    .put("ts", o.optLong("ts", 0L))
            )
            captured++
        }
        // provider rows (legacy URLs / app sessions) ride along with a kind
        val arr = base.optJSONArray("items") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            o.put("kind", if (base.optString("mode") == "urls") "url" else "session")
            items.put(o)
        }
        return base
            .put("mode", "captured")
            .put("capturedCount", captured)
            .put("items", items)
    }
}
