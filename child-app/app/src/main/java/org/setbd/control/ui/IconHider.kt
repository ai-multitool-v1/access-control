package org.setbd.control.ui

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import org.setbd.control.storage.Prefs

/**
 * Icon hiding via the launcher activity-aliases.
 *
 * The manifest declares TWO launcher aliases:
 *  - .LauncherAlias  the real, visible icon (enabled by default)
 *  - .GhostAlias     an invisible, transparent-icon alias (disabled by default)
 *
 * Hiding sequence (this is what makes it work on stubborn OEM launchers):
 *  1. disable .LauncherAlias          -> the app loses its launcher entry
 *  2. briefly ENABLE .GhostAlias      -> the launcher sees a "new" launcher
 *     component and is FORCED to re-bind the app's home-screen entry
 *     (MIUI / ColorOS / Vivo / Realme launchers ignore a plain disable of
 *     the same component they already rendered — but a component ADD is
 *     processed as a package change they must react to)
 *  3. disable .GhostAlias 700 ms later -> the entry disappears completely
 *  4. re-assert disable on .LauncherAlias at 1.5 s / 6 s / 20 s
 *
 * The dial code (*#*#9999#*#*) and the parent dashboard keep working while
 * hidden. Fully reversible.
 */
object IconHider {

    private const val GHOST_ON_MS = 700L
    private val REASSERT_DELAYS = listOf(1_500L, 6_000L, 20_000L)

    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

    private fun aliasComponent(context: Context): ComponentName =
        ComponentName(context, "${context.packageName}.LauncherAlias")

    private fun ghostComponent(context: Context): ComponentName =
        ComponentName(context, "${context.packageName}.GhostAlias")

    private fun setEnabled(context: Context, component: ComponentName, enabled: Boolean) {
        try {
            context.packageManager.setComponentEnabledSetting(
                component,
                if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            )
        } catch (_: Exception) {
            // never crash for a launcher quirk — state is re-asserted later
        }
    }

    fun isHidden(context: Context): Boolean =
        context.packageManager.getComponentEnabledSetting(aliasComponent(context)) ==
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED

    fun setHidden(context: Context, hidden: Boolean) {
        Prefs.iconHidden = hidden
        apply(context, hidden)
    }

    fun apply(context: Context, hidden: Boolean) {
        val appCtx = context.applicationContext
        if (hidden) {
            val alias = aliasComponent(appCtx)
            val ghost = ghostComponent(appCtx)

            // 1) main entry gone
            setEnabled(appCtx, alias, false)
            // 2) force a launcher re-bind with a NEW launcher component…
            setEnabled(appCtx, ghost, true)
            // 3) …then remove it again so nothing is visible
            mainHandler.postDelayed({ setEnabled(appCtx, ghost, false) }, GHOST_ON_MS)
            // 4) OEM launchers that still cached the icon get several more
            //    plain disables on a widening schedule. The watchdog repeats
            //    this every 15 minutes, so the icon can never quietly return.
            REASSERT_DELAYS.forEach { delayMs ->
                mainHandler.postDelayed({ setEnabled(appCtx, alias, false) }, delayMs)
            }
        } else {
            setEnabled(appCtx, aliasComponent(appCtx), true)
            setEnabled(appCtx, ghostComponent(appCtx), false)
        }
    }
}
