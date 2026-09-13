package org.setbd.control.controls

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import org.json.JSONObject

/**
 * Remote touch assistance for live remote sessions.
 *
 * The parent dashboard streams tap / long-press / swipe / scroll events over
 * the existing WebSocket; the coordinates arrive NORMALIZED (0..1 of the
 * screen) so no scaling can ever drift. This object turns them into real
 * Android gestures through AccessibilityService.dispatchGesture (API 24+,
 * which is our minSdk) and performs global actions (back / home / recents)
 * through performGlobalAction. Everything is permission-gated: the caller
 * checks BlockAccessibilityService.instance first and reports a graceful
 * fallback message when accessibility is off.
 */
object RemoteInput {

    fun execute(svc: AccessibilityService, payload: JSONObject): JSONObject {
        val action = payload.optString("action")
        val dm = svc.resources.displayMetrics
        val w = dm.widthPixels.toFloat().coerceAtLeast(1f)
        val h = dm.heightPixels.toFloat().coerceAtLeast(1f)

        fun px(nx: Double): Float = (nx.toFloat() * w).coerceIn(1f, w - 1f)
        fun py(ny: Double): Float = (ny.toFloat() * h).coerceIn(1f, h - 1f)

        when (action) {
            "tap" -> {
                val x = px(payload.optDouble("nx", 0.5))
                val y = py(payload.optDouble("ny", 0.5))
                dispatchStroke(svc, x, y, x, y, 60)
            }
            "long_press" -> {
                val x = px(payload.optDouble("nx", 0.5))
                val y = py(payload.optDouble("ny", 0.5))
                dispatchStroke(svc, x, y, x, y, payload.optLong("durationMs", 650L).coerceIn(400L, 1500L))
            }
            "swipe" -> {
                dispatchStroke(
                    svc,
                    px(payload.optDouble("nx1", 0.5)),
                    py(payload.optDouble("ny1", 0.6)),
                    px(payload.optDouble("nx2", 0.5)),
                    py(payload.optDouble("ny2", 0.4)),
                    payload.optLong("durationMs", 280L).coerceIn(80L, 2000L)
                )
            }
            "scroll" -> {
                // A short, slower drag at the horizontal center — reads as a
                // scroll in every app (faster drags read as flings).
                val x = px(payload.optDouble("nx", 0.5))
                val down = payload.optString("direction", "down") != "up"
                val span = if (payload.has("ny1") && payload.has("ny2")) {
                    dispatchStroke(
                        svc, x, py(payload.optDouble("ny1", 0.7)),
                        x, py(payload.optDouble("ny2", 0.3)),
                        payload.optLong("durationMs", 300L).coerceIn(100L, 1500L)
                    )
                    0f
                } else {
                    h * 0.28f
                }
                if (span > 0f) {
                    val y0 = if (down) h * 0.68f else h * 0.32f
                    val y1 = if (down) y0 - span else y0 + span
                    dispatchStroke(svc, x, y0, x, y1, 300)
                }
            }
            "back" -> svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            "home" -> svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
            "recents" -> svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_RECENTS)
            else -> throw IllegalArgumentException("Unknown remote input action \"$action\"")
        }
        return JSONObject().put("done", true).put("action", action)
    }

    private fun dispatchStroke(
        svc: AccessibilityService,
        x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long
    ) {
        val path = Path()
        path.moveTo(x1, y1)
        path.lineTo(x2, y2)
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        svc.dispatchGesture(gesture, null, null)
    }
}
