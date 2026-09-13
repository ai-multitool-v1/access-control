package org.setbd.control.controls

import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.setbd.control.R

/**
 * Full-screen SOS overlay shown when the child leaves every active safe zone.
 * Launched from RealtimeService on the server's `zone_alert` event. Always
 * visible over lockscreen; the message text comes from the parent's zone.
 */
class ZoneAlertActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.attributes = window.attributes.apply {
            screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_FULL
        }
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        setContentView(R.layout.activity_zone_alert)

        val message = intent.getStringExtra("message").orEmpty()
        val zones = intent.getStringExtra("zones").orEmpty()

        findViewById<TextView>(R.id.zoneMessage).text =
            message.ifBlank { getString(R.string.zone_alert_default) }
        findViewById<TextView>(R.id.zoneZones).apply {
            if (zones.isBlank()) {
                visibility = View.GONE
            } else {
                text = getString(R.string.zone_alert_zones, zones)
            }
        }

        findViewById<View>(R.id.btnAck).setOnClickListener { finish() }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // must explicitly acknowledge — the alert cannot be dismissed by back
    }
}
