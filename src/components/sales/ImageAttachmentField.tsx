import {
  ArrowDown, ArrowUp, Camera, Check, ImagePlus, LoaderCircle, RefreshCcw,
  Replace, RotateCcw, SwitchCamera, Trash2, Upload, X
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { isSupportedSaleImage, type ImageUploadStage } from "../../services/images/saleImageService";
import type { TransactionImageAttachment, TransactionImageType } from "../../types/models";
import { ImageLightbox } from "./ImageLightbox";
import { AppButton, ResponsiveModal } from "./SalesDashboardPrimitives";

type UploadJob = {
  id: string;
  file: File;
  previewUrl: string;
  stage: ImageUploadStage | "failed";
  error?: string;
  slow?: boolean;
  replaceId?: string;
};

type Props = {
  label: string;
  description?: string;
  attachments: TransactionImageAttachment[];
  imageType: TransactionImageType;
  transactionId: string;
  transactionItemId?: string;
  multiple?: boolean;
  maxImages?: number;
  reusableAttachment?: TransactionImageAttachment;
  reusableLabel?: string;
  onUpload: (file: File, imageType: TransactionImageType, onProgress: (stage: ImageUploadStage) => void) => Promise<TransactionImageAttachment>;
  onChange: (attachments: TransactionImageAttachment[]) => void | Promise<void>;
  onBusyChange?: (fieldId: string, busy: boolean) => void;
};

const stageLabels: Record<ImageUploadStage | "failed", string> = {
  preparing: "Preparing",
  compressing: "Compressing",
  uploading: "Uploading",
  saving: "Saving",
  complete: "Complete",
  failed: "Failed"
};

function cameraMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (!window.isSecureContext) return "Live camera needs a secure connection. The device camera picker is still available.";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera permission was denied. You can allow it in browser settings or use the device camera picker.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No compatible camera was found. Use Gallery or the device camera picker.";
  if (name === "NotReadableError" || name === "AbortError") return "The camera may already be in use by another app. Close it there and retry.";
  return "Live camera is unavailable in this browser. Use Gallery or the device camera picker.";
}

