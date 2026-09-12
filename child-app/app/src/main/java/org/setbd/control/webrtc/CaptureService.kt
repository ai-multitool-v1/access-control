package org.setbd.control.webrtc

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import org.setbd.control.R
import org.setbd.control.notifications.NotificationHelper

/**
 * Foreground service that hosts the active WebRTC capture session.
 * The correct foregroundServiceType is declared per session so Android shows
 * the required system indicators (mic dot / camera dot / cast icon) — the
 * child is never monitored without a visible cue.
 */
class CaptureService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: return START_NOT_STICKY
        when (action) {
            ACTION_SCREEN -> {
                val data: Intent = intent.getParcelableExtra(EXTRA_PROJECTION) ?: return START_NOT_STICKY
                val code = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                goForeground(
                    NotificationHelper.captureNotification(this, getString(R.string.capture_screen_active)),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                )
                WebRtcCore.startScreen(this, data, code)
            }
            ACTION_AMBIENT -> {
                goForeground(
                    NotificationHelper.captureNotification(this, getString(R.string.capture_audio_active)),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                )
                WebRtcCore.startAmbient(this)
            }
            ACTION_CAMERA -> {
                val facing = intent.getStringExtra(EXTRA_FACING) ?: "front"
                goForeground(
                    NotificationHelper.captureNotification(this, getString(R.string.capture_camera_active)),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                )
                WebRtcCore.startCamera(this, facing)
            }
            ACTION_STOP -> WebRtcCore.stopAll()
        }
        return START_NOT_STICKY
    }

    private fun goForeground(notification: Notification, type: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NotificationHelper.CAPTURE_NOTIFICATION_ID, notification, type)
        } else {
            startForeground(NotificationHelper.CAPTURE_NOTIFICATION_ID, notification)
        }
    }

    override fun onDestroy() {
        if (running === this) running = null
        super.onDestroy()
    }

    /** Called by WebRtcCore when the session ended (parent stopped / stream failed). */
    fun onSessionEnded() {
        stopForeground(true)
        stopSelf()
    }

    companion object {
        const val ACTION_SCREEN = "org.setbd.control.webrtc.START_SCREEN"
        const val ACTION_AMBIENT = "org.setbd.control.webrtc.START_AMBIENT"
        const val ACTION_CAMERA = "org.setbd.control.webrtc.START_CAMERA"
        const val ACTION_STOP = "org.setbd.control.webrtc.STOP_ALL"
        const val EXTRA_PROJECTION = "projection"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_FACING = "facing"

        @Volatile
        private var running: CaptureService? = null

        fun startScreen(ctx: Context, projectionData: Intent, resultCode: Int) {
            val i = Intent(ctx, CaptureService::class.java)
                .setAction(ACTION_SCREEN)
                .putExtra(EXTRA_PROJECTION, projectionData)
                .putExtra(EXTRA_RESULT_CODE, resultCode)
            ContextCompat.startForegroundService(ctx, i)
        }

        fun startAmbient(ctx: Context) {
            ContextCompat.startForegroundService(
                ctx, Intent(ctx, CaptureService::class.java).setAction(ACTION_AMBIENT)
            )
        }

        fun startCamera(ctx: Context, facing: String) {
            ContextCompat.startForegroundService(
                ctx,
                Intent(ctx, CaptureService::class.java).setAction(ACTION_CAMERA).putExtra(EXTRA_FACING, facing)
            )
        }

        fun stopAll(ctx: Context) {
            ctx.startService(Intent(ctx, CaptureService::class.java).setAction(ACTION_STOP))
        }

        fun onSessionEnded() {
            running?.onSessionEnded()
        }
    }
}
