// useRtcViewer — parent-side WebRTC viewer for remote sessions.
//
// The CHILD always initiates media: it sends an SDP offer over the WebSocket
// (via the Durable Object) once a capture session starts; we answer and both
// sides trickle ICE. Video tracks (screen/camera) attach to `videoRef`,
// audio tracks (ambient listening) attach to `audioRef`.

import { useEffect, useRef, useState, useCallback } from 'react';
import { onRtc, sendRtc } from '../services/ws.js';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function useRtcViewer() {
  const [kind, setKind] = useState(null); // screen | ambient | camera | null
  const [status, setStatus] = useState('idle'); // idle | requested | connecting | live | error
  const [error, setError] = useState('');

  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const kindRef = useRef(null);
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  const teardownPc = useCallback(() => {
    try { pcRef.current && pcRef.current.close(); } catch { /* ignore */ }
    pcRef.current = null;
    try {
      streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop());
    } catch { /* ignore */ }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

  const reset = useCallback((nextStatus = 'idle') => {
    teardownPc();
    kindRef.current = null;
    setKind(null);
    setStatus(nextStatus);
  }, [teardownPc]);

  const ensurePc = useCallback((sessionKind) => {
    teardownPc();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    streamRef.current = new MediaStream();

    pc.ontrack = (ev) => {
      streamRef.current.addTrack(ev.track);
      if (ev.track.kind === 'video' && videoRef.current) {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.play?.().catch(() => { /* autoplay guard */ });
      }
      if (ev.track.kind === 'audio' && audioRef.current) {
        audioRef.current.srcObject = streamRef.current;
        audioRef.current.play?.().catch(() => { /* autoplay guard */ });
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        sendRtc({ kind: sessionKind, action: 'ice', candidate: ev.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') setStatus('live');
      if (s === 'failed' || s === 'closed') {
        if (kindRef.current === sessionKind) {
          setStatus('error');
          setError('Peer connection ' + s);
        }
      }
    };

    pcRef.current = pc;
    return pc;
  }, [teardownPc]);

  // Handle inbound signaling from the child device.
  useEffect(() => onRtc(async (p) => {
    if (!p || !p.action) return;
    const sessionKind = p.kind || 'screen';
    try {
      if (p.action === 'offer') {
        kindRef.current = sessionKind;
        setKind(sessionKind);
        setStatus('connecting');
        setError('');
        const pc = ensurePc(sessionKind);
        await pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendRtc({ kind: sessionKind, action: 'answer', sdp: answer.sdp });
      } else if (p.action === 'ice') {
        if (pcRef.current && p.candidate) {
          await pcRef.current.addIceCandidate(p.candidate).catch(() => { /* late candidate */ });
        }
      } else if (p.action === 'stopped') {
        reset('idle');
      } else if (p.action === 'error') {
        setStatus('error');
        setError(p.message || 'Child device reported a capture error');
      }
    } catch (e) {
      setStatus('error');
      setError(e.message || 'Signaling failed');
    }
  }), [ensurePc, reset]);

  // Mark a session as requested (parent pressed a start button).
  const markRequested = useCallback((sessionKind) => {
    kindRef.current = sessionKind;
    setKind(sessionKind);
    setStatus('requested');
    setError('');
  }, []);

  // The child may switch kinds implicitly by starting a new session.
  const markIdle = useCallback(() => reset('idle'), [reset]);

  useEffect(() => () => teardownPc(), [teardownPc]);

  return { kind, status, error, videoRef, audioRef, markRequested, markIdle, setStatus, setError };
}
