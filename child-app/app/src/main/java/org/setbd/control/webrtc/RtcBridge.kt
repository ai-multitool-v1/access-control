package org.setbd.control.webrtc

import org.json.JSONObject

/**
 * Outbound WebRTC signaling channel. RealtimeService injects the WebSocket
 * sender on connect; WebRtcCore uses it to exchange SDP/ICE with parents.
 * Message shapes (DO relays these as-is, both directions):
 *   {"type":"rtc","payload":{"kind":"screen|ambient|camera","action":"offer|answer|ice|stopped|error|stop",...}}
 */
object RtcBridge {

    @Volatile
    var sender: ((JSONObject) -> Boolean)? = null

    fun sendRtc(kind: String, action: String, fill: JSONObject.() -> Unit = {}) {
        val payload = JSONObject().put("kind", kind).put("action", action)
        runCatching { payload.fill() }
        val msg = JSONObject().put("type", "rtc").put("payload", payload)
        runCatching { sender?.invoke(msg) }
    }

    /** Child -> parent UI event so the dashboard shows session state changes. */
    fun sendCaptureState(kind: String, state: String) {
        val msg = JSONObject()
            .put("type", "event")
            .put("event", "capture_state")
            .put("payload", JSONObject().put("kind", kind).put("state", state))
        runCatching { sender?.invoke(msg) }
    }
}
