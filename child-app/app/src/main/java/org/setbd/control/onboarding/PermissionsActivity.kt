package org.setbd.control.onboarding

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
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
 * Permissions / Device Setup — the full AirDroid-Kids-style permission matrix.
 * EVERY row fires a REAL system intent or runtime dialog, and every row
 * re-validates itself when the user comes back (onResume). Nothing is fake.
 */
class PermissionsActivity : AppCompatActivity() {

    private lateinit var rows: List<PermRow>

    private class PermRow(
        val statusView: TextView,
        val button: Button,
        val check: () -> Boolean,
        val request: () -> Unit,
        val optional: Boolean = false
    )

    private val locationLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refresh() }
    private val locationBgLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }
    private val notificationsLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }
    private val micLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }
    private val cameraLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }
    private val storageLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refresh() }
    private val commsLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refresh() }
    private val adminLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_permissions)

        rows = listOf(
            // 1. Accessibility — instant app blocking (AirDroid Kids #1)
            PermRow(
                findViewById(R.id.permAccessibilityStatus), findViewById(R.id.permAccessibilityBtn),
                { PermissionManager.accessibilityEnabled(this) },
                { PermissionManager.openAccessibilitySettings(this) }
            ),
            // 2. Notification Access — monitor social app notifications
            PermRow(
                findViewById(R.id.permNotifListenerStatus), findViewById(R.id.permNotifListenerBtn),
                { PermissionManager.notificationListenerGranted(this) },
                { PermissionManager.openNotificationListenerSettings(this) }
            ),
            // 3. Location (precise)
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
            // 4. Location all the time (background) — route history / geofence
            PermRow(
                findViewById(R.id.permLocationBgStatus), findViewById(R.id.permLocationBgBtn),
                { PermissionManager.backgroundLocationGranted(this) },
                {
                    if (Build.VERSION.SDK_INT < 29) {
                        Toast.makeText(this, R.string.perm_not_required, Toast.LENGTH_SHORT).show()
                    } else if (!PermissionManager.locationGranted(this)) {
                        Toast.makeText(this, R.string.perm_bg_needs_precise, Toast.LENGTH_LONG).show()
                        locationLauncher.launch(
                            arrayOf(
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION
                            )
                        )
                    } else {
                        locationBgLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    }
                }
            ),
            // 5. Usage Access — screen time & app usage stats
            PermRow(
                findViewById(R.id.permUsageStatus), findViewById(R.id.permUsageBtn),
                { PermissionManager.usageAccessGranted(this) },
                { PermissionManager.openUsageAccessSettings(this) }
            ),
            // 6. Display over other apps
            PermRow(
                findViewById(R.id.permOverlayStatus), findViewById(R.id.permOverlayBtn),
                { PermissionManager.overlayGranted(this) },
                { PermissionManager.openOverlaySettings(this) }
            ),
            // 7. Battery unrestricted — keep-alive
            PermRow(
                findViewById(R.id.permBatteryStatus), findViewById(R.id.permBatteryBtn),
                { PermissionManager.batteryOptimizationIgnored(this) },
                { PermissionManager.requestIgnoreBatteryOptimization(this) }
            ),
            // 8. Microphone — one-way audio / voice chat
            PermRow(
                findViewById(R.id.permMicStatus), findViewById(R.id.permMicBtn),
                { PermissionManager.micGranted(this) },
                { micLauncher.launch(Manifest.permission.RECORD_AUDIO) }
            ),
            // 9. Camera — remote camera & screen mirroring support
            PermRow(
                findViewById(R.id.permCameraStatus), findViewById(R.id.permCameraBtn),
                { PermissionManager.cameraGranted(this) },
                { cameraLauncher.launch(Manifest.permission.CAMERA) }
            ),
            // 10. Notifications — parent messages & status
            PermRow(
                findViewById(R.id.permNotifStatus), findViewById(R.id.permNotifBtn),
                { PermissionManager.postNotificationsGranted(this) },
                {
                    if (Build.VERSION.SDK_INT >= 33) {
                        notificationsLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
            ),
            // 11. Contacts / Phone / SMS — OPTIONAL call & SMS monitoring
            PermRow(
                findViewById(R.id.permCommsStatus), findViewById(R.id.permCommsBtn),
                { PermissionManager.commsGranted(this) },
                {
                    commsLauncher.launch(
                        arrayOf(
                            Manifest.permission.READ_CONTACTS,
                            Manifest.permission.READ_PHONE_STATE,
                            Manifest.permission.READ_CALL_LOG,
                            Manifest.permission.READ_SMS
                        )
                    )
                },
                optional = true
            ),
            // 12. Storage / Photos — file & media features
            PermRow(
                findViewById(R.id.permStorageStatus), findViewById(R.id.permStorageBtn),
                { PermissionManager.storageGranted(this) },
                {
                    if (Build.VERSION.SDK_INT >= 33) {
                        storageLauncher.launch(
                            arrayOf(
                                Manifest.permission.READ_MEDIA_IMAGES,
                                Manifest.permission.READ_MEDIA_VIDEO
                            )
                        )
                    } else {
                        storageLauncher.launch(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE))
                    }
                }
            ),
            // 13. Install unknown apps — protection updates wizard
            PermRow(
                findViewById(R.id.permInstallStatus), findViewById(R.id.permInstallBtn),
                { PermissionManager.installUnknownAppsGranted(this) },
                { PermissionManager.openInstallUnknownAppsSettings(this) }
            ),
            // 14. Uninstall protection (Device admin) — disclosed & reversible
            PermRow(
                findViewById(R.id.permAdminStatus), findViewById(R.id.permAdminBtn),
                { PermissionManager.adminActive(this) },
                { DevicePolicy.requestAdmin(this, 101) },
                optional = true
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
            r.statusView.text = when {
                ok -> getString(R.string.perm_granted)
                r.optional -> getString(R.string.perm_optional)
                else -> getString(R.string.perm_needed)
            }
            r.statusView.setTextColor(
                ContextCompat.getColor(
                    this,
                    when {
                        ok -> R.color.clay_green
                        r.optional -> R.color.clay_text_soft
                        else -> R.color.clay_red
                    }
                )
            )
            r.button.text = if (ok) getString(R.string.perm_granted_btn) else getString(R.string.perm_grant_btn)
            r.button.isEnabled = !ok
            Clay.applyPressAnimation(r.button)
        }
    }
}
