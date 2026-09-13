package org.setbd.control.webrtc

import android.content.Intent
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * Thin trampoline activity:
 *  - "screen": opens the system MediaProjection consent dialog and forwards
 *    the consent result to CaptureService (foreground service must be running
 *    before the projection is created on Android 14+).
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
        val kind = intent.getStringExtra(EXTRA_KIND) ?: "screen"
        when (kind) {
            WebRtcCore.KIND_SCREEN -> {
                val dialog = RtcStarter.screenCaptureIntent(this)
                if (dialog == null) {
                    finish()
                } else {
                    projectionLauncher.launch(dialog)
                }
            }
            WebRtcCore.KIND_AMBIENT -> {
                CaptureService.startAmbient(this)
                finish()
            }
            WebRtcCore.KIND_CAMERA -> {
                CaptureService.startCamera(this, intent.getStringExtra(EXTRA_FACING) ?: "front")
                finish()
            }
            else -> finish()
        }
    }

    companion object {
        const val EXTRA_KIND = "kind"
        const val EXTRA_FACING = "facing"

        fun intent(context: android.content.Context, kind: String, facing: String?): Intent =
            Intent(context, MirrorConsentActivity::class.java)
                .putExtra(EXTRA_KIND, kind)
                .putExtra(EXTRA_FACING, facing ?: "front")
    }
}
