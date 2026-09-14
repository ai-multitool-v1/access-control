package org.setbd.control.websocket

/**
 * Static outbound-event bridge. RealtimeService installs the sender when its
 * WebSocket opens; other components (e.g. the notification listener) can then
 * push live events to the parent without owning the socket.
 */
object RealtimeBridge {

    /** Returns true when the event was handed to the live socket. */
    @Volatile
    var sender: ((event: String, payload: org.json.JSONObject) -> Boolean)? = null

    fun sendEvent(event: String, payload: org.json.JSONObject): Boolean =
        try {
            sender?.invoke(event, payload) ?: false
        } catch (_: Exception) {
            false
        }
}
