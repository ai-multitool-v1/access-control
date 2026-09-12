package org.setbd.control.websocket

import android.app.Service
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
import org.json.JSONObject
import org.setbd.control.BuildConfig
import org.setbd.control.R
import org.setbd.control.controls.PolicyEngine
import org.setbd.control.monitoring.DeviceInfoProvider
import org.setbd.control.notifications.NotificationHelper
import org.setbd.control.permissions.PermissionManager
import org.setbd.control.storage.SecureStore
import org.setbd.control.util.Http
import org.setbd.control.util.UiNotifier

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
        scope.launch {
            pullPolicies()
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
                if (event == "policies_updated") {
                    scope.launch { pullPolicies() }
                }
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

    override fun onDestroy() {
        statusLoop = false
        handler.removeCallbacksAndMessages(null)
        ws?.close()
        ws = null
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
    @Volatile var connected: Boolean = false
    private val listeners = mutableListOf<(Boolean) -> Unit>()

    fun setConnected(v: Boolean) {
        connected = v
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

object UiNotifier {
    /** Parent-facing status text for the child dashboard. */
    fun stateText(ctx: android.content.Context, connected: Boolean): String =
        if (connected) ctx.getString(R.string.dash_connected)
        else ctx.getString(R.string.dash_offline)

    fun notifyState(ctx: android.content.Context, connected: Boolean) {
        // Reserved hook: dashboards observe RealtimeState directly.
    }
}
