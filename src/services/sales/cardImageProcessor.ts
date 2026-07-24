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
      pending.delete(id);
      terminateCardImageWorker();
      reject(new DOMException("Card scan cancelled.", "AbortError"));
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

export async function detectCardFrame(file: File, signal?: AbortSignal) {
  return await runWorker("detect", file, signal) as CardFrameDetection;
}

export async function cropCardPerspective(file: File, corners: CropPoint[], signal?: AbortSignal) {
  const result = await runWorker("crop", file, signal, corners) as { buffer: ArrayBuffer; width: number; height: number };
  return new File([result.buffer], `cropped-${file.name.replace(/^compressed-/, "") || "card.jpg"}`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
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
