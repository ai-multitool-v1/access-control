package org.setbd.control.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.setbd.control.R
import org.setbd.control.devicemanagement.DevicePolicy
import org.setbd.control.diagnostics.DiagnosticsActivity
import org.setbd.control.permissions.PermissionManager
import org.setbd.control.storage.Prefs
import org.setbd.control.storage.SecureStore

/** Child settings: permissions status, icon hiding, device admin, diagnostics. */
class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val iconToggle = findViewById<Button>(R.id.btnToggleIcon)
        val adminToggle = findViewById<Button>(R.id.btnToggleAdmin)
        val pairedInfo = findViewById<TextView>(R.id.settingsPaired)

        pairedInfo.text =
            if (SecureStore.isPaired) "Device ID: …${SecureStore.deviceId?.takeLast(8)}"
            else getString(R.string.settings_not_paired)

        fun render() {
            val hidden = PermissionManager.iconHidden(this)
            iconToggle.text = if (hidden) getString(R.string.settings_icon_show) else getString(R.string.settings_icon_hide)
            val admin = PermissionManager.adminActive(this)
            adminToggle.text =
                if (admin) getString(R.string.settings_admin_deactivate)
                else getString(R.string.settings_admin_activate)
        }

        iconToggle.setOnClickListener {
            IconHider.setHidden(this, !PermissionManager.iconHidden(this))
            render()
            showUnhideHint()
        }

        adminToggle.setOnClickListener {
            if (PermissionManager.adminActive(this)) {
                AlertDialog.Builder(this)
                    .setTitle(R.string.settings_admin_deactivate)
                    .setMessage(R.string.admin_explanation)
                    .setPositiveButton(R.string.settings_continue) { _, _ ->
                        DevicePolicy.removeAdmin(this)
                        render()
                    }
                    .setNegativeButton(android.R.string.cancel, null)
                    .show()
            } else {
                DevicePolicy.requestAdmin(this, 102)
            }
        }

        findViewById<Button>(R.id.btnDiagnostics).setOnClickListener {
            startActivity(Intent(this, DiagnosticsActivity::class.java))
        }

        findViewById<Button>(R.id.btnSettingsPermissions).setOnClickListener {
            startActivity(Intent(this, org.setbd.control.onboarding.PermissionsActivity::class.java))
        }

        render()
    }

    private fun showUnhideHint() {
        AlertDialog.Builder(this)
            .setTitle(R.string.settings_icon_hidden_title)
            .setMessage(R.string.settings_icon_hidden_body)
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }
}
