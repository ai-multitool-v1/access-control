package org.setbd.control.diagnostics

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.setbd.control.BuildConfig
import org.setbd.control.R
import org.setbd.control.permissions.PermissionManager
import org.setbd.control.storage.SecureStore
import org.setbd.control.websocket.RealtimeState

/** Setup/diagnostic screen (reachable via *#*#9999#*#* even when hidden). */
class DiagnosticsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_diagnostics)

        findViewById<TextView>(R.id.diagVersion).text =
            "App v${BuildConfig.VERSION_NAME} • API: ${BuildConfig.API_BASE}"

        val body = findViewById<TextView>(R.id.diagBody)
        val report = PermissionManager.report(this)
        val sb = StringBuilder()
        sb.append("Paired: ${SecureStore.isPaired}\n")
        sb.append("Device: ${SecureStore.deviceId?.takeLast(12) ?: "—"}\n")
        sb.append("WS: ${if (RealtimeState.connected) "connected" else "disconnected"}\n\n")
        sb.append("Permissions\n")
        for (key in report.keys()) {
            sb.append("• $key: ${report.optBoolean(key)}\n")
        }
        body.text = sb.toString()
    }
}
