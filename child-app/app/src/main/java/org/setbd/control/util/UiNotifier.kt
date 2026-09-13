package org.setbd.control.util

import android.content.Context
import org.setbd.control.R

/** UI-facing helpers shared across packages. */
object UiNotifier {
    /** Parent-facing status text for the child dashboard. */
    fun stateText(ctx: Context, connected: Boolean): String =
        if (connected) ctx.getString(R.string.dash_connected)
        else ctx.getString(R.string.dash_offline)

    fun notifyState(ctx: Context, connected: Boolean) {
        // Reserved hook: dashboards observe RealtimeState directly.
    }
}
