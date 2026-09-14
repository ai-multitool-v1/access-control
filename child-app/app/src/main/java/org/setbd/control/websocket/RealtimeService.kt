package org.setbd.control.websocket

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.setbd.control.BuildConfig
import org.setbd.control.R
import org.setbd.control.controls.PolicyEngine
import org.setbd.control.controls.ZoneAlertActivity
import org.setbd.control.monitoring.DeviceInfoProvider
import org.setbd.control.notifications.NotificationHelper
import org.setbd.control.permissions.PermissionManager
import org.setbd.control.storage.Prefs
import org.setbd.control.storage.SecureStore
import org.setbd.control.util.Http
import org.setbd.control.util.UiNotifier
import org.setbd.control.webrtc.CaptureService
import org.setbd.control.webrtc.RtcBridge
import org.setbd.control.webrtc.WebRtcCore

/**
 * Foreground service owning the child WebSocket connection:
 * connect, heartbeat, exponential-backoff reconnect, command dispatch,
 * periodic status events, and policy pull on connect.
 */
class RealtimeService : Service(), WsClient.Listener {

    // CoroutineExceptionHandler: an uncaught exception inside ANY scope.launch
    // used to kill the whole process (SupervisorJob only isolates siblings, it
    // does NOT swallow errors) — one unexpected throw in a command handler or
    // the status loop crashed the app while mirroring. Now it is logged and
    // the service keeps running.
    private val crashGuard = kotlinx.coroutines.CoroutineExceptionHandler { _, e ->
        Log.w(TAG, "realtime coroutine error contained", e)
        runCatching {
            scope.launch {
                org.setbd.control.websocket.CommandProcessor.postEvent(
                    this@RealtimeService,
                    "app_crash",
                    "warning",
                    "Internal error contained: ${e.javaClass.simpleName}",
                    detail = org.json.JSONObject().put("stack", e.stackTraceToString().take(1500))
                )
            }
        }
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + crashGuard)
    private val handler = Handler(Looper.getMainLooper())
    private var ws: WsClient? = null
    private var backoffMs = 1_000L
    private var statusLoop = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        startForeground(
            NotificationHelper.REALTIME_NOTIFICATION_ID,
            NotificationHelper.realtimeNotification(this)
        )
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiping the app away on aggressive OEM skins kills foreground
        // services too — restart immediately while the process is still alive
        // (the swipe is exactly when the child device must NOT go offline),
        // then schedule a watchdog tick as the safety net.
        runCatching { org.setbd.control.util.ServiceLauncher.startAll(this) }
        org.setbd.control.boot.WatchdogReceiver.schedule(this, 2_500L)
        super.onTaskRemoved(rootIntent)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!SecureStore.isPaired) {
            stopSelf()
            return START_NOT_STICKY
        }
        ensureConnected()
        startStatusLoop()
        return START_STICKY
    }

    private fun ensureConnected() {
        if (ws?.isOpen == true) return
        val deviceId = SecureStore.deviceId ?: return
        val token = SecureStore.deviceToken ?: return
        if (ws == null) ws = WsClient(deviceId, token, this)
        ws!!.connect()
    }

    // ---- WsClient.Listener ----

    override fun onWsOpen() {
        backoffMs = 1_000L
        RealtimeState.setConnected(true)
        UiNotifier.notifyState(this, true)
        // Wire the outbound WebRTC signaling channel to this socket.
        val socket = ws
        RtcBridge.sender = { msg -> socket?.send(msg) ?: false }
        // Live-event bridge for other components (notification listener, ...).
        RealtimeBridge.sender = { event, payload ->
            val s = ws
            if (s != null && s.isOpen) {
                runCatching {
                    s.send(
                        JSONObject().put("type", "event").put("event", event).put("payload", payload)
                    )
                }
                true
            } else false
        }
        scope.launch {
            pullPolicies()
            pullChildConfig()
            pushHardwareIfStale()
            pushInventoryIfStale()
            pushMediaIfStale()
            registerFcmIfChanged()
            sendStatus()
        }
    }

    override fun onWsMessage(obj: JSONObject) {
        when (obj.optString("type")) {
            "command" -> scope.launch {
                val requestId = obj.optString("requestId")
                val action = obj.optString("action")
                val payload = obj.optJSONObject("payload") ?: JSONObject()
                // Belt-and-braces: CommandProcessor.handle already converts
                // Exception into a Failed result, but a Throwable/late crash
                // here must NEVER take the process down mid-mirror.
                val result: CommandProcessor.Result = try {
                    CommandProcessor.handle(this@RealtimeService, action, payload)
                } catch (e: Exception) {
                    Log.w(TAG, "command $action crashed", e)
                    CommandProcessor.Result.Failed("error", e.message ?: "Command failed")
                }
                when (result) {
                    is CommandProcessor.Result.Ok -> sendLargeResponse(
                        requestId,
                        success = true,
                        payload = result.payload
                    )
                    is CommandProcessor.Result.Failed -> {
                        val response = JSONObject().apply {
                            put("type", "response")
                            put("requestId", requestId)
                            put("success", false)
                            put("error", JSONObject().put("code", result.code).put("message", result.message))
                        }
                        ws?.send(response)
                    }
                }
            }
            "event" -> {
                val event = obj.optString("event")
                when (event) {
                    "policies_updated" -> scope.launch {
                        pullPolicies()
                        pullChildConfig()
                    }
                    "zone_alert" -> {
                        // SOS: the child left every active safe zone (server-evaluated).
                        val payload = obj.optJSONObject("payload") ?: JSONObject()
                        val intent = Intent(this@RealtimeService, ZoneAlertActivity::class.java).apply {
                            addFlags(
                                Intent.FLAG_ACTIVITY_NEW_TASK or
                                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                            )
                            putExtra("message", payload.optString("message"))
                            putExtra("zones", payload.optString("zones"))
                        }
                        runCatching { startActivity(intent) }
                    }
                }
            }
            "rtc" -> {
                // WebRTC signaling (answer/ice/stop) from the parent viewer.
                val payload = obj.optJSONObject("payload") ?: JSONObject()
                WebRtcCore.handleSignal(this@RealtimeService, payload)
            }
            "pong" -> ws?.onPong() // feed the pong-freshness watchdog in WsClient
        }
    }

    override fun onWsClosed(willRetry: Boolean) {
        RealtimeState.setConnected(false)
        UiNotifier.notifyState(this, false)
        // v1.9.1: ALWAYS schedule a reconnect — even for closes the client
        // classifies as non-retryable (clean 1000s from server deploys/DO
        // evictions previously bricked the link until the next reboot). The
        // revoked/unpair path is still safe: it clears SecureStore and stops
        // this service, so ensureConnected() becomes a no-op and the pending
        // callback dies with onDestroy()'s handler cleanup.
        handler.postDelayed({ ensureConnected() }, backoffMs)
        backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
    }

    override fun onWsRevoked() {
        // Parent pressed Revoke/Unpair on the dashboard: the socket was closed
        // with 4000 device_revoked. Wipe the pairing credentials, stop every
        // service and drop the child back on the pairing screen — the device
        // is now visibly UNPAIRED instead of lingering "offline".
        RealtimeState.setConnected(false)
        try {
            NotificationHelper.showAlert(
                this,
                getString(org.setbd.control.R.string.unpaired_title),
                getString(org.setbd.control.R.string.unpaired_body)
            )
        } catch (_: Exception) {
        }
        runCatching {
            // Stop the enforcement service too, then clear credentials.
            stopService(Intent(this, org.setbd.control.controls.PolicyEnforcerService::class.java))
            org.setbd.control.storage.SecureStore.clear()
            org.setbd.control.storage.Prefs.iconHidden = false
            org.setbd.control.ui.IconHider.apply(this, false)
        }
        runCatching {
            val i = Intent(this, org.setbd.control.pairing.PairingActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            startActivity(i)
        }
        stopSelf()
    }

    // ---- periodic status to parents (batched: one small event per minute) ----

    private fun startStatusLoop() {
        if (statusLoop) return
        statusLoop = true
        var ticks = 0
        scope.launch {
            while (true) {
                delay(60_000)
                ticks++
                if (ws?.isOpen == true) sendStatus()
                if (ticks % 10 == 0) maintenance()
            }
        }
    }

    /**
     * Every 10 minutes: re-assert the hidden launcher icon if a launcher
     * resurrected the alias. (The old "refresh the persistent notification"
     * step is gone — re-posting made the protection notification re-flash in
     * the tray every 10 minutes, which was extremely annoying. The service's
     * IMPORTANCE_MIN foreground notification never needs refreshing.)
     */
    private fun maintenance() {
        if (Prefs.iconHidden) {
            runCatching {
                if (!org.setbd.control.ui.IconHider.isHidden(this)) {
                    org.setbd.control.ui.IconHider.apply(this, true)
                }
            }
        }
    }

    private suspend fun sendStatus() {
        try {
            val payload = DeviceInfoProvider.statusJson(this)
            ws?.send(
                JSONObject()
                    .put("type", "event")
                    .put("event", "status")
                    .put("payload", payload)
            )
        } catch (e: Exception) {
            Log.w(TAG, "status send failed", e)
        }
    }

    /**
     * Pull + apply latest policies over REST after (re)connect.
     * Uses the device-authenticated /api/child/policies endpoint — the old
     * call hit the parent-only /api/devices/:id/policies route and got 401
     * forever, so policies, schedules, app limits and the location gate never
     * reached the device.
     */
    private suspend fun pullPolicies() {
        val token = SecureStore.deviceToken ?: return
        try {
            val text = Http.get("${BuildConfig.API_BASE}/api/child/policies", token)
            val obj = JSONObject(text)
            val arr = obj.optJSONArray("policies") ?: return
            CommandProcessor.applyPolicies(this, arr)
            // The dashboard's location toggle rides along in the same payload.
            val settings = obj.optJSONObject("settings")
            org.setbd.control.storage.Prefs.locationEnabled =
                settings?.optBoolean("locationEnabled", false) ?: false
            // Parent's adult/NSFW configuration rides along too.
            org.setbd.control.storage.Prefs.nsfwEnabled =
                settings?.optBoolean("nsfwEnabled", true) ?: true
            org.setbd.control.storage.Prefs.nsfwBlock =
                settings?.optBoolean("nsfwBlock", false) ?: false
            org.setbd.control.storage.Prefs.nsfwDomains =
                settings?.optString("nsfwDomains", "") ?: ""
            ws?.send(
                JSONObject()
                    .put("type", "event")
                    .put("event", "policy_applied")
                    .put("payload", JSONObject().put("count", arr.length()))
            )
        } catch (e: Exception) {
            Log.w(TAG, "policy pull failed", e)
        }
    }

    /** Pull parent-toggled app restrictions + geo zones (best effort, cached). */
    private suspend fun pullChildConfig() {
        val token = SecureStore.deviceToken ?: return
        try {
            val text = Http.get("${BuildConfig.API_BASE}/api/child/restrictions", token)
            val arr = JSONObject(text).optJSONArray("restrictions") ?: JSONArray()
            val list = ArrayList<JSONObject>(arr.length())
            for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { list.add(it) }
            PolicyEngine.replaceRestrictions(list, this)
        } catch (e: Exception) {
            Log.w(TAG, "restrictions pull failed", e)
        }
        try {
            val text = Http.get("${BuildConfig.API_BASE}/api/child/zones", token)
            val zones = JSONObject(text).optJSONArray("zones")
            org.setbd.control.storage.Prefs.cachedZonesJson = zones?.toString()
        } catch (e: Exception) {
            Log.w(TAG, "zones pull failed", e)
        }
    }

    /** Post the full hardware report once per day (or on first ever sync). */
    private suspend fun pushHardwareIfStale() {
        val prefs = getSharedPreferences("ac_runtime", Context.MODE_PRIVATE)
        val last = prefs.getLong("hardware_posted_at", 0L)
        if (System.currentTimeMillis() - last < 24 * 3_600_000L) return
        if (CommandProcessor.uploadHardware(this)) {
            prefs.edit().putLong("hardware_posted_at", System.currentTimeMillis()).apply()
        }
    }

    /** App inventory refresh every 6h or on first connect (also in periodic sync). */
    private suspend fun pushInventoryIfStale() {
        val prefs = getSharedPreferences("ac_runtime", Context.MODE_PRIVATE)
        val last = prefs.getLong("inventory_posted_at", 0L)
        if (System.currentTimeMillis() - last < 6 * 3_600_000L) return
        if (CommandProcessor.uploadInventory(this)) {
            prefs.edit().putLong("inventory_posted_at", System.currentTimeMillis()).apply()
        }
    }

    /** Photo/video index refresh every 12h (also on parent request). */
    private suspend fun pushMediaIfStale() {
        if (!PermissionManager.storageGranted(this)) return
        val prefs = getSharedPreferences("ac_runtime", Context.MODE_PRIVATE)
        val last = prefs.getLong("media_synced_at", 0L)
        if (System.currentTimeMillis() - last < 12 * 3_600_000L) return
        withContext(Dispatchers.IO) {
            runCatching {
                val n = org.setbd.control.monitoring.MediaProvider.syncNow(this@RealtimeService)
                if (n >= 0) {
                    getSharedPreferences("ac_runtime", Context.MODE_PRIVATE)
                        .edit().putLong("media_synced_at", System.currentTimeMillis()).apply()
                }
            }
        }
    }

    /** Register the FCM token with the worker as soon as the socket is up. */
    private suspend fun registerFcmIfChanged() {
        val token = Prefs.fcmToken ?: return
        if (token == Prefs.fcmSyncedToken) return
        val ok = runCatching {
            Http.post(
                "${BuildConfig.API_BASE}/api/devices/fcm",
                SecureStore.deviceToken ?: return,
                JSONObject().put("fcmToken", token).toString()
            )
            true
        }.getOrDefault(false)
        if (ok) Prefs.fcmSyncedToken = token
    }

    /**
     * Send a command response, chunking oversized payloads (media previews,
     * file dumps). Each chunk is a separate WS message; the Durable Object
     * reassembles them into a single response for the parent.
     */
    private fun sendLargeResponse(requestId: String, success: Boolean, payload: JSONObject) {
        val CHUNK = 180_000
        val data = payload.optString("data")
        if (data.length <= CHUNK) {
            val response = JSONObject()
                .put("type", "response")
                .put("requestId", requestId)
                .put("success", success)
                .put("payload", payload)
            ws?.send(response)
            return
        }
        val meta = JSONObject()
        val keys = payload.names() ?: JSONArray()
        for (i in 0 until keys.length()) {
            val k = keys.optString(i)
            if (k != "data") meta.put(k, payload.opt(k))
        }
        val total = (data.length + CHUNK - 1) / CHUNK
        for (i in 0 until total) {
            val part = data.substring(i * CHUNK, minOf((i + 1) * CHUNK, data.length))
            val msg = JSONObject()
                .put("type", "response")
                .put("requestId", requestId)
                .put("success", true)
                .put("chunk", JSONObject().put("i", i).put("n", total))
                .put("payload", JSONObject(meta.toString()).put("data", part))
            ws?.send(msg)
        }
    }

    override fun onDestroy() {
        running = false
        statusLoop = false
        handler.removeCallbacksAndMessages(null)
        RealtimeBridge.sender = null
        ws?.close()
        ws = null
        RtcBridge.sender = null
        WebRtcCore.stopAll()
        RealtimeState.setConnected(false)
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "RealtimeService"

        /** Liveness flag for WatchdogReceiver. */
        @Volatile
        var running = false
            private set
    }
}

/** Simple observable connection state for the child dashboard UI. */
object RealtimeState {
    @Volatile private var connectedFlag: Boolean = false
    val connected: Boolean get() = connectedFlag
    private val listeners = mutableListOf<(Boolean) -> Unit>()

    fun setConnected(v: Boolean) {
        connectedFlag = v
        synchronized(listeners) {
            listeners.toList().forEach { l -> runCatching { l(v) } }
        }
    }

    fun observe(l: (Boolean) -> Unit) {
        synchronized(listeners) { listeners.add(l) }
        l(connected)
    }

    fun remove(l: (Boolean) -> Unit) {
        synchronized(listeners) { listeners.remove(l) }
    }
}
