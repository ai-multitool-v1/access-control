package org.setbd.control.ui

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import org.setbd.control.storage.Prefs
import org.setbd.control.onboarding.SplashActivity

/**
 * Icon hiding via the launcher activity-alias. The alias is the only LAUNCHER
 * entry, so disabling it hides the icon while SecretCodeReceiver (dial
 * *#*#9999#*#*) and the parent dashboard keep working. Fully reversible.
 */
object IconHider {

    private fun aliasComponent(context: Context): ComponentName =
        ComponentName(context, "${context.packageName}.LauncherAlias")

    fun isHidden(context: Context): Boolean =
        context.packageManager.getComponentEnabledSetting(aliasComponent(context)) ==
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED

    fun setHidden(context: Context, hidden: Boolean) {
        Prefs.iconHidden = hidden
        apply(context, hidden)
    }

    fun apply(context: Context, hidden: Boolean) {
        try {
            context.packageManager.setComponentEnabledSetting(
                aliasComponent(context),
                if (hidden) PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                else PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
            )
        } catch (e: Exception) {
            // some launchers may not refresh — state is still persisted
        }
    }

    fun selfPackageVisible(context: Context): Boolean {
        // Companion check used by diagnostics
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0) != null &&
                !isHidden(context)
        } catch (e: Exception) {
            true
        }
    }
}
