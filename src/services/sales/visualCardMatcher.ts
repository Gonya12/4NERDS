import type { CardMatch, ScanConfidence } from "./cardScanService";

type IndexCard = {
  id: string; name: string; number: string; setName: string; rarity?: string;
  imageUrl: string; marketPrice?: number; embedding: string;
};
type IndexManifest = { version: string; model: string; dimensions: number; shards: string[] };

// Pipeline task overloads form a broad union; runtime is always image-feature-extraction.
let extractorPromise: Promise<any> | null = null;
let manifestPromise: Promise<IndexManifest | null> | null = null;
let openCvPromise: Promise<any> | null = null;

function lowMemoryDevice() {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return Boolean((memory && memory < 6) || window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768);
}

function openCv() {
  openCvPromise ||= new Promise((resolve, reject) => {
    const existing = (window as Window & { cv?: any }).cv;
    if (existing?.Mat) { resolve(existing); return; }
    const script = document.createElement("script");
    script.src = "https://docs.opencv.org/4.x/opencv.js";
    script.async = true;
    script.onload = () => {
      const cv = (window as Window & { cv?: any }).cv;
      if (!cv) { reject(new Error("OpenCV did not initialize.")); return; }
      if (cv instanceof Promise) cv.then(resolve, reject);
      else if (cv.Mat) resolve(cv);
      else { cv.onRuntimeInitialized = () => resolve(cv); }
    };
    script.onerror = () => reject(new Error("OpenCV could not be loaded."));
    document.head.appendChild(script);
  });
  return openCvPromise;
}

async function extractor() {
  extractorPromise ||= import("@huggingface/transformers").then(({ env, pipeline }) => {
    env.allowLocalModels = false;
    return pipeline("image-feature-extraction", "Xenova/clip-vit-base-patch32", { dtype: "q8" });
  });
  return extractorPromise;
}

async function manifest() {
  manifestPromise ||= fetch("/card-index/manifest.json", { cache: "force-cache" })
    .then((response) => response.ok ? response.json() as Promise<IndexManifest> : null)
    .catch(() => null);
  return manifestPromise;
}

function cosine(left: number[], right: number[]) {
  let dot = 0; let leftMagnitude = 0; let rightMagnitude = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude) || 1);
}

function decodeEmbedding(value: string) {
  const binary = atob(value); const result = new Array<number>(binary.length);
  for (let index = 0; index < binary.length; index++) result[index] = (binary.charCodeAt(index) - 128) / 127;
  return result;
}

function confidence(score: number): ScanConfidence {
  return score >= 0.88 ? "high" : score >= 0.76 ? "medium" : "low";
}

