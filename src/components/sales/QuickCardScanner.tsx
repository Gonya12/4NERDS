import { Camera, ImagePlus, LoaderCircle, RotateCcw, ScanLine, SwitchCamera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { compressSaleImage } from "../../services/images/saleImageService";
import { scanPokemonCard, type CardScanSuggestion } from "../../services/sales/cardScanService";

type Props = {
  onClose: () => void;
  onApply: (file: File, suggestion?: CardScanSuggestion, hash?: string) => void;
};

const stages = ["Preparing image", "Reading card name", "Reading card number", "Checking sticker", "Matching card information", "Preparing suggestions"];

export function QuickCardScanner({ onClose, onApply }: Props) {
  const [mode, setMode] = useState<"camera" | "review">("camera");
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [suggestion, setSuggestion] = useState<CardScanSuggestion>();
  const [hash, setHash] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(0);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }

  async function startCamera(nextFacing = facing) {
    stopCamera();
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera is not available here. Use Upload from Gallery instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: nextFacing } }, audio: false });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("Camera preview is unavailable.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setReady(true);
    } catch (cameraError) {
      stopCamera();
      setError(cameraError instanceof DOMException && cameraError.name === "NotAllowedError"
        ? "Camera permission was denied. Enable access or upload a card image."
        : "Camera could not start. It may be in use by another app; upload an image instead.");
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => void startCamera("environment"));
    return () => { cancelAnimationFrame(frame); runRef.current += 1; stopCamera(); if (preview.startsWith("blob:")) URL.revokeObjectURL(preview); };
  }, []);

  async function analyze(image: File, force = false) {
    const run = ++runRef.current;
    setAnalyzing(true); setSuggestion(undefined); setError(""); setStage(0);
    const timer = window.setInterval(() => setStage((current) => Math.min(stages.length - 1, current + 1)), 850);
    try {
      const result = await scanPokemonCard(image, "raw_card", undefined, force);
      if (run !== runRef.current) return;
      setSuggestion(result.suggestion); setHash(result.hash);
    } catch (scanError) {
      if (run === runRef.current) setError(scanError instanceof Error ? scanError.message : "Card analysis failed.");
    } finally {
      clearInterval(timer);
      if (run === runRef.current) setAnalyzing(false);
    }
  }

  async function useFile(source: File) {
    try {
      const prepared = await compressSaleImage(source);
      stopCamera();
      if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
      setFile(prepared); setPreview(URL.createObjectURL(prepared)); setMode("review");
      void analyze(prepared);
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Could not prepare this image.");
    }
  }

  async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setError("Camera is still starting. Try again in a moment."); return;
    }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) { setError("Could not capture the photo."); return; }
    await useFile(new File([blob], `card-scan-${Date.now()}.jpg`, { type: "image/jpeg" }));
  }

  async function switchCamera() {
    if (switching) return;
    setSwitching(true);
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    try { await startCamera(next); } finally { setSwitching(false); }
  }

  function retake() {
    runRef.current += 1;
    if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    setPreview(""); setFile(undefined); setSuggestion(undefined); setError(""); setMode("camera");
    requestAnimationFrame(() => void startCamera(facing));
  }

  const edit = (key: keyof CardScanSuggestion, value: string | number | null) => setSuggestion((current) => current ? { ...current, [key]: value } : current);

  return <div className="fixed inset-0 z-[100] overflow-hidden bg-black text-white">
    {mode === "camera" ? <>
      <video ref={videoRef} playsInline muted className="absolute inset-0 size-full object-cover" />
      <div className="pointer-events-none absolute inset-[15%_8%_22%] rounded-[2rem] border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.18)]"><span className="absolute -top-7 left-0 text-xs font-bold">Align one card inside the frame</span></div>
      <header className="absolute inset-x-0 top-0 flex items-center justify-between p-[calc(1rem+env(safe-area-inset-top))_1rem_1rem]"><button onClick={onClose} className="rounded-full bg-black/55 p-3" aria-label="Cancel scanner"><X /></button><button onClick={() => void switchCamera()} disabled={!ready || switching} className="rounded-full bg-black/55 p-3 disabled:opacity-40" aria-label="Switch camera"><SwitchCamera /></button></header>
      {error ? <p className="absolute left-4 right-4 top-24 rounded-xl bg-rose-950/90 p-3 text-center text-sm font-bold">{error}</p> : null}
      <div className="absolute inset-x-0 bottom-0 grid grid-cols-3 items-center bg-gradient-to-t from-black/90 to-transparent px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-16">
        <label className="justify-self-start rounded-full bg-black/55 p-3" aria-label="Upload from gallery"><ImagePlus /><input type="file" accept="image/*" hidden onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void useFile(selected); }} /></label>
        <button onClick={() => void capture()} disabled={!ready} aria-label="Capture card" className="size-20 justify-self-center rounded-full border-[6px] border-white bg-coral shadow-[0_0_0_4px_rgba(244,93,19,0.55)] transition active:scale-90 disabled:opacity-40"><Camera className="mx-auto" size={28} /></button>
        <span />
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </> : <div className="h-full overflow-y-auto bg-slate-950 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <header className="mx-auto flex max-w-2xl items-center justify-between"><div><p className="text-xs font-black uppercase tracking-wide text-coral">Card scan review</p><h2 className="text-xl font-black">Review detected information</h2></div><button onClick={onClose} className="rounded-full bg-white/10 p-3"><X /></button></header>
      <main className="mx-auto mt-4 max-w-2xl space-y-4">
        {preview ? <img src={preview} alt="Captured card" className="max-h-[46vh] w-full rounded-2xl bg-black object-contain" /> : null}
        {analyzing ? <div className="rounded-2xl bg-violet-950 p-4"><LoaderCircle className="mr-2 inline animate-spin" /><strong>{stages[stage]}</strong><button onClick={() => { runRef.current += 1; setAnalyzing(false); }} className="float-right text-xs font-bold text-rose-300">Cancel Analysis</button></div> : null}
        {error ? <div className="rounded-2xl bg-rose-950/60 p-4 text-sm font-bold">{error}<div className="mt-3 flex gap-2">{file ? <button onClick={() => void analyze(file, true)} className="rounded-xl bg-white px-3 py-2 text-slate-950">Retry</button> : null}<button onClick={retake} className="rounded-xl bg-white/10 px-3 py-2">Retake</button></div></div> : null}
        {suggestion ? <section className="space-y-3 rounded-2xl bg-white p-4 text-slate-950"><div className="grid gap-3 sm:grid-cols-2">{([
          ["cardName", "Card Name"], ["collectorNumber", "Collector Number"], ["cardSet", "Set"], ["language", "Language"], ["condition", "Condition"], ["stickerPrice", "Sticker Price"]
        ] as const).map(([key, label]) => <label key={key} className="text-xs font-black">{label}<span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px]">{suggestion.fieldConfidence[key] || "low"}</span><input type={key === "stickerPrice" ? "number" : "text"} min={key === "stickerPrice" ? 0 : undefined} step={key === "stickerPrice" ? "0.01" : undefined} value={suggestion[key] ?? ""} onChange={(event) => edit(key, key === "stickerPrice" ? (event.target.value ? Number(event.target.value) : null) : event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-base" /></label>)}</div><p className="text-xs text-slate-500">Suggestions are not saved until you review the inventory form and press Save.</p></section> : null}
        <div className="grid grid-cols-2 gap-2"><button onClick={retake} className="min-h-12 rounded-xl bg-white/10 font-black"><RotateCcw className="mr-1 inline" /> Retake</button>{file && !analyzing ? <button onClick={() => void analyze(file, Boolean(suggestion))} className="min-h-12 rounded-xl bg-violet-600 font-black"><ScanLine className="mr-1 inline" />{suggestion ? "Rescan" : "Analyze Card"}</button> : null}{file && !analyzing ? <button onClick={() => onApply(file, suggestion, hash || undefined)} className="col-span-2 min-h-12 rounded-xl bg-coral font-black">{suggestion ? "Apply to Inventory Draft" : "Use Photo and Enter Manually"}</button> : null}</div>
      </main>
    </div>}
  </div>;
}
