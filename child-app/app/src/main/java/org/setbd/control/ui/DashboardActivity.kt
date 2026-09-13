package org.setbd.control.ui

import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.setbd.control.R
import org.setbd.control.controls.PolicyEngine
import org.setbd.control.monitoring.DeviceInfoProvider
import org.setbd.control.monitoring.UsageStatsProvider
import org.setbd.control.permissions.PermissionManager
import org.setbd.control.storage.SecureStore
import org.setbd.control.ui.Clay
import org.setbd.control.websocket.RealtimeState
import org.setbd.control.util.ServiceLauncher

/**
 * Child dashboard (Claymorphism): connection status, device status,
 * screen time, app usage, location, protection, Telegram support, settings.
 */
class DashboardActivity : AppCompatActivity() {

    private lateinit var statusDot: ImageView
    private lateinit var statusText: TextView

    private val stateListener: (Boolean) -> Unit = { connected ->
        runOnUiThread { renderConnection(connected) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_dashboard)

        statusDot = findViewById(R.id.dashStatusDot)
        statusText = findViewById(R.id.dashStatusText)

        findViewById<View>(R.id.btnTelegramSupport).setOnClickListener {
            runCatching {
                startActivity(
                    android.content.Intent(
                        android.content.Intent.ACTION_VIEW,
                        android.net.Uri.parse(getString(R.string.telegram_support_url))
                    )
                )
            }
        }
        findViewById<View>(R.id.btnSettings).setOnClickListener {
            startActivity(android.content.Intent(this, SettingsActivity::class.java))
        }
        findViewById<View>(R.id.btnOpenPermissions).setOnClickListener {
            startActivity(android.content.Intent(this, org.setbd.control.onboarding.PermissionsActivity::class.java))
        }
    }

    override fun onResume() {
        super.onResume()
        RealtimeState.observe(stateListener)
        ServiceLauncher.startAll(this)
        refreshCards()
    }

    override fun onPause() {
        RealtimeState.remove(stateListener)
        super.onPause()
    }

    private fun renderConnection(connected: Boolean) {
        statusDot.setImageResource(if (connected) R.drawable.dot_connected else R.drawable.dot_offline)
        statusText.text =
            if (connected) getString(R.string.dash_connected)
            else getString(R.string.dash_offline)
    }

    private fun refreshCards() {
        lifecycleScope.launch(Dispatchers.IO) {
            val screenMin = runCatching { UsageStatsProvider.totalMinutesToday(this@DashboardActivity) }.getOrDefault(0L)
            val status = runCatching { DeviceInfoProvider.statusJson(this@DashboardActivity) }.getOrNull()
            withContext(Dispatchers.Main) {
                renderConnection(RealtimeState.connected)

                findViewById<TextView>(R.id.dashScreenTime).text =
                    getString(R.string.dash_minutes_value, screenMin)
                findViewById<TextView>(R.id.dashDevice).text =
                    status?.optString("model", "").orEmpty().ifBlank { android.os.Build.MODEL }
                findViewById<TextView>(R.id.dashBattery).text =
                    if (status != null && status.optInt("batteryLevel", -1) >= 0)
                        "${status.optInt("batteryLevel")}%${if (status.optBoolean("charging")) " ⚡" else ""}"
                    else getString(R.string.dash_unknown)
                findViewById<TextView>(R.id.dashUsageAccess).text =
                    if (PermissionManager.usageAccessGranted(this@DashboardActivity))
                        getString(R.string.dash_on)
                    else getString(R.string.dash_needed)
                findViewById<TextView>(R.id.dashLocation).text =
                    when {
                        !PermissionManager.locationGranted(this@DashboardActivity) -> getString(R.string.dash_needed)
                        PolicyEngine.locationMonitoringEnabled() -> getString(R.string.dash_on)
                        else -> getString(R.string.dash_off)
                    }
                findViewById<TextView>(R.id.dashProtection).text = PolicyEngine.summary()
            }
        }
    }
}