export async function detectAndCorrectCard(file: File) {
  if (lowMemoryDevice()) return { file, detected: false };
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image(); element.onload = () => resolve(element); element.onerror = reject; element.src = sourceUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return { file, detected: false };
    context.drawImage(image, 0, 0);
    try {
      const cv = await Promise.race([
        openCv(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Card detection timed out.")), 8_000))
      ]);
      const source = cv.imread(canvas);
      const gray = new cv.Mat(); const blurred = new cv.Mat(); const edges = new cv.Mat();
      const contours = new cv.MatVector(); const hierarchy = new cv.Mat();
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
      cv.Canny(blurred, edges, 55, 160);
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let best: { points: Array<{ x: number; y: number }>; area: number } | null = null;
      for (let index = 0; index < contours.size(); index++) {
        const contour = contours.get(index); const perimeter = cv.arcLength(contour, true); const polygon = new cv.Mat();
        cv.approxPolyDP(contour, polygon, perimeter * 0.025, true);
        const area = Math.abs(cv.contourArea(polygon));
        if (polygon.rows === 4 && area > source.rows * source.cols * 0.12 && (!best || area > best.area)) {
          best = { area, points: Array.from({ length: 4 }, (_, point) => ({ x: polygon.intPtr(point, 0)[0], y: polygon.intPtr(point, 0)[1] })) };
        }
        contour.delete(); polygon.delete();
      }
      gray.delete(); blurred.delete(); edges.delete(); contours.delete(); hierarchy.delete();
      if (!best) { source.delete(); return { file, detected: false }; }
      const points = best.points;
      const sums = points.map((point) => point.x + point.y); const differences = points.map((point) => point.x - point.y);
      const topLeft = points[sums.indexOf(Math.min(...sums))]; const bottomRight = points[sums.indexOf(Math.max(...sums))];
      const topRight = points[differences.indexOf(Math.max(...differences))]; const bottomLeft = points[differences.indexOf(Math.min(...differences))];
      const width = Math.max(600, Math.round(Math.max(Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y), Math.hypot(bottomRight.x - bottomLeft.x, bottomRight.y - bottomLeft.y))));
      const height = Math.round(width * 1.4);
      const inputPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [topLeft.x, topLeft.y, topRight.x, topRight.y, bottomRight.x, bottomRight.y, bottomLeft.x, bottomLeft.y]);
      const outputPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]);
      const transform = cv.getPerspectiveTransform(inputPoints, outputPoints); const corrected = new cv.Mat();
      cv.warpPerspective(source, corrected, transform, new cv.Size(width, height), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
      const output = document.createElement("canvas"); cv.imshow(output, corrected);
      source.delete(); inputPoints.delete(); outputPoints.delete(); transform.delete(); corrected.delete();
      const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/jpeg", 0.94));
      return blob ? { file: new File([blob], `corrected-${file.name}`, { type: "image/jpeg" }), detected: true } : { file, detected: false };
    } catch {
      return { file, detected: false };
    }
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function visualCardMatches(file: File, ocrName?: string | null, ocrNumber?: string | null) {
  const indexManifest = await Promise.race([manifest(), new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 4_000))]);
  if (!indexManifest || lowMemoryDevice()) return { matches: [] as CardMatch[], warning: indexManifest ? "Visual matching was skipped on this low-memory device." : "Visual card index is unavailable; using OCR and manual search." };
  const imageUrl = URL.createObjectURL(file);
  try {
    const featureExtractor = await extractor();
    const output = await featureExtractor(imageUrl, { pooling: "mean", normalize: true });
    const queryEmbedding = Array.from(output.data as Float32Array);
    const candidates: Array<{ card: IndexCard; score: number }> = [];
    for (const shardPath of indexManifest.shards) {
      const cards = await fetch(`/card-index/${shardPath}`, { cache: "force-cache" }).then((response) => response.json() as Promise<IndexCard[]>);
      for (const card of cards) {
        let score = cosine(queryEmbedding, decodeEmbedding(card.embedding));
        if (ocrName && card.name.toLowerCase().includes(ocrName.toLowerCase())) score += 0.05;
        const numerator = ocrNumber?.split("/")[0].replace(/[^A-Za-z0-9]/g, "");
        if (numerator && card.number.toLowerCase() === numerator.toLowerCase()) score += 0.06;
        if (candidates.length < 10) candidates.push({ card, score });
        else {
          let lowest = 0;
          for (let index = 1; index < candidates.length; index++) if (candidates[index].score < candidates[lowest].score) lowest = index;
          if (score > candidates[lowest].score) candidates[lowest] = { card, score };
        }
      }
    }
    return {
      matches: candidates.sort((a, b) => b.score - a.score).slice(0, 5).map(({ card, score }) => ({
        id: card.id, cardName: card.name, collectorNumber: card.number, setName: card.setName, rarity: card.rarity,
        imageUrl: card.imageUrl, marketPrice: card.marketPrice, matchConfidence: confidence(score), similarityScore: score,
        ocrAgreement: ocrName || ocrNumber
          ? ((ocrName && card.name.toLowerCase().includes(ocrName.toLowerCase())) || (ocrNumber && card.number === ocrNumber.split("/")[0]) ? "agree" : "conflict")
          : "unknown"
      } as CardMatch & { similarityScore: number })),
      warning: ""
    };
  } catch {
    return { matches: [] as CardMatch[], warning: "Visual matching could not run on this device; OCR and manual entry remain available." };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
