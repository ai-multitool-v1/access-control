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
import org.json.JSONArray
import org.json.JSONObject
import org.setbd.control.BuildConfig
import org.setbd.control.R
import org.setbd.control.controls.PolicyEngine
import org.setbd.control.controls.ZoneAlertActivity
import org.setbd.control.monitoring.DeviceInfoProvider
import org.setbd.control.notifications.NotificationHelper
import org.setbd.control.permissions.PermissionManager
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

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val handler = Handler(Looper.getMainLooper())
    private var ws: WsClient? = null
    private var backoffMs = 1_000L
    private var statusLoop = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(
            NotificationHelper.REALTIME_NOTIFICATION_ID,
            NotificationHelper.realtimeNotification(this)
        )
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
        scope.launch {
            pullPolicies()
            pullChildConfig()
            pushHardwareIfStale()
            sendStatus()
        }
    }

    override fun onWsMessage(obj: JSONObject) {
        when (obj.optString("type")) {
            "command" -> scope.launch {
                val requestId = obj.optString("requestId")
                val action = obj.optString("action")
                val payload = obj.optJSONObject("payload") ?: JSONObject()
                val result = CommandProcessor.handle(this@RealtimeService, action, payload)
                val response = JSONObject().apply {
                    put("type", "response")
                    put("requestId", requestId)
                    when (result) {
                        is CommandProcessor.Result.Ok -> {
                            put("success", true)
                            put("payload", result.payload)
                        }
                        is CommandProcessor.Result.Failed -> {
                            put("success", false)
                            put("error", JSONObject().put("code", result.code).put("message", result.message))
                        }
                    }
                }
                ws?.send(response)
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
            "pong" -> { /* heartbeat ack */ }
        }
    }

    override fun onWsClosed(willRetry: Boolean) {
        RealtimeState.setConnected(false)
        UiNotifier.notifyState(this, false)
        if (willRetry) {
            handler.postDelayed({ ensureConnected() }, backoffMs)
            backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
        }
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
        scope.launch {
            while (true) {
                delay(60_000)
                if (ws?.isOpen == true) sendStatus()
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

    /** Pull + apply latest policies over REST after (re)connect. */
    private suspend fun pullPolicies() {
        val deviceId = SecureStore.deviceId ?: return
        val token = SecureStore.deviceToken ?: return
        try {
            val text = Http.get(
                "${BuildConfig.API_BASE}/api/devices/$deviceId/policies", token
            )
            val obj = JSONObject(text)
            val arr = obj.optJSONArray("policies") ?: return
            CommandProcessor.applyPolicies(this, arr)
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

    override fun onDestroy() {
        statusLoop = false
        handler.removeCallbacksAndMessages(null)
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