export function ImageAttachmentField({
  label, description, attachments, imageType, transactionId, transactionItemId, multiple = false,
  maxImages = multiple ? 8 : 1, reusableAttachment, reusableLabel = "Use group photo", onUpload, onChange, onBusyChange
}: Props) {
  const fieldId = useId();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraFallbackRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const latestAttachments = useRef(attachments);
  const jobsRef = useRef<UploadJob[]>([]);
  const cancelledJobs = useRef(new Set<string>());
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [replaceId, setReplaceId] = useState<string>();
  const [message, setMessage] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number>();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [captured, setCaptured] = useState<{ file: File; url: string }>();
  const [cropOpen, setCropOpen] = useState(false);
  const [cropX, setCropX] = useState(50);
  const [cropY, setCropY] = useState(50);
  const [cropZoom, setCropZoom] = useState(2);
  const [cropBusy, setCropBusy] = useState(false);

  useEffect(() => { latestAttachments.current = attachments; }, [attachments]);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  useEffect(() => () => jobsRef.current.forEach((job) => URL.revokeObjectURL(job.previewUrl)), []);
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (captured?.url) URL.revokeObjectURL(captured.url);
  }, [captured?.url]);

  async function commit(next: TransactionImageAttachment[]) {
    const ordered = next.slice(0, maxImages).map((image, index) => ({
      ...image,
      transactionId,
      transactionItemId,
      imageType,
      sortOrder: index
    }));
    latestAttachments.current = ordered;
    await onChange(ordered);
  }

  function updateJob(jobId: string, patch: Partial<UploadJob>) {
    setJobs((current) => current.map((job) => job.id === jobId ? { ...job, ...patch } : job));
  }

  function removeJob(jobId: string) {
    cancelledJobs.current.add(jobId);
    setJobs((current) => {
      const target = current.find((job) => job.id === jobId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((job) => job.id !== jobId);
    });
  }

  async function uploadFile(file: File, targetId?: string) {
    if (!isSupportedSaleImage(file)) {
      setMessage(`${file.name || "That file"} is not an image.`);
      return;
    }
    const jobId = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);
    const job: UploadJob = { id: jobId, file, previewUrl, stage: "preparing", replaceId: targetId };
    setJobs((current) => [...current, job]);
    setMessage("");
    const slowTimer = window.setTimeout(() => updateJob(jobId, { slow: true }), 3_000);
    let timeoutTimer = 0;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutTimer = window.setTimeout(() => reject(new Error("The image upload timed out. Retry this image when your connection is ready.")), 45_000);
      });
      const uploaded = await Promise.race([
        onUpload(file, imageType, (stage) => updateJob(jobId, { stage: stage === "complete" ? "saving" : stage })),
        timeout
      ]);
      if (cancelledJobs.current.has(jobId)) return;
      const current = latestAttachments.current;
      const next = targetId
        ? current.map((image) => image.id === targetId ? { ...uploaded, id: targetId } : image)
        : multiple ? [...current, uploaded] : [uploaded];
      await commit(next);
      updateJob(jobId, { stage: "complete", slow: false });
      window.setTimeout(() => removeJob(jobId), 650);
    } catch (error) {
      updateJob(jobId, { stage: "failed", slow: false, error: error instanceof Error ? error.message : "Image upload failed." });
    } finally {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeoutTimer);
    }
  }

  async function processFiles(files: FileList | File[], targetId = replaceId) {
    const selected = Array.from(files);
    setReplaceId(undefined);
    if (!selected.length) return;
    const room = targetId ? 1 : Math.max(0, maxImages - latestAttachments.current.length);
    const accepted = selected.slice(0, multiple ? room : 1);
    if (!accepted.length) {
      setMessage(`This field allows up to ${maxImages} image${maxImages === 1 ? "" : "s"}.`);
      return;
    }
    for (const file of accepted) await uploadFile(file, targetId);
  }

  function chooseReplacement(id: string) {
    setReplaceId(id);
    galleryRef.current?.click();
  }

  async function useReusable() {
    if (!reusableAttachment) return;
    const clone: TransactionImageAttachment = {
      ...reusableAttachment,
      id: crypto.randomUUID(),
      transactionId,
      transactionItemId,
      imageType,
      sortOrder: latestAttachments.current.length
    };
    await commit(multiple ? [...latestAttachments.current, clone] : [clone]);
    setMessage("The existing transaction photo is linked to this item without uploading another file.");
  }

  async function useCroppedReusable() {
    if (!reusableAttachment) return;
    setCropBusy(true);
    let bitmap: ImageBitmap | undefined;
    try {
      const response = await fetch(reusableAttachment.imageUrl);
      if (!response.ok) throw new Error("The shared photo could not be loaded for cropping.");
      const source = await response.blob();
      bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
      const cropSize = Math.max(1, Math.min(bitmap.width, bitmap.height) / cropZoom);
      const sourceX = Math.max(0, Math.min(bitmap.width - cropSize, bitmap.width * cropX / 100 - cropSize / 2));
      const sourceY = Math.max(0, Math.min(bitmap.height - cropSize, bitmap.height * cropY / 100 - cropSize / 2));
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1200;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not prepare the crop.");
      context.drawImage(bitmap, sourceX, sourceY, cropSize, cropSize, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The crop could not be created.")), "image/jpeg", 0.9));
      setCropOpen(false);
      await processFiles([new File([blob], `cropped-item-${Date.now()}.jpg`, { type: "image/jpeg" })]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The shared photo could not be cropped.");
    } finally {
      bitmap?.close();
      setCropBusy(false);
    }
  }

  async function readClipboard() {
    try {
      if (!navigator.clipboard?.read) throw new Error("Clipboard image access is not available.");
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const type = item.types.find((value) => value.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        await processFiles([new File([blob], `pasted-image-${Date.now()}`, { type })]);
        return;
      }
      throw new Error("The clipboard does not contain an image.");
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "Clipboard access was blocked."} Press Ctrl+V here or use Choose From Gallery.`);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLElement>) {
    const file = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
    if (!file) return;
    event.preventDefault();
    void processFiles([file]);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (event.dataTransfer.files.length) void processFiles(event.dataTransfer.files);
    else {
      setMessage("No image was found in that drop. Use Choose From Gallery.");
      galleryRef.current?.click();
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function closeCamera() {
    stopCamera();
    setCameraOpen(false);
    setCameraBusy(false);
    if (captured?.url) URL.revokeObjectURL(captured.url);
    setCaptured(undefined);
  }

  async function startCamera(nextFacing = facingMode) {
    setCameraOpen(true);
    setCameraBusy(true);
    setMessage("");
    stopCamera();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("Camera unavailable", "NotSupportedError");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      setMessage(cameraMessage(error));
      closeCamera();
      window.setTimeout(() => cameraFallbackRef.current?.click(), 0);
    } finally {
      setCameraBusy(false);
    }
  }

  function takePicture() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setMessage("The camera is still starting. Wait a moment and try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      stopCamera();
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      setCaptured({ file, url: URL.createObjectURL(file) });
    }, "image/jpeg", 0.92);
  }

  async function useCaptured() {
    if (!captured) return;
    const file = captured.file;
    closeCamera();
    await processFiles([file]);
  }

  const canAdd = attachments.length < maxImages;
  const active = jobs.some((job) => job.stage !== "failed" && job.stage !== "complete");
  useEffect(() => {
    onBusyChange?.(fieldId, active);
    return () => onBusyChange?.(fieldId, false);
  }, [active, fieldId, onBusyChange]);
  const preview = previewIndex === undefined ? undefined : attachments[previewIndex];

  return <section
    className="sm:col-span-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-950/45"
    onPaste={onPaste}
    onDragOver={(event) => event.preventDefault()}
    onDrop={onDrop}
    tabIndex={0}
    aria-label={`${label} image attachment area`}
  >
    <div>
      <h3 className="text-sm font-black text-slate-950 dark:text-white">{label}</h3>
      {description ? <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p> : null}
    </div>
    <input
      ref={galleryRef}
      type="file"
      accept="image/*"
      multiple={multiple}
      className="sr-only"
      aria-label={`Choose ${label} from gallery`}
      onChange={(event) => { if (event.target.files) void processFiles(event.target.files); event.target.value = ""; }}
    />
    <input
      ref={cameraFallbackRef}
      type="file"
      accept="image/*"
      capture="environment"
      className="sr-only"
      aria-label={`Take ${label} photo with device camera`}
      onChange={(event) => { if (event.target.files) void processFiles(event.target.files); event.target.value = ""; }}
    />
    <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <AppButton type="button" variant="secondary" disabled={!canAdd || active} onClick={() => galleryRef.current?.click()} className="min-h-11 px-2 text-xs">
        <Upload size={16} /> Choose From Gallery
      </AppButton>
      <AppButton type="button" variant="secondary" disabled={!canAdd || active} onClick={() => void startCamera("environment")} className="min-h-11 px-2 text-xs">
        <Camera size={16} /> Take Photo
      </AppButton>
      <AppButton type="button" variant="ghost" disabled={!canAdd || active} onClick={() => void readClipboard()} className="min-h-11 px-2 text-xs">
        <ImagePlus size={16} /> Paste Image
      </AppButton>
      {reusableAttachment ? <AppButton type="button" variant="ghost" disabled={!canAdd || active} onClick={() => void useReusable()} className="min-h-11 px-2 text-xs">
        <RefreshCcw size={16} /> {reusableLabel}
      </AppButton> : <div className="hidden items-center justify-center rounded-xl border border-dashed border-slate-300 px-2 text-center text-[11px] font-bold text-slate-400 lg:flex dark:border-slate-700">or drag &amp; drop</div>}
    </div>
    {reusableAttachment && canAdd ? <button type="button" onClick={() => setCropOpen(true)} className="mt-2 min-h-11 rounded-xl px-3 text-xs font-black text-violet-700 outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300">Crop the group photo for this item</button> : null}
    {message ? <p className="mt-2 rounded-xl bg-amber-50 p-2 text-xs font-bold text-amber-800 dark:bg-amber-950/35 dark:text-amber-200" role="status">{message}</p> : null}

    {jobs.length ? <div className="mt-3 space-y-2" aria-live="polite">
      {jobs.map((job) => <article key={job.id} className={`flex items-center gap-3 rounded-xl border p-2 ${job.stage === "failed" ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/25" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
        <img src={job.previewUrl} alt={`Preview of ${job.file.name || label}`} className="size-14 shrink-0 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-black">{job.file.name || "Camera photo"}</p>
          <p className={`mt-0.5 text-xs font-bold ${job.stage === "failed" ? "text-rose-600" : "text-violet-600"}`}>
            {job.slow ? "Still uploading your image…" : stageLabels[job.stage]}
          </p>
          {job.error ? <p className="mt-1 text-xs leading-4 text-rose-600">{job.error}</p> : null}
          {job.stage !== "failed" && job.stage !== "complete" ? <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><span className="block h-full w-2/3 animate-pulse rounded-full bg-violet-500" /></div> : null}
        </div>
        {job.stage === "failed" ? <button type="button" onClick={() => { removeJob(job.id); void uploadFile(job.file, job.replaceId); }} className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-black text-violet-700"><RotateCcw size={15} /> Retry</button> : <LoaderCircle size={18} className={job.stage === "complete" ? "text-emerald-500" : "animate-spin text-violet-500"} />}
        <button type="button" onClick={() => removeJob(job.id)} aria-label={`Remove ${job.file.name || "upload"}`} className="grid size-11 shrink-0 place-items-center rounded-lg text-slate-500"><X size={17} /></button>
      </article>)}
    </div> : null}

    {attachments.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {attachments.map((image, index) => <article key={image.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <button type="button" onClick={() => setPreviewIndex(index)} className="block w-full bg-slate-950/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
          <img src={image.imageUrl} alt={`${label} ${index + 1}`} className="h-32 w-full object-contain" />
        </button>
        <div className="flex flex-wrap items-center gap-1 p-2">
          <button type="button" onClick={() => setPreviewIndex(index)} className="min-h-11 rounded-lg px-2 text-xs font-black text-violet-700">View Larger</button>
          <button type="button" onClick={() => chooseReplacement(image.id)} className="grid size-11 place-items-center rounded-lg text-slate-600" aria-label={`Replace ${label} ${index + 1}`}><Replace size={16} /></button>
          {multiple ? <>
            <button type="button" disabled={index === 0} onClick={() => { const next = [...attachments]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; void commit(next); }} className="grid size-11 place-items-center rounded-lg disabled:opacity-30" aria-label={`Move ${label} ${index + 1} earlier`}><ArrowUp size={16} /></button>
            <button type="button" disabled={index === attachments.length - 1} onClick={() => { const next = [...attachments]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; void commit(next); }} className="grid size-11 place-items-center rounded-lg disabled:opacity-30" aria-label={`Move ${label} ${index + 1} later`}><ArrowDown size={16} /></button>
          </> : null}
          <button type="button" onClick={() => void commit(attachments.filter((row) => row.id !== image.id))} className="ml-auto grid size-11 place-items-center rounded-lg text-rose-600" aria-label={`Remove ${label} ${index + 1}`}><Trash2 size={16} /></button>
        </div>
      </article>)}
    </div> : <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-3 text-center text-xs font-bold text-slate-400 dark:border-slate-700">Drop images here, paste, use Gallery, or take a photo.</p>}

    <ResponsiveModal open={cameraOpen} title="Take Photo" description="Use the shutter when the card or receipt is sharp and fully visible." onClose={closeCamera} size="md">
      <div className="overflow-hidden rounded-2xl bg-black">
        {captured ? <img src={captured.url} alt="Captured photo preview" className="max-h-[55dvh] w-full object-contain" /> : <video ref={videoRef} autoPlay playsInline muted className="max-h-[55dvh] w-full object-contain" />}
        {cameraBusy ? <div className="grid min-h-64 place-items-center text-white"><LoaderCircle className="animate-spin" aria-hidden="true" /><span className="sr-only">Starting camera</span></div> : null}
      </div>
      <div className="mt-4 flex min-h-14 items-center justify-center gap-3">
        {captured ? <>
          <AppButton type="button" variant="secondary" onClick={() => { URL.revokeObjectURL(captured.url); setCaptured(undefined); void startCamera(facingMode); }}><RotateCcw size={17} /> Retake</AppButton>
          <AppButton type="button" variant="success" onClick={() => void useCaptured()}><Check size={17} /> Use Photo</AppButton>
        </> : <>
          <AppButton type="button" variant="ghost" onClick={closeCamera}>Cancel</AppButton>
          <button type="button" onClick={takePicture} disabled={cameraBusy} className="grid size-16 place-items-center rounded-full border-4 border-white bg-coral text-white shadow-xl disabled:opacity-40" aria-label="Take picture"><Camera size={27} /></button>
          <AppButton type="button" variant="ghost" onClick={() => { const next = facingMode === "environment" ? "user" : "environment"; setFacingMode(next); void startCamera(next); }} aria-label="Switch camera"><SwitchCamera size={19} /></AppButton>
        </>}
      </div>
    </ResponsiveModal>
    <ResponsiveModal open={cropOpen} title="Crop Group Photo" description="Move the horizontal and vertical focus, then zoom until the item fills the square." onClose={() => setCropOpen(false)} size="sm" dismissible={!cropBusy}>
      {reusableAttachment ? <div className="space-y-4">
        <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-black">
          <img
            src={reusableAttachment.imageUrl}
            alt="Group photo crop preview"
            className="absolute inset-0 size-full object-cover"
            style={{ transform: `scale(${cropZoom})`, transformOrigin: `${cropX}% ${cropY}%` }}
          />
          <div className="pointer-events-none absolute inset-0 border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,.25)]" aria-hidden="true" />
        </div>
        <label className="block text-xs font-black">Horizontal focus<input type="range" min="0" max="100" value={cropX} onChange={(event) => setCropX(Number(event.target.value))} className="mt-2 w-full" /></label>
        <label className="block text-xs font-black">Vertical focus<input type="range" min="0" max="100" value={cropY} onChange={(event) => setCropY(Number(event.target.value))} className="mt-2 w-full" /></label>
        <label className="block text-xs font-black">Zoom<input type="range" min="1" max="5" step=".1" value={cropZoom} onChange={(event) => setCropZoom(Number(event.target.value))} className="mt-2 w-full" /></label>
        <div className="flex justify-end gap-2">
          <AppButton type="button" variant="ghost" disabled={cropBusy} onClick={() => setCropOpen(false)}>Cancel</AppButton>
          <AppButton type="button" loading={cropBusy} onClick={() => void useCroppedReusable()}>Use Crop</AppButton>
        </div>
      </div> : null}
    </ResponsiveModal>
    {preview ? <ImageLightbox
      imageUrl={preview.imageUrl}
      title={`${label} ${previewIndex! + 1}`}
      onClose={() => setPreviewIndex(undefined)}
      onPrevious={attachments.length > 1 ? () => setPreviewIndex((previewIndex! - 1 + attachments.length) % attachments.length) : undefined}
      onNext={attachments.length > 1 ? () => setPreviewIndex((previewIndex! + 1) % attachments.length) : undefined}
    /> : null}
  </section>;
}
