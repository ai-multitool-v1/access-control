package org.setbd.control.webrtc

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CandidatePairChangeEvent
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaProjection
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

/**
 * Owns the ONE active WebRTC session (screen mirror / ambient audio / camera).
 * Signaling rides the existing authenticated WebSocket through the Durable
 * Object — no extra ports, no extra servers. Starting a new session
 * transparently replaces the previous one.
 */
object WebRtcCore {

    private const val TAG = "WebRtcCore"
    const val KIND_SCREEN = "screen"
    const val KIND_AMBIENT = "ambient"
    const val KIND_CAMERA = "camera"

    private var factory: PeerConnectionFactory? = null
    private var eglBase: EglBase? = null
    private var pc: PeerConnection? = null
    private var activeKind: String? = null

    private var screenCapturer: ScreenCapturerAndroid? = null
    private var cameraCapturer: VideoCapturer? = null
    private var videoSource: VideoSource? = null
    private var audioSource: AudioSource? = null
    private var videoTrack: VideoTrack? = null
    private var audioTrack: AudioTrack? = null
    private var helper: SurfaceTextureHelper? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    // ---------- public API (thread-safe; work is posted to main thread) ----------

    fun startScreen(context: Context, projectionData: Intent, resultCode: Int) {
        mainHandler.post { startInternal(context, KIND_SCREEN, projectionData, resultCode, "back") }
    }

    fun startAmbient(context: Context) {
        mainHandler.post { startInternal(context, KIND_AMBIENT, null, 0, "back") }
    }

    fun startCamera(context: Context, facing: String) {
        mainHandler.post { startInternal(context, KIND_CAMERA, null, 0, facing) }
    }

    fun stop(kind: String) {
        mainHandler.post {
            if (kind.isEmpty() || activeKind == kind) teardown(notifyStopped = true)
        }
    }

    fun stopAll() {
        mainHandler.post { if (activeKind != null) teardown(notifyStopped = true) }
    }

