package org.setbd.control.util

import android.content.Context
import android.content.Intent
import android.os.Build
import org.setbd.control.controls.PolicyEnforcerService
import org.setbd.control.websocket.RealtimeService

/** Single place that starts the two foreground services safely across API levels. */
object ServiceLauncher {

    fun startAll(context: Context) {
        startRealtime(context)
        startEnforcer(context)
    }

    fun startRealtime(context: Context) {
        val intent = Intent(context, RealtimeService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    fun startEnforcer(context: Context) {
        val intent = Intent(context, PolicyEnforcerService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }
}
