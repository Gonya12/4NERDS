import type { Worker } from "tesseract.js";
import type { CardCondition, PokemonProductCategory } from "../../types/models";
import { compressSaleImage } from "../images/saleImageService";
import { automaticallyPrepareCard, terminateCardImageWorker } from "./cardImageProcessor";
import {
  buildNameEvidence,
  buildPokemonApiQueries,
  conditionFromVisibleText,
  extractRawNameCandidate,
  parseCollectorNumber,
  rankPokemonCards,
  stickerPriceFromVisibleText,
  type RankablePokemonCard,
} from "./cardScanParsing";

export type ScanConfidence = "high" | "medium" | "low";
export type CardMatch = {
  id: string;
  cardName: string;
  collectorNumber: string;
  setName: string;
  rarity?: string;
  imageUrl?: string;
  marketPrice?: number;
  matchConfidence: ScanConfidence;
  matchScore: number;
  reasons: string[];
};
export type TcgplayerPriceVariant = {
  variant: string;
  market?: number;
  low?: number;
  mid?: number;
  high?: number;
  directLow?: number;
};
export type TcgplayerPricing = {
  url?: string;
  updatedAt?: string;
  checkedAt: string;
  variants: TcgplayerPriceVariant[];
  selectedVariant?: string;
  targetPercent?: number;
};
export type CardScanSuggestion = {
  suggestedType: Extract<PokemonProductCategory, "raw_card" | "graded_card"> | null;
  cardName: string | null;
  collectorNumber: string | null;
  cardSet: string | null;
  language: string | null;
  condition: CardCondition | null;
  stickerPrice: number | null;
  gradingCompany: string | null;
  grade: string | null;
  certificateNumber: string | null;
  labelInformation: string | null;
  barcodeText: string | null;
  overallConfidence: ScanConfidence;
  fieldConfidence: Record<string, ScanConfidence>;
  possibleMatches?: CardMatch[];
  correctedNameCandidate?: string;
  correctedNameConfidence?: ScanConfidence;
  officialImageUrl?: string;
  warnings: string[];
  tcgplayerPricing?: TcgplayerPricing;
  technicalDetails?: {
    fullText: string;
    topText: string;
    bottomText: string;
    stickerText: string;
    confidence: Record<string, number>;
    parsed: Record<string, string | number | null>;
    apiQuery: string;
    apiMatchCount: number;
    cropConfidence?: number;
    cropMethod?: string;
    processingMs?: number;
  };
};

type OcrRegion = { text: string; confidence: number };
export type CardScanStage =
  | "Preparing image"
  | "Detecting and cropping card"
  | "Initializing OCR"
  | "Reading card name"
  | "Reading collector number"
  | "Reading sticker"
  | "Reading full card fallback"
  | "Searching Pokémon cards"
  | "Preparing review";
type ScanOptions = {
  signal?: AbortSignal;
  onStage?: (stage: CardScanStage) => void;
  skipCrop?: boolean;
};

let workerPromise: Promise<Worker> | null = null;
let workerIdleTimer: number | undefined;
let ocrQueue: Promise<unknown> = Promise.resolve();
const searchCache = new Map<string, CardMatch[]>();

function abortError() {
  return new DOMException("Card scan cancelled.", "AbortError");
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function timed<T>(promise: Promise<T>, milliseconds: number, message: string, onTimeout?: () => void) {
  let timer = 0;
  return Promise.race([
    promise.finally(() => window.clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => {
        onTimeout?.();
        reject(new Error(message));
      }, milliseconds);
    }),
  ]);
}

function confidence(value: number): ScanConfidence {
  return value >= 76 ? "high" : value >= 50 ? "medium" : "low";
}

function confidenceFromMatchScore(value: number): ScanConfidence {
  return value >= 78 ? "high" : value >= 52 ? "medium" : "low";
}

export async function cancelCardScan() {
  if (workerIdleTimer) window.clearTimeout(workerIdleTimer);
  workerIdleTimer = undefined;
  terminateCardImageWorker();
  const active = workerPromise;
  workerPromise = null;
  if (active) {
    try {
      await (await active).terminate();
    } catch {
      // A cancelled worker can reject while it is still initializing.
    }
  }
}

