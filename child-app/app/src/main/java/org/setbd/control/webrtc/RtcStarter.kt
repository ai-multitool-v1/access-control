package org.setbd.control.webrtc

import android.content.Context
import android.content.Intent
import android.app.ActivityManager
import android.media.projection.MediaProjectionManager
import org.json.JSONObject
import org.setbd.control.Manifest
import org.setbd.control.R
import org.setbd.control.notifications.NotificationHelper
import androidx.core.content.ContextCompat

/**
 * Decides how a remote capture request is started:
 *  - Screen mirroring ALWAYS goes through the system MediaProjection consent
 *    dialog. The dialog must be user-initiated, so we post a high-priority
 *    notification the child taps to open the consent dialog.
 *  - Ambient audio / camera: started directly when the app is in the
 *    foreground; otherwise a tap-to-allow notification is posted. Ongoing
 *    share state is always visible via the CaptureService notification and
 *    the Android mic/camera indicators.
 */
object RtcStarter {

    private fun isAppForeground(ctx: Context): Boolean {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.runningAppProcesses?.any {
            it.processName == ctx.packageName &&
                it.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
        } == true
    }

    fun requestScreen(ctx: Context): JSONObject {
        NotificationHelper.showCaptureRequest(ctx, WebRtcCore.KIND_SCREEN, null)
        return JSONObject().put("needsConsent", true).put("notified", true)
    }

    fun requestAmbient(ctx: Context): JSONObject {
        val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted) {
            return JSONObject().put("needsPermission", true)
        }
        if (isAppForeground(ctx)) {
            CaptureService.startAmbient(ctx)
            return JSONObject().put("starting", true)
        }
        NotificationHelper.showCaptureRequest(ctx, WebRtcCore.KIND_AMBIENT, null)
        return JSONObject().put("needsTap", true).put("notified", true)
    }

    fun requestCamera(ctx: Context, facing: String): JSONObject {
        val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted) {
            return JSONObject().put("needsPermission", true)
        }
        if (isAppForeground(ctx)) {
            CaptureService.startCamera(ctx, facing)
            return JSONObject().put("starting", true)
        }
        NotificationHelper.showCaptureRequest(ctx, WebRtcCore.KIND_CAMERA, facing)
        return JSONObject().put("needsTap", true).put("notified", true)
    }

    /** Used by MirrorConsentActivity to open the system screen-capture dialog. */
    fun screenCaptureIntent(ctx: Context): Intent? {
        val mpm = ctx.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
        return mpm?.createScreenCaptureIntent()
    }
}
