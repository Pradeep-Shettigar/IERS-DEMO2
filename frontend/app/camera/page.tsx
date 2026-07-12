"use client";

import { useRef, useState, useCallback, useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const FRAME_INTERVAL_MS = 500;
const CONFIDENCE = 0.6;

export default function CameraSender() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [framesSent, setFramesSent] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSessionId(params.get("session"));
  }, []);

  const sendFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !sessionId || video.paused || video.ended) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const form = new FormData();
      form.append("file", blob, "frame.jpg");
      try {
        const res = await fetch(`${API_URL}/session/${sessionId}/frame?confidence=${CONFIDENCE}`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        setFramesSent((n) => n + 1);
        setError(null);
      } catch (e: any) {
        setError(e.message || "Failed to send frame");
      }
    }, "image/jpeg", 0.85);
  }, [sessionId]);

  const startCamera = useCallback(async () => {
    setError(null);
    if (!sessionId) {
      setError("No session found in link — ask for a fresh link from the control panel.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
      intervalRef.current = setInterval(sendFrame, FRAME_INTERVAL_MS);
    } catch (e: any) {
      setError("Could not access camera — check browser permissions.");
    }
  }, [sessionId, sendFrame]);

  const stopCamera = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <main className="min-h-screen bg-ink px-4 py-8 flex flex-col items-center">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-signal mb-2">
        Shelf Watch — Camera
      </p>
      <h1 className="font-display text-2xl font-bold mb-1 text-center">Remote camera</h1>
      <p className="text-muted text-sm mb-6 text-center max-w-xs">
        Point this device at the shelf. It streams to your control panel — no need to watch this screen.
      </p>

      {!sessionId && (
        <p className="text-sold font-mono text-sm text-center">
          No session found in this link. Open the link generated on your control panel's{" "}
          <code>/monitor</code> page.
        </p>
      )}

      <div className="relative w-full max-w-sm border border-line bg-panel">
        <video ref={videoRef} muted playsInline className="w-full" />
        {streaming && (
          <span className="absolute top-2 right-2 flex items-center gap-1.5 bg-ink/80 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-sold">
            <span className="w-1.5 h-1.5 rounded-full bg-sold animate-pulse" />
            Streaming
          </span>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      <div className="flex gap-3 mt-4 w-full max-w-sm">
        <button
          onClick={startCamera}
          disabled={streaming || !sessionId}
          className="flex-1 bg-signal text-ink font-body font-semibold py-3 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Start streaming
        </button>
        <button
          onClick={stopCamera}
          disabled={!streaming}
          className="flex-1 border border-line text-paper font-body font-semibold py-3 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Stop
        </button>
      </div>

      {streaming && (
        <p className="mt-3 font-mono text-xs text-muted">{framesSent} frames sent</p>
      )}
      {error && <p className="mt-3 text-sm text-sold font-mono text-center">{error}</p>}
    </main>
  );
}
