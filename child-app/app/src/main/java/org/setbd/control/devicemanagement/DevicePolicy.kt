package org.setbd.control.devicemanagement

import android.app.Activity
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.Toast
import org.setbd.control.R

/** DeviceAdminReceiver — visible, disclosed uninstall protection & lock support. */
class AccessControlAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        Toast.makeText(context, R.string.admin_description, Toast.LENGTH_LONG).show()
    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        // Disclosed and user-controlled: they may always deactivate.
        return context.getString(R.string.admin_explanation)
    }
}

/** Wrapper around DevicePolicyManager for the features we actually use. */
object DevicePolicy {

    private fun dpm(ctx: Context): DevicePolicyManager =
        ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    private fun componentName(ctx: Context): ComponentName =
        ComponentName(ctx, AccessControlAdminReceiver::class.java)

    fun isAdmin(ctx: Context): Boolean =
        dpm(ctx).isAdminActive(componentName(ctx))

    fun requestAdmin(activity: Activity, requestCode: Int) {
        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
            putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, componentName(activity))
            putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, activity.getString(R.string.admin_explanation))
        }
        activity.startActivityForResult(intent, requestCode)
    }

    fun removeAdmin(ctx: Context) {
        dpm(ctx).removeActiveAdmin(componentName(ctx))
    }

    /** Screen lock — used by bedtime/school mode and the parent's lock command. */
    fun lockNow(ctx: Context): Boolean {
        if (!isAdmin(ctx)) return false
        return try {
            dpm(ctx).lockNow()
            true
        } catch (e: Exception) {
            false
        }
    }

    fun setCameraDisabled(ctx: Context, disable: Boolean): Boolean {
        if (!isAdmin(ctx)) return false
        return try {
            dpm(ctx).setCameraDisabled(componentName(ctx), disable)
            true
        } catch (e: Exception) {
            false
        }
    }

    fun isCameraDisabled(ctx: Context): Boolean {
        if (!isAdmin(ctx)) return false
        return try {
            dpm(ctx).getCameraDisabled(componentName(ctx))
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Parent-approved uninstall window: remove device admin for [minutes] so
     * the app can be uninstalled, then the protection re-arms automatically
     * (PolicyEnforcerService re-prompts when the window closes).
     */
    fun openUninstallGrace(ctx: Context, minutes: Int) {
        org.setbd.control.storage.Prefs.uninstallGraceUntil =
            System.currentTimeMillis() + minutes * 60_000L
        if (isAdmin(ctx)) {
            try {
                removeAdmin(ctx)
                android.widget.Toast.makeText(
                    ctx,
                    ctx.getString(org.setbd.control.R.string.uninstall_allowed_toast),
                    android.widget.Toast.LENGTH_LONG
                ).show()
            } catch (e: Exception) {
            }
        }
    }

    fun graceActive(): Boolean =
        System.currentTimeMillis() < org.setbd.control.storage.Prefs.uninstallGraceUntil

    fun graceRemainingMinutes(): Int =
        (((org.setbd.control.storage.Prefs.uninstallGraceUntil - System.currentTimeMillis()) / 60_000L) + 1)
            .toInt().coerceAtLeast(1)
}
