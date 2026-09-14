package org.setbd.control.websocket

import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.setbd.control.BuildConfig
import org.setbd.control.util.Http
import java.util.concurrent.atomic.AtomicBoolean

/**
 * OkHttp WebSocket client with app-level heartbeat + pong-freshness watchdog.
 * Reconnect policy (exponential backoff) is owned by RealtimeService.
 *
 * v1.9.1 reliability fixes (the "parent controls suddenly stopped working"
 * root cause): on mobile networks the TCP pipe routinely goes half-open
 * (WiFi↔data switch, Doze, NAT expiry). OkHttp's send() still "succeeds" on
 * a half-open socket — the bytes vanish into the void, no close event ever
 * fires, so the service happily reported "protected" while every parent
 * command timed out. Three changes close that hole:
 *   1. Pong freshness — every ping must be answered within 50 s, else the
 *      dead socket is cancelled() and the service reconnects.
 *   2. isOpen now reflects real connectivity, not a non-null field.
 *   3. Stale-callback guards — an old socket's onFailure can no longer
 *      null out the freshly reconnected socket's reference.
 */
class WsClient(
    private val deviceId: String,
    private val deviceToken: String,
    private val listener: Listener
) : WebSocketListener() {

    interface Listener {
        fun onWsOpen()
        fun onWsMessage(obj: JSONObject)
        fun onWsClosed(willRetry: Boolean)
        /** Server closed us with 4000 device_revoked — parent unpaired the device. */
        fun onWsRevoked() {}
    }

    private var webSocket: WebSocket? = null
    @Volatile private var open = false
    @Volatile private var lastPongAt = 0L
    private val deliberatelyClosed = AtomicBoolean(false)
    @Volatile private var heartbeating = false
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())

    private val heartbeat = object : Runnable {
        override fun run() {
            if (!heartbeating) return
            val now = System.currentTimeMillis()
            // Sent at least one ping and heard NOTHING back for 50 s (>1.5
            // missed heartbeats) — the connection is half-open. Cancel it so
            // onFailure fires and RealtimeService reconnects with backoff.
            if (lastPongAt in 1..(now - PONG_STALE_MS)) {
                heartbeating = false
                runCatching { webSocket?.cancel() }
                return
            }
            send(JSONObject().put("type", "ping"))
            handler.postDelayed(this, PING_INTERVAL_MS)
        }
    }

    fun connect() {
        if (webSocket != null) return
        deliberatelyClosed.set(false)
        lastPongAt = 0L
        open = false
        val url = "${BuildConfig.WS_BASE}/ws?role=child&device=${deviceId}&token=${java.net.URLEncoder.encode(deviceToken, "UTF-8")}"
        val request = Request.Builder().url(url).build()
        webSocket = Http.client.newWebSocket(request, this)
    }

    fun close() {
        deliberatelyClosed.set(true)
        stopHeartbeat()
        open = false
        try {
            webSocket?.close(1000, "client_leaving")
        } catch (e: Exception) {
        }
        webSocket = null
    }

    fun send(obj: JSONObject): Boolean {
        val ws = webSocket ?: return false
        return try {
            ws.send(obj.toString())
        } catch (e: Exception) {
            false
        }
    }

    /** Real connectivity: a live socket that completed the handshake. */
    val isOpen: Boolean
        get() = open && webSocket != null

    /** RealtimeService feeds pong acks here for the freshness watchdog. */
    fun onPong() {
        lastPongAt = System.currentTimeMillis()
    }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        if (this.webSocket !== webSocket) {
            // Stale callback from a previous connection attempt.
            runCatching { webSocket.close(1000, "stale") }
            return
        }
        open = true
        lastPongAt = System.currentTimeMillis()
        startHeartbeat()
        listener.onWsOpen()
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        val obj = try { JSONObject(text) } catch (e: Exception) { return }
        listener.onWsMessage(obj)
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        if (this.webSocket !== webSocket) return // stale callback — ignore
        open = false
        stopHeartbeat()
        this.webSocket = null
        listener.onWsClosed(!deliberatelyClosed.get())
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        if (this.webSocket !== webSocket) return // stale callback — ignore
        open = false
        stopHeartbeat()
        this.webSocket = null
        if (code == 4000) {
            listener.onWsRevoked()
            listener.onWsClosed(false)
            return
        }
        // v1.9.1: retry on ANY clean close too (including 1000). Server-side
        // deploys and DO evictions close with 1000 — treating that as
        // "don't reconnect" silently bricked the device until next reboot.
        listener.onWsClosed(!deliberatelyClosed.get())
    }

    private fun startHeartbeat() {
        if (heartbeating) return
        heartbeating = true
        handler.postDelayed(heartbeat, PING_INTERVAL_MS)
    }

    private fun stopHeartbeat() {
        heartbeating = false
        handler.removeCallbacks(heartbeat)
    }

    companion object {
        private const val PING_INTERVAL_MS = 30_000L
        private const val PONG_STALE_MS = 50_000L
    }
}