function ocrWorker() {
  if (workerIdleTimer) window.clearTimeout(workerIdleTimer);
  workerPromise ||= import("tesseract.js")
    .then(({ createWorker }) => createWorker("eng", 1, {
      logger: (message) => {
        if (import.meta.env.DEV && message.status === "recognizing text") {
          console.info("[Local card OCR]", { progress: Math.round(message.progress * 100) });
        }
      },
    }))
    .catch((error) => {
      workerPromise = null;
      throw error;
    });
  return workerPromise;
}

function scheduleWorkerTermination() {
  if (workerIdleTimer) window.clearTimeout(workerIdleTimer);
  workerIdleTimer = window.setTimeout(() => void cancelCardScan(), 60_000);
}

function serializedOcr<T>(task: () => Promise<T>) {
  const run = ocrQueue.then(task, task);
  ocrQueue = run.catch(() => undefined);
  return run;
}

export async function imageHash(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function imageElement(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The selected image could not be opened for OCR."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sharpen(context: CanvasRenderingContext2D, width: number, height: number) {
  if (width * height > 1_800_000) return;
  const image = context.getImageData(0, 0, width, height);
  const source = new Uint8ClampedArray(image.data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const center = source[index + channel] * 1.6;
        const neighbors = (
          source[index - 4 + channel]
          + source[index + 4 + channel]
          + source[index - width * 4 + channel]
          + source[index + width * 4 + channel]
        ) * 0.15;
        image.data[index + channel] = Math.max(0, Math.min(255, center - neighbors));
      }
    }
  }
  context.putImageData(image, 0, 0);
}

