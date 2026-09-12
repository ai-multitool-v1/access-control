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
 * OkHttp WebSocket client with app-level heartbeat.
 * Reconnect policy (exponential backoff) is owned by RealtimeService.
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
    }

    private var webSocket: WebSocket? = null
    private val deliberatelyClosed = AtomicBoolean(false)
    @Volatile private var heartbeating = false
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())

    private val heartbeat = object : Runnable {
        override fun run() {
            if (!heartbeating) return
            send(JSONObject().put("type", "ping"))
            handler.postDelayed(this, 30_000)
        }
    }

    fun connect() {
        if (webSocket != null) return
        deliberatelyClosed.set(false)
        val url = "${BuildConfig.WS_BASE}/ws?role=child&device=${deviceId}&token=${java.net.URLEncoder.encode(deviceToken, "UTF-8")}"
        val request = Request.Builder().url(url).build()
        webSocket = Http.client.newWebSocket(request, this)
    }

    fun close() {
        deliberatelyClosed.set(true)
        stopHeartbeat()
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

    val isOpen: Boolean
        get() = webSocket != null

    override fun onOpen(webSocket: WebSocket, response: Response) {
        startHeartbeat()
        listener.onWsOpen()
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        val obj = try { JSONObject(text) } catch (e: Exception) { return }
        listener.onWsMessage(obj)
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        stopHeartbeat()
        this.webSocket = null
        listener.onWsClosed(!deliberatelyClosed.get())
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        stopHeartbeat()
        this.webSocket = null
        listener.onWsClosed(!deliberatelyClosed.get() && code != 4000L && code != 1000L)
    }

    private fun startHeartbeat() {
        if (heartbeating) return
        heartbeating = true
        handler.postDelayed(heartbeat, 30_000)
    }

    private fun stopHeartbeat() {
        heartbeating = false
        handler.removeCallbacks(heartbeat)
    }
}
