package org.setbd.control.onboarding

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.setbd.control.R
import org.setbd.control.devicemanagement.DevicePolicy
import org.setbd.control.pairing.PairingActivity
import org.setbd.control.permissions.PermissionManager
import org.setbd.control.storage.Prefs
import org.setbd.control.ui.Clay

/**
 * Permissions / Device Setup — every sensitive permission is requested
 * explicitly, with an explanation. Nothing is enabled silently.
 */
class PermissionsActivity : AppCompatActivity() {

    private lateinit var rows: List<PermRow>

    private class PermRow(
        val statusView: TextView,
        val button: Button,
        val check: () -> Boolean,
        val request: () -> Unit
    )

    private val locationLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refresh() }
    private val notificationsLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }
    private val adminLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_permissions)

        rows = listOf(
            PermRow(
                findViewById(R.id.permUsageStatus), findViewById(R.id.permUsageBtn),
                { PermissionManager.usageAccessGranted(this) },
                { PermissionManager.openUsageAccessSettings(this) }
            ),
            PermRow(
                findViewById(R.id.permLocationStatus), findViewById(R.id.permLocationBtn),
                { PermissionManager.locationGranted(this) },
                {
                    locationLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        )
                    )
                }
            ),
            PermRow(
                findViewById(R.id.permNotifStatus), findViewById(R.id.permNotifBtn),
                { PermissionManager.postNotificationsGranted(this) },
                {
                    if (Build.VERSION.SDK_INT >= 33) {
                        notificationsLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
            ),
            PermRow(
                findViewById(R.id.permOverlayStatus), findViewById(R.id.permOverlayBtn),
                { PermissionManager.overlayGranted(this) },
                { PermissionManager.openOverlaySettings(this) }
            ),
            PermRow(
                findViewById(R.id.permBatteryStatus), findViewById(R.id.permBatteryBtn),
                { PermissionManager.batteryOptimizationIgnored(this) },
                { PermissionManager.requestIgnoreBatteryOptimization(this) }
            ),
            PermRow(
                findViewById(R.id.permAdminStatus), findViewById(R.id.permAdminBtn),
                { PermissionManager.adminActive(this) },
                { DevicePolicy.requestAdmin(this, 101) }
            )
        )

        findViewById<Button>(R.id.btnContinue).setOnClickListener {
            Prefs.permissionsShown = true
            startActivity(Intent(this, PairingActivity::class.java))
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        for (r in rows) {
            val ok = runCatching { r.check() }.getOrDefault(false)
            r.statusView.text = if (ok) getString(R.string.perm_granted) else getString(R.string.perm_needed)
            r.statusView.setTextColor(
                ContextCompat.getColor(this, if (ok) R.color.clay_green else R.color.clay_red)
            )
            r.button.text = if (ok) getString(R.string.perm_granted_btn) else getString(R.string.perm_grant_btn)
            r.button.isEnabled = !ok
            Clay.applyPressAnimation(r.button)
        }
    }
}