    fun handleSignal(context: Context, payload: JSONObject) {
        mainHandler.post {
            try {
                val kind = payload.optString("kind")
                when (payload.optString("action")) {
                    "answer" -> {
                        val conn = pc ?: return@post
                        val sdp = payload.optString("sdp")
                        if (sdp.isNotEmpty()) {
                            conn.setRemoteDescription(
                                SdpCb(),
                                SessionDescription(SessionDescription.Type.ANSWER, sdp)
                            )
                        }
                    }
                    "ice" -> {
                        val conn = pc ?: return@post
                        val c = payload.optJSONObject("candidate") ?: return@post
                        runCatching {
                            conn.addIceCandidate(
                                IceCandidate(
                                    c.optString("sdpMid"),
                                    c.optInt("sdpMLineIndex"),
                                    c.optString("candidate")
                                )
                            )
                        }
                    }
                    "stop" -> {
                        val target = if (kind.isNotEmpty()) kind else activeKind ?: ""
                        if (target.isNotEmpty() && (activeKind == target || activeKind != null)) {
                            teardown(notifyStopped = true)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "handleSignal failed", e)
            }
        }
    }

    // ---------- internals ----------

    private fun ensureFactory(context: Context): PeerConnectionFactory {
        factory?.let { return it }
        if (eglBase == null) eglBase = EglBase.create()
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                .setEnableInternalTracer(false)
                .createInitializationOptions()
        )
        val f = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase!!.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase!!.eglBaseContext))
            .createPeerConnectionFactory()
        factory = f
        return f
    }

    private fun startInternal(
        context: Context,
        kind: String,
        projectionData: Intent?,
        resultCode: Int,
        facing: String
    ) {
        try {
            teardown(notifyStopped = true)
            val f = ensureFactory(context)

            val config = PeerConnection.RTCConfiguration(
                listOf(
                    PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
                    PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
                )
            )
            config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            val connection = f.createPeerConnection(config, PeerObserver(kind))
            if (connection == null) {
                emitError(kind, "peer_connection_failed")
                return
            }
            pc = connection
            activeKind = kind

            when (kind) {
                KIND_SCREEN -> {
                    val data = projectionData
                    if (data == null) {
                        emitError(kind, "missing_projection")
                        teardown(notifyStopped = false)
                        return
                    }
                    val capturer = ScreenCapturerAndroid(data, object : MediaProjection.Callback() {
                        override fun onStop() {
                            mainHandler.post { if (activeKind == KIND_SCREEN) teardown(notifyStopped = true) }
                        }
                    })
                    screenCapturer = capturer
                    val source = f.createVideoSource(true) // screencast
                    videoSource = source
                    helper = SurfaceTextureHelper.create("ac-screen", eglBase!!.eglBaseContext)
                    capturer.initialize(helper, context, source.capturerObserver)
                    capturer.startCapture(720, 1280, 15)
                    val track = f.createVideoTrack("screen0", source)
                    videoTrack = track
                    connection.addTrack(track, listOf("ac"))
                }

                KIND_AMBIENT -> {
                    val source = f.createAudioSource(MediaConstraints())
                    audioSource = source
                    val track = f.createAudioTrack("ambient0", source)
                    audioTrack = track
                    connection.addTrack(track, listOf("ac"))
                }

                KIND_CAMERA -> {
                    val enumerator = Camera2Enumerator(context)
                    val front = facing == "front"
                    val name = pickCamera(enumerator, front)
                    if (name == null) {
                        emitError(kind, "no_camera")
                        teardown(notifyStopped = false)
                        return
                    }
                    val capturer = enumerator.createCapturer(name, null)
                    if (capturer == null) {
                        emitError(kind, "camera_open_failed")
                        teardown(notifyStopped = false)
                        return
                    }
                    cameraCapturer = capturer
                    val source = f.createVideoSource(false)
                    videoSource = source
                    helper = SurfaceTextureHelper.create("ac-camera", eglBase!!.eglBaseContext)
                    capturer.initialize(helper, context, source.capturerObserver)
                    capturer.startCapture(1280, 720, 20)
                    val track = f.createVideoTrack("cam0", source)
                    videoTrack = track
                    connection.addTrack(track, listOf("ac"))
                }
            }

            connection.createOffer(object : SdpObserver {
                override fun onCreateSuccess(desc: SessionDescription) {
                    connection.setLocalDescription(SdpCb(), desc)
                    RtcBridge.sendRtc(kind, "offer") { put("sdp", desc.description) }
                }

                override fun onSetSuccess() {}
                override fun onCreateFailure(error: String?) {
                    emitError(kind, "offer_failed")
                }

                override fun onSetFailure(error: String?) {}
            }, MediaConstraints())
        } catch (e: Exception) {
            Log.w(TAG, "start failed", e)
            emitError(kind, e.message ?: "start_failed")
            teardown(notifyStopped = true)
        }
    }

    private fun pickCamera(enumerator: Camera2Enumerator, front: Boolean): String? {
        val names = enumerator.deviceNames
        for (n in names) {
            if (front && enumerator.isFrontFacing(n)) return n
            if (!front && enumerator.isBackFacing(n)) return n
        }
        return names.firstOrNull()
    }

    private fun teardown(notifyStopped: Boolean) {
        val endedKind = activeKind
        runCatching { screenCapturer?.stopCapture() }
        runCatching { cameraCapturer?.stopCapture() }
        runCatching { screenCapturer?.dispose() }
        runCatching { cameraCapturer?.dispose() }
        screenCapturer = null
        cameraCapturer = null
        runCatching { videoTrack?.dispose() }
        runCatching { audioTrack?.dispose() }
        videoTrack = null
        audioTrack = null
        runCatching { videoSource?.dispose() }
        runCatching { audioSource?.dispose() }
        videoSource = null
        audioSource = null
        runCatching { helper?.dispose() }
        helper = null
        runCatching { pc?.close() }
        runCatching { pc?.dispose() }
        pc = null
        activeKind = null
        if (notifyStopped && endedKind != null) {
            RtcBridge.sendRtc(endedKind, "stopped") {}
            RtcBridge.sendCaptureState(endedKind, "stopped")
            CaptureService.onSessionEnded()
        }
    }

    private fun emitError(kind: String, message: String) {
        RtcBridge.sendRtc(kind, "error") { put("message", message) }
        RtcBridge.sendCaptureState(kind, "error")
    }

    // ---------- WebRTC observers ----------

    private open class SdpCb : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription?) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String?) {}
        override fun onSetFailure(error: String?) {}
    }

    private class PeerObserver(private val kind: String) : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) {
            RtcBridge.sendRtc(kind, "ice") {
                put(
                    "candidate",
                    JSONObject()
                        .put("sdpMid", candidate.sdpMid)
                        .put("sdpMLineIndex", candidate.sdpMLineIndex)
                        .put("candidate", candidate.sdp)
                )
            }
        }

        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
            when (newState) {
                PeerConnection.PeerConnectionState.CONNECTED ->
                    RtcBridge.sendCaptureState(kind, "active")
                PeerConnection.PeerConnectionState.FAILED,
                PeerConnection.PeerConnectionState.CLOSED ->
                    mainHandler.postDelayed(
                        { if (activeKind == kind) teardown(notifyStopped = true) },
                        1500
                    )
                else -> {}
            }
        }

        override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {}
        override fun onStandardizedIceConnectionChange(state: PeerConnection.IceConnectionState?) {}
        override fun onIceConnectionReceivingChange(receiving: Boolean) {}
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
        override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent?) {}
        override fun onAddStream(stream: MediaStream?) {}
        override fun onRemoveStream(stream: MediaStream?) {}
        override fun onDataChannel(channel: org.webrtc.DataChannel?) {}
        override fun onRenegotiationNeeded() {}
        override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {}
        override fun onRemoveTrack(receiver: RtpReceiver?) {}
        override fun onTrack(transceiver: RtpTransceiver?) {}
    }
}