function regionCanvas(
  image: HTMLImageElement,
  region: [number, number, number, number],
  scale = 2,
  threshold = false,
) {
  const [x, y, width, height] = region;
  const sourceWidth = Math.max(1, Math.round(image.naturalWidth * width));
  const sourceHeight = Math.max(1, Math.round(image.naturalHeight * height));
  const maxScale = Math.min(scale, 1800 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * maxScale));
  canvas.height = Math.max(1, Math.round(sourceHeight * maxScale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not prepare the image for OCR.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = "grayscale(1) contrast(1.75)";
  context.drawImage(
    image,
    Math.round(image.naturalWidth * x),
    Math.round(image.naturalHeight * y),
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  context.filter = "none";
  sharpen(context, canvas.width, canvas.height);
  if (threshold) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let total = 0;
    for (let index = 0; index < pixels.data.length; index += 4) total += pixels.data[index];
    const cutoff = Math.max(115, Math.min(190, total / Math.max(1, pixels.data.length / 4)));
    for (let index = 0; index < pixels.data.length; index += 4) {
      const value = pixels.data[index] > cutoff ? 255 : 0;
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 1;
  canvas.height = 1;
}

async function recognize(canvas: HTMLCanvasElement, pageSegmentationMode: "6" | "7" | "11", signal?: AbortSignal) {
  checkAbort(signal);
  try {
    const engine = await ocrWorker();
    checkAbort(signal);
    await engine.setParameters({ tessedit_pageseg_mode: pageSegmentationMode as import("tesseract.js").PSM });
    const result = await timed(
      engine.recognize(canvas),
      11_000,
      "One OCR stage timed out. Try a closer crop or enter the card manually.",
      () => void cancelCardScan(),
    );
    checkAbort(signal);
    return { text: result.data.text.trim(), confidence: Number(result.data.confidence || 0) };
  } finally {
    releaseCanvas(canvas);
  }
}

function usefulness(result: OcrRegion) {
  return result.text.replace(/[^A-Za-z0-9$/]/g, "").length * 2 + result.confidence;
}

async function recognizeBest(
  image: HTMLImageElement,
  region: [number, number, number, number],
  psm: "6" | "7" | "11",
  scale: number,
  signal?: AbortSignal,
  thresholdOnlyWhenWeak = false,
) {
  const normal = await recognize(regionCanvas(image, region, scale, false), psm, signal);
  if (thresholdOnlyWhenWeak && usefulness(normal) >= 58) return normal;
  const thresholded = await recognize(regionCanvas(image, region, scale, true), psm, signal);
  return usefulness(thresholded) > usefulness(normal) ? thresholded : normal;
}

function slabFields(text: string) {
  const gradingCompany = text.match(/\b(PSA|BGS|BECKETT|CGC|SGC|ACE)\b/i)?.[1]?.toUpperCase() || null;
  const grade = gradingCompany
    ? text.match(/\b(?:GEM\s*MINT|MINT|NM-MT|PRISTINE)?\s*(10(?:\.0)?|9\.5|9|8\.5|8|7\.5|7)\b/i)?.[1] || null
    : null;
  const certificateNumber = text.match(/\b(?:CERT(?:IFICATE)?\.?\s*(?:NO\.?|#)?\s*)?(\d[\d -]{6,15}\d)\b/i)?.[1]?.replace(/[ -]/g, "") || null;
  return { gradingCompany, grade, certificateNumber };
}

function photoQualityWarnings(image: HTMLImageElement) {
  const warnings: string[] = [];
  if (Math.min(image.naturalWidth, image.naturalHeight) < 650) {
    warnings.push("The card is small or low-resolution in this photo. A closer photo will scan better.");
  }
  const canvas = regionCanvas(image, [0, 0, 1, 1], 0.12, false);
  const context = canvas.getContext("2d");
  if (!context) return warnings;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let total = 0;
  let bright = 0;
  for (let index = 0; index < data.length; index += 4) {
    total += data[index];
    if (data[index] > 245) bright++;
  }
  const count = Math.max(1, data.length / 4);
  if (total / count < 62) warnings.push("The photo is dark. Add even lighting and avoid shadows.");
  if (bright / count > 0.18) warnings.push("Strong glare may hide printed text. Tilt the light away from the card.");
  releaseCanvas(canvas);
  return warnings;
}

function marketPrice(card: RankablePokemonCard) {
  const values = Object.values(card.tcgplayer?.prices || {})
    .flatMap((group) => [group.market, group.mid, group.low])
    .filter((value): value is number => typeof value === "number");
  return values[0];
}

function fetchWithTimeout(url: string, signal?: AbortSignal, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  return fetch(url, { signal: controller.signal }).finally(() => {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  });
}

export async function searchPokemonCards(cardName: string | null, collectorNumber: string | null, signal?: AbortSignal) {
  if (!cardName && !collectorNumber) return [];
  const evidence = buildNameEvidence(cardName || "");
  const collector = parseCollectorNumber(collectorNumber || "");
  const queries = buildPokemonApiQueries(evidence, collector, cardName || undefined);
  const cacheKey = queries.join("|");
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;
  const cards = new Map<string, RankablePokemonCard>();
  for (const query of queries) {
    checkAbort(signal);
    try {
      const response = await fetchWithTimeout(
        `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=10&select=id,name,number,set,rarity,images,tcgplayer`,
        signal,
      );
      if (!response.ok) continue;
      const payload = await response.json() as { data?: RankablePokemonCard[] };
      for (const card of payload.data || []) cards.set(card.id, card);
      if (cards.size >= 10) break;
    } catch (error) {
      if (signal?.aborted) throw abortError();
    }
  }
  const matches = rankPokemonCards([...cards.values()], evidence, collector)
    .slice(0, 5)
    .map((card): CardMatch => ({
      id: card.id,
      cardName: card.name,
      collectorNumber: card.number,
      setName: card.set?.name || "",
      rarity: card.rarity,
      imageUrl: card.images?.small,
      marketPrice: marketPrice(card),
      matchConfidence: confidenceFromMatchScore(card.matchScore),
      matchScore: card.matchScore,
      reasons: card.reasons,
    }));
  if (searchCache.size >= 50) searchCache.delete(searchCache.keys().next().value as string);
  searchCache.set(cacheKey, matches);
  return matches;
}

export async function confirmPokemonCardMatch(suggestion: CardScanSuggestion, match: CardMatch, signal?: AbortSignal) {
  let pricing: TcgplayerPricing = { checkedAt: new Date().toISOString(), variants: [], targetPercent: 75 };
  try {
    const response = await fetchWithTimeout(
      `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(match.id)}?select=id,name,number,set,rarity,images,tcgplayer`,
      signal,
    );
    if (response.ok) {
      const payload = await response.json() as {
        data?: { tcgplayer?: { url?: string; updatedAt?: string; prices?: Record<string, { market?: number; low?: number; mid?: number; high?: number; directLow?: number }> } };
      };
      const tcgplayer = payload.data?.tcgplayer;
      const variants = Object.entries(tcgplayer?.prices || {}).map(([variant, price]) => ({
        variant,
        market: price.market,
        low: price.low,
        mid: price.mid,
        high: price.high,
        directLow: price.directLow,
      }));
      pricing = {
        url: tcgplayer?.url,
        updatedAt: tcgplayer?.updatedAt,
        checkedAt: new Date().toISOString(),
        variants,
        selectedVariant: variants.length === 1 ? variants[0].variant : undefined,
        targetPercent: 75,
      };
    }
  } catch (error) {
    if (signal?.aborted) throw abortError();
  }
  return {
    ...suggestion,
    cardName: match.cardName,
    collectorNumber: match.collectorNumber,
    cardSet: match.setName,
    officialImageUrl: match.imageUrl,
    fieldConfidence: {
      ...suggestion.fieldConfidence,
      cardName: match.matchConfidence,
      collectorNumber: match.matchConfidence,
      cardSet: match.matchConfidence,
    },
    possibleMatches: [],
    tcgplayerPricing: pricing,
  };
}

export async function scanPokemonCard(
  front: File,
  requestedType: PokemonProductCategory,
  back?: File,
  force = false,
  options: ScanOptions = {},
) {
  const startedAt = performance.now();
  let previousStage: CardScanStage | undefined;
  let previousStageAt = startedAt;
  const stage = (name: CardScanStage) => {
    checkAbort(options.signal);
    const now = performance.now();
    if (import.meta.env.DEV && previousStage) {
      console.info("[Card scan stage:complete]", { stage: previousStage, durationMs: Math.round(now - previousStageAt) });
    }
    previousStage = name;
    previousStageAt = now;
    options.onStage?.(name);
  };
  stage("Preparing image");
  const preparedFront = await compressSaleImage(front);
  const preparedBack = back ? await compressSaleImage(back) : undefined;
  const hash = `${await imageHash(preparedFront)}:${preparedBack ? await imageHash(preparedBack) : ""}`;
  const cacheKey = `4nerds_card_scan_v2_${hash}`;
  if (!force) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return { suggestion: JSON.parse(cached) as CardScanSuggestion, hash, cached: true };
    } catch {
      // Cache is optional.
    }
  }

  const task = serializedOcr(async () => {
    stage("Detecting and cropping card");
    const prepared = options.skipCrop
      ? { file: preparedFront, cropped: false, detection: undefined }
      : await automaticallyPrepareCard(preparedFront, options.signal);
    checkAbort(options.signal);
    const frontImage = await imageElement(prepared.file);
    const qualityWarnings = photoQualityWarnings(frontImage);

    stage("Initializing OCR");
    await timed(ocrWorker(), 12_000, "OCR could not start on this device.", () => void cancelCardScan());
    stage("Reading card name");
    const top = await recognizeBest(frontImage, [0.025, 0.01, 0.95, 0.24], "7", 2.5, options.signal);
    const preliminaryName = extractRawNameCandidate(top.text, top.confidence);

    stage("Reading collector number");
    const bottom = await recognizeBest(frontImage, [0.01, 0.72, 0.98, 0.27], "7", 3, options.signal);
    let collector = parseCollectorNumber(bottom.text);

    stage("Reading sticker");
    const sticker = await recognizeBest(frontImage, [0.48, 0.04, 0.51, 0.91], "11", 1.8, options.signal, true);

    let full: OcrRegion = { text: "", confidence: 0 };
    let rawNameCandidate = preliminaryName;
    if (!rawNameCandidate || !collector || Math.max(top.confidence, bottom.confidence) < 45) {
      stage("Reading full card fallback");
      full = await recognizeBest(frontImage, [0.01, 0.01, 0.98, 0.98], "6", 1.15, options.signal, true);
      rawNameCandidate ||= extractRawNameCandidate(full.text, full.confidence);
      collector ||= parseCollectorNumber(`${bottom.text}\n${full.text}`);
    }

    let label: OcrRegion = { text: "", confidence: 0 };
    if (requestedType === "graded_card") {
      const labelImage = preparedBack ? await imageElement(preparedBack) : frontImage;
      label = await recognizeBest(labelImage, [0.02, 0.01, 0.96, 0.38], "11", 2.2, options.signal, true);
    }
    const visibleStickerText = sticker.text;
    const condition = conditionFromVisibleText(visibleStickerText);
    const stickerPrice = stickerPriceFromVisibleText(visibleStickerText);
    const slab = slabFields(`${top.text}\n${label.text}`);
    const nameEvidence = buildNameEvidence(rawNameCandidate || "");

    stage("Searching Pokémon cards");
    const possibleMatches = await timed(
      searchPokemonCards(nameEvidence.candidates[0] || rawNameCandidate, collector?.normalized || null, options.signal),
      18_000,
      "Pokémon card search timed out.",
    ).catch((error) => {
      if (options.signal?.aborted) throw abortError();
      return [] as CardMatch[];
    });
    const correctedNameCandidate = possibleMatches[0]?.cardName || nameEvidence.candidates[0];
    const correctedNameConfidence = possibleMatches[0]?.matchConfidence
      || (correctedNameCandidate ? confidence(top.confidence) : undefined);
    const warnings = [...qualityWarnings];
    if (options.skipCrop) {
      warnings.push("The selected crop was used for OCR.");
    } else if (prepared.cropped) {
      warnings.push("Card boundary detected and perspective corrected.");
    } else {
      warnings.push("Automatic card detection was uncertain. Adjust the four corners before relying on OCR.");
    }
    if (!correctedNameCandidate) warnings.push("No reliable cleaned card-name candidate was found. Search manually or enter the card name.");
    if (!collector) warnings.push("Collector number was not clear enough to suggest.");
    if (!possibleMatches.length && (rawNameCandidate || collector)) {
      warnings.push("No Pokémon TCG API match was found. Raw OCR is available only under Technical Details.");
    }
    const fieldConfidence = {
      cardName: correctedNameConfidence || "low" as const,
      collectorNumber: collector ? confidence(bottom.confidence) : "low" as const,
      cardSet: possibleMatches.length ? "medium" as const : "low" as const,
      language: "low" as const,
      condition: condition ? confidence(sticker.confidence) : "low" as const,
      stickerPrice: stickerPrice != null ? confidence(sticker.confidence) : "low" as const,
      gradingCompany: slab.gradingCompany ? confidence(label.confidence || top.confidence) : "low" as const,
      grade: slab.grade ? confidence(label.confidence || top.confidence) : "low" as const,
      certificateNumber: slab.certificateNumber ? confidence(label.confidence || top.confidence) : "low" as const,
    };
    const strongest = Math.max(full.confidence, top.confidence, bottom.confidence, sticker.confidence, label.confidence);
    const apiQuery = buildPokemonApiQueries(nameEvidence, collector).join(" | ");
    stage("Preparing review");
    const suggestion = {
      suggestedType: requestedType === "graded_card" ? "graded_card" as const : "raw_card" as const,
      cardName: null,
      correctedNameCandidate,
      correctedNameConfidence,
      collectorNumber: collector?.normalized || null,
      cardSet: null,
      language: null,
      condition,
      stickerPrice,
      gradingCompany: slab.gradingCompany,
      grade: slab.grade,
      certificateNumber: slab.certificateNumber,
      labelInformation: label.text || null,
      barcodeText: null,
      overallConfidence: confidence(strongest),
      fieldConfidence,
      possibleMatches,
      warnings,
      technicalDetails: {
        fullText: full.text,
        topText: top.text,
        bottomText: bottom.text,
        stickerText: sticker.text,
        confidence: {
          full: full.confidence,
          top: top.confidence,
          bottom: bottom.confidence,
          sticker: sticker.confidence,
          label: label.confidence,
        },
        parsed: {
          rawNameCandidate,
          correctedNameCandidate: correctedNameCandidate || null,
          collectorNumber: collector?.normalized || null,
          condition,
          stickerPrice,
        },
        apiQuery,
        apiMatchCount: possibleMatches.length,
        cropConfidence: prepared.detection?.confidence,
        cropMethod: options.skipCrop ? "user-selected crop/full image" : prepared.cropped ? "automatic perspective crop" : "full-image fallback",
        processingMs: Math.round(performance.now() - startedAt),
      },
    } satisfies CardScanSuggestion;
    return {
      suggestion,
      correctedFile: prepared.file,
      cardDetected: Boolean(prepared.cropped),
      cropConfidence: prepared.detection?.confidence,
    };
  }).finally(scheduleWorkerTermination);

  const analysis = await timed(
    task,
    58_000,
    "Scanning timed out. Retake the photo, adjust the crop, or enter the details manually.",
    () => void cancelCardScan(),
  );
  checkAbort(options.signal);
  try {
    localStorage.setItem(cacheKey, JSON.stringify(analysis.suggestion));
  } catch {
    // Cache is optional.
  }
  return { ...analysis, hash, cached: false };
}
