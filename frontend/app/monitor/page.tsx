"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const POLL_INTERVAL_MS = 700;

type Counts = Record<string, number>;
type Box = { class: string; bbox: [number, number, number, number] };

function CountTile({ label, value, tone }: { label: string; value: number; tone: "live" | "sold" }) {
  const digits = String(value).padStart(2, "0").split("");
  const toneClass = tone === "live" ? "text-live border-live/40" : "text-sold border-sold/40";
  return (
    <div className="flex items-center justify-between border border-line bg-panel px-4 py-3">
      <span className="font-body text-sm text-muted uppercase tracking-wide">{label}</span>
      <div className="flex gap-1">
        {digits.map((d, i) => (
          <span
            key={i}
            className={`font-mono text-2xl tabular w-8 h-10 flex items-center justify-center border ${toneClass} bg-ink`}
          >
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Monitor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cameraUrl, setCameraUrl] = useState<string>("");
  const [liveCounts, setLiveCounts] = useState<Counts>({});
  const [soldCounts, setSoldCounts] = useState<Counts>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);

  const allClasses = Array.from(new Set([...Object.keys(liveCounts), ...Object.keys(soldCounts)]));

  const drawBoxes = useCallback((boxes: Box[], imgW: number, imgH: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = imgW;
    canvas.height = imgH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, imgW, imgH);
    ctx.lineWidth = 3;
    ctx.font = "16px monospace";
    boxes.forEach((b) => {
      const [x1, y1, x2, y2] = b.bbox;
      ctx.strokeStyle = "#7FB069";
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.fillStyle = "#7FB069";
      ctx.fillText(b.class, x1 + 4, y1 > 18 ? y1 - 6 : y1 + 18);
    });
  }, []);

  const poll = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/session/${id}/status`);
      if (!res.ok) throw new Error(`Status error: ${res.status}`);
      const data = await res.json();
      setLiveCounts(data.live_counts || {});
      setSoldCounts(data.sold_counts || {});
      setError(null);

      if (data.frame_jpg_base64) {
        setFrameSrc(`data:image/jpeg;base64,${data.frame_jpg_base64}`);
        // wait a tick for the <img> to update its natural size, then draw boxes
        requestAnimationFrame(() => {
          const img = imgRef.current;
          if (img && img.naturalWidth) {
            drawBoxes(data.boxes || [], img.naturalWidth, img.naturalHeight);
          }
        });
      }
    } catch (e: any) {
      setError(e.message || "Could not reach backend");
    }
  }, [drawBoxes]);

  const startMonitoring = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/session/new?missing_threshold=4`, { method: "POST" });
      if (!res.ok) throw new Error("Could not reach backend");
      const data = await res.json();
      setSessionId(data.session_id);
      setLiveCounts({});
      setSoldCounts({});
      setFrameSrc(null);

      const origin = window.location.origin;
      setCameraUrl(`${origin}/camera?session=${data.session_id}`);

      pollRef.current = setInterval(() => poll(data.session_id), POLL_INTERVAL_MS);
    } catch (e: any) {
      setError(e.message || "Failed to start monitoring");
    }
  }, [poll]);

  const stopMonitoring = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (sessionId) {
      fetch(`${API_URL}/session/${sessionId}`, { method: "DELETE" }).catch(() => {});
    }
    setSessionId(null);
    setCameraUrl("");
    setFrameSrc(null);
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const copyLink = () => {
    navigator.clipboard.writeText(cameraUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <main className="min-h-screen bg-ink px-6 py-10 md:px-14">
      <header className="mb-10 border-b border-line pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-signal mb-2">
          Shelf Watch — Monitor
        </p>
        <h1 className="font-display text-3xl md:text-4xl font-bold leading-tight">
          Control panel
        </h1>
        <p className="text-muted mt-2 max-w-lg">
          Start monitoring, then open the generated link on a phone to use it as a remote camera.
          This screen updates live from whatever the phone sees.
        </p>
      </header>

      {!sessionId ? (
        <button
          onClick={startMonitoring}
          className="bg-signal text-ink font-body font-semibold px-6 py-3 hover:brightness-110 transition"
        >
          Start monitoring
        </button>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8">
          <section className="border border-line bg-panel p-4">
            <div className="mb-4 border border-line bg-ink p-3">
              <p className="font-mono text-xs uppercase tracking-wide text-muted mb-2">
                Camera link — open on your phone
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={cameraUrl}
                  className="flex-1 bg-panel border border-line px-3 py-2 text-sm font-mono text-paper"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={copyLink}
                  className="border border-line px-4 text-sm font-mono hover:border-signal transition"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="relative bg-black min-h-[200px] flex items-center justify-center">
              {frameSrc ? (
                <>
                  <img ref={imgRef} src={frameSrc} alt="Live feed" className="w-full" />
                  <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                </>
              ) : (
                <p className="text-muted text-sm font-mono py-16">Waiting for camera to connect…</p>
              )}
            </div>

            <button
              onClick={stopMonitoring}
              className="w-full mt-4 border border-line text-paper font-body font-semibold py-2 hover:border-sold hover:text-sold transition"
            >
              Stop monitoring
            </button>

            {error && <p className="mt-3 text-sm text-sold font-mono">{error}</p>}
          </section>

          <section className="flex flex-col gap-6">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted mb-3">
                On shelf now
              </p>
              <div className="flex flex-col gap-2">
                {allClasses.length === 0 && (
                  <p className="text-sm text-muted italic">No products tracked yet.</p>
                )}
                {allClasses.map((cls) => (
                  <CountTile key={`live-${cls}`} label={cls} value={liveCounts[cls] || 0} tone="live" />
                ))}
              </div>
            </div>

            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted mb-3">
                Sold (left frame)
              </p>
              <div className="flex flex-col gap-2">
                {allClasses.length === 0 && (
                  <p className="text-sm text-muted italic">Nothing sold yet.</p>
                )}
                {allClasses.map((cls) => (
                  <CountTile key={`sold-${cls}`} label={cls} value={soldCounts[cls] || 0} tone="sold" />
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
