export type CropPoint = { x: number; y: number };
export type CardFrameDetection = {
  width: number;
  height: number;
  confidence: number;
  rotated: boolean;
  corners: CropPoint[];
};

type WorkerResult = {
  id: number;
  ok: boolean;
  result?: CardFrameDetection | { buffer: ArrayBuffer; width: number; height: number };
  error?: string;
};

let imageWorker: Worker | null = null;
let requestId = 0;
let idleTimer: number | undefined;
const pending = new Map<number, { resolve: (value: WorkerResult["result"]) => void; reject: (error: Error) => void }>();
const fallbackCorners: CropPoint[] = [
  { x: 0.08, y: 0.06 },
  { x: 0.92, y: 0.06 },
  { x: 0.92, y: 0.94 },
  { x: 0.08, y: 0.94 },
];

function worker() {
  if (idleTimer) window.clearTimeout(idleTimer);
  if (!imageWorker) {
    imageWorker = new Worker(new URL("../../workers/cardImageWorker.ts", import.meta.url), { type: "module" });
    imageWorker.onmessage = (event: MessageEvent<WorkerResult>) => {
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id);
      if (event.data.ok && event.data.result) request.resolve(event.data.result);
      else request.reject(new Error(event.data.error || "Image processing failed."));
      scheduleTermination();
    };
    imageWorker.onerror = () => terminateCardImageWorker(new Error("The image worker stopped unexpectedly."));
  }
  return imageWorker;
}

function scheduleTermination() {
  if (idleTimer) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => terminateCardImageWorker(), 45_000);
}

function runWorker(
  type: "detect" | "crop",
  file: File,
  signal?: AbortSignal,
  corners?: CropPoint[],
) {
  if (signal?.aborted) return Promise.reject(new DOMException("Card scan cancelled.", "AbortError"));
  const id = ++requestId;
  return file.arrayBuffer().then((buffer) => new Promise<WorkerResult["result"]>((resolve, reject) => {
    const activeWorker = worker();
    const onAbort = () => {
      const request = pending.get(id);
      pending.delete(id);
      if (request) request.reject(new DOMException("Card scan cancelled.", "AbortError"));
      else reject(new DOMException("Card scan cancelled.", "AbortError"));
      if (!pending.size) scheduleTermination();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    pending.set(id, {
      resolve: (value) => { signal?.removeEventListener("abort", onAbort); resolve(value); },
      reject: (error) => { signal?.removeEventListener("abort", onAbort); reject(error); },
    });
    activeWorker.postMessage({
      id,
      type,
      buffer,
      mimeType: file.type,
      corners,
      maxLongEdge: 1400,
    }, [buffer]);
  }));
}

async function imageElement(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The selected image could not be opened."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fallbackCrop(file: File, corners: CropPoint[], signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Card scan cancelled.", "AbortError");
  const image = await imageElement(file);
  const left = Math.max(0, Math.min(...corners.map((point) => point.x)));
  const right = Math.min(1, Math.max(...corners.map((point) => point.x)));
  const top = Math.max(0, Math.min(...corners.map((point) => point.y)));
  const bottom = Math.min(1, Math.max(...corners.map((point) => point.y)));
  const sourceWidth = Math.max(1, Math.round(image.naturalWidth * (right - left)));
  const sourceHeight = Math.max(1, Math.round(image.naturalHeight * (bottom - top)));
  const scale = Math.min(1, 1400 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare a crop. Use the full image instead.");
  context.drawImage(
    image,
    Math.round(image.naturalWidth * left),
    Math.round(image.naturalHeight * top),
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  canvas.width = 1;
  canvas.height = 1;
  if (!blob) throw new Error("This browser could not create the crop. Use the full image instead.");
  return new File([blob], `cropped-${file.name || "card.jpg"}`, { type: "image/jpeg", lastModified: Date.now() });
}

export async function detectCardFrame(file: File, signal?: AbortSignal) {
  try {
    return await runWorker("detect", file, signal) as CardFrameDetection;
  } catch (error) {
    if (signal?.aborted) throw error;
    const image = await imageElement(file);
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      confidence: 0,
      rotated: false,
      corners: fallbackCorners,
    };
  }
}

export async function cropCardPerspective(file: File, corners: CropPoint[], signal?: AbortSignal) {
  try {
    const result = await runWorker("crop", file, signal, corners) as { buffer: ArrayBuffer; width: number; height: number };
    return new File([result.buffer], `cropped-${file.name.replace(/^compressed-/, "") || "card.jpg"}`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return fallbackCrop(file, corners, signal);
  }
}

export async function automaticallyPrepareCard(file: File, signal?: AbortSignal) {
  const detection = await detectCardFrame(file, signal);
  if (detection.confidence < 0.48) {
    return { file, detection, cropped: false };
  }
  return { file: await cropCardPerspective(file, detection.corners, signal), detection, cropped: true };
}

export function terminateCardImageWorker(reason: Error = new DOMException("Card scan cancelled.", "AbortError")) {
  if (idleTimer) window.clearTimeout(idleTimer);
  idleTimer = undefined;
  imageWorker?.terminate();
  imageWorker = null;
  for (const request of pending.values()) request.reject(reason);
  pending.clear();
}
