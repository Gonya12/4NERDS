import type { Worker } from "tesseract.js";
import type { CardCondition, PokemonProductCategory } from "../../types/models";
import { compressSaleImage } from "../images/saleImageService";
import { detectAndCorrectCard, visualCardMatches } from "./visualCardMatcher";

export type ScanConfidence = "high" | "medium" | "low";
export type CardMatch = {
  id: string; cardName: string; collectorNumber: string; setName: string;
  rarity?: string; imageUrl?: string; marketPrice?: number; matchConfidence: ScanConfidence; similarityScore?: number;
  ocrAgreement?: "agree" | "conflict" | "unknown";
};
export type TcgplayerPriceVariant = {
  variant: string; market?: number; low?: number; mid?: number; high?: number; directLow?: number;
};
export type TcgplayerPricing = {
  url?: string; updatedAt?: string; checkedAt: string; variants: TcgplayerPriceVariant[]; selectedVariant?: string;
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
    fullText: string; topText: string; bottomText: string; stickerText: string;
    confidence: Record<string, number>; parsed: Record<string, string | number | null>;
    apiQuery: string; apiMatchCount: number;
  };
};

const supportedPriceVariants = ["normal", "holofoil", "reverseHolofoil", "firstEditionHolofoil", "firstEditionNormal", "unlimitedHolofoil", "unlimitedNormal"];

export async function confirmPokemonCardMatch(suggestion: CardScanSuggestion, match: CardMatch) {
  let pricing: TcgplayerPricing = { checkedAt: new Date().toISOString(), variants: [] };
  try {
    const response = await fetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(match.id)}?select=id,name,number,set,rarity,images,tcgplayer`, { signal: AbortSignal.timeout(8_000) });
    if (response.ok) {
      const payload = await response.json() as { data?: { tcgplayer?: { url?: string; updatedAt?: string; prices?: Record<string, { market?: number; low?: number; mid?: number; high?: number; directLow?: number }> } } };
      const tcgplayer = payload.data?.tcgplayer;
      const variants = supportedPriceVariants.flatMap((variant) => {
        const price = tcgplayer?.prices?.[variant];
        return price ? [{ variant, market: price.market, low: price.low, mid: price.mid, high: price.high, directLow: price.directLow }] : [];
      });
      pricing = { url: tcgplayer?.url, updatedAt: tcgplayer?.updatedAt, checkedAt: new Date().toISOString(), variants, selectedVariant: variants.length === 1 ? variants[0].variant : undefined };
    }
  } catch { /* Pricing is optional and manual market value remains available. */ }
  return {
    ...suggestion, cardName: match.cardName, collectorNumber: match.collectorNumber, cardSet: match.setName, officialImageUrl: match.imageUrl,
    possibleMatches: [], tcgplayerPricing: pricing
  };
}

type OcrRegion = { text: string; confidence: number };
let workerPromise: Promise<Worker> | null = null;
let ocrQueue: Promise<unknown> = Promise.resolve();
let workerIdleTimer: number | undefined;
const searchCache = new Map<string, Promise<CardMatch[]>>();
export type CardScanStage = "Preparing image" | "Detecting and cropping card" | "Initializing OCR" | "Reading card text" | "Reading collector number" | "Reading sticker" | "Searching Pokémon cards" | "Visual matching" | "Preparing review";
type ScanOptions = { signal?: AbortSignal; onStage?: (stage: CardScanStage) => void };

function abortError() { return new DOMException("Card scan cancelled.", "AbortError"); }
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }
function timed<T>(promise: Promise<T>, milliseconds: number, message: string, onTimeout?: () => void) {
  let timer = 0;
  return Promise.race([
    promise.finally(() => window.clearTimeout(timer)),
    new Promise<T>((_, reject) => { timer = window.setTimeout(() => { onTimeout?.(); reject(new Error(message)); }, milliseconds); })
  ]);
}

export async function cancelCardScan() {
  if (workerIdleTimer) window.clearTimeout(workerIdleTimer);
  const active = workerPromise;
  workerPromise = null;
  if (active) {
    try { await (await active).terminate(); } catch { /* Worker may already be stopping. */ }
  }
}

export async function imageHash(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function confidence(value: number): ScanConfidence {
  return value >= 75 ? "high" : value >= 50 ? "medium" : "low";
}

async function worker() {
  if (workerIdleTimer) window.clearTimeout(workerIdleTimer);
  workerPromise ||= import("tesseract.js").then(({ createWorker }) => createWorker("eng", 1, {
    logger: (message) => {
      if (import.meta.env.DEV && message.status === "recognizing text") {
        console.info("[Local card OCR]", { status: message.status, progress: Math.round(message.progress * 100) });
      }
    }
  }));
  return workerPromise;
}

function scheduleWorkerTermination() {
  if (workerIdleTimer) window.clearTimeout(workerIdleTimer);
  workerIdleTimer = window.setTimeout(async () => {
    const active = workerPromise;
    workerPromise = null;
    if (active) await (await active).terminate();
  }, 90_000);
}

async function imageElement(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The selected image could not be opened for OCR."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function crop(image: HTMLImageElement, x: number, y: number, width: number, height: number, scale = 2, threshold = false) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * width * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not prepare the image for OCR.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = "grayscale(1) contrast(1.65) saturate(0)";
  context.drawImage(
    image,
    Math.round(image.naturalWidth * x), Math.round(image.naturalHeight * y),
    Math.round(image.naturalWidth * width), Math.round(image.naturalHeight * height),
    0, 0, canvas.width, canvas.height
  );
  if (threshold) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const value = pixels.data[index] > 155 ? 255 : 0;
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

async function recognize(canvas: HTMLCanvasElement, pageSegmentationMode: "6" | "7" | "11"): Promise<OcrRegion> {
  const engine = await worker();
  await engine.setParameters({ tessedit_pageseg_mode: pageSegmentationMode as import("tesseract.js").PSM });
  const result = await engine.recognize(canvas);
  return { text: result.data.text.trim(), confidence: Number(result.data.confidence || 0) };
}

async function recognizeBest(image: HTMLImageElement, region: [number, number, number, number], psm: "6" | "7" | "11", scale = 2) {
  const normal = await recognize(crop(image, ...region, scale, false), psm);
  const thresholded = await recognize(crop(image, ...region, scale, true), psm);
  const usefulness = (result: OcrRegion) => result.text.replace(/[^A-Za-z0-9$/]/g, "").length * 2 + result.confidence;
  return usefulness(thresholded) > usefulness(normal) ? thresholded : normal;
}

function serializedOcr<T>(task: () => Promise<T>) {
  const run = ocrQueue.then(task, task);
  ocrQueue = run.catch(() => undefined);
  return run;
}

function cardNameFrom(text: string, score: number) {
  const ignored = /\b(?:pokemon|pokémon|basic|stage|trainer|energy|ability|weakness|resistance|retreat|illustrator|hp)\b/i;
  const candidate = text.split(/\r?\n/)
    .map((line) => line.replace(/[^\p{L}\p{N}' .:&-]/gu, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3 && line.length <= 32 && /[A-Za-z]{3}/.test(line) && !ignored.test(line))
    .sort((a, b) => (/\d/.test(a) ? 1 : 0) - (/\d/.test(b) ? 1 : 0) || a.length - b.length)[0] || null;
  return score >= 25 || (candidate && /^[A-Za-z][A-Za-z' .-]{2,24}$/.test(candidate)) ? candidate : null;
}

function collectorNumberFrom(text: string, score: number) {
  void score;
  const fraction = text.match(/\b[A-Z]{0,4}\s*\d{1,3}\s*[/|]\s*[A-Z]{0,4}\s*\d{1,3}\b/i)?.[0];
  if (fraction) return fraction.replace(/\s+/g, "");
  return text.match(/\b(?:SV|TG|GG|RC|SH|SWSH|XY|SM|BW)?\d{3}[A-Z]?\b/i)?.[0] || null;
}

function conditionFrom(text: string): CardCondition | null {
  const normalized = ` ${text.toUpperCase().replace(/[^A-Z]+/g, " ")} `;
  if (/\sDMG\s|\sDAMAGED\s/.test(normalized)) return "Damaged";
  if (/\sHP\s|\sHEAVILY PLAYED\s/.test(normalized)) return "Heavily Played / HP";
  if (/\sMP\s|\sMODERATELY PLAYED\s/.test(normalized)) return "Moderately Played / MP";
  if (/\sLP\s|\sLIGHTLY PLAYED\s/.test(normalized)) return "Lightly Played / LP";
  if (/\sNM\s|\sNEAR MINT\s/.test(normalized)) return "Near Mint / NM";
  if (/\sMINT\s/.test(normalized)) return "Mint";
  return null;
}

function priceFrom(text: string) {
  const match = text.match(/(?:\$\s*(\d{1,5}(?:[.,]\d{2})?)|(\d{1,5}(?:[.,]\d{2})?)\s*\$|USD\s*(\d{1,5}(?:[.,]\d{2})?))(?!\d)/i);
  if (!match) return null;
  const value = Number((match[1] || match[2] || match[3]).replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function slabFields(text: string) {
  const gradingCompany = text.match(/\b(PSA|BGS|BECKETT|CGC|SGC|ACE)\b/i)?.[1]?.toUpperCase() || null;
  const grade = gradingCompany ? text.match(/\b(?:GEM\s*MINT|MINT|NM-MT|PRISTINE)?\s*(10(?:\.0)?|9\.5|9|8\.5|8|7\.5|7)\b/i)?.[1] || null : null;
  const certificateNumber = text.match(/\b(?:CERT(?:IFICATE)?\.?\s*(?:NO\.?|#)?\s*)?(\d[\d -]{6,15}\d)\b/i)?.[1]?.replace(/[ -]/g, "") || null;
  return { gradingCompany, grade, certificateNumber };
}

function photoQualityWarnings(image: HTMLImageElement) {
  const warnings: string[] = [];
  if (Math.min(image.naturalWidth, image.naturalHeight) < 700) warnings.push("The card is small or low-resolution in this photo. A closer photo will scan better.");
  const sample = crop(image, 0, 0, 1, 1, 0.12, false);
  const context = sample.getContext("2d");
  if (!context) return warnings;
  const data = context.getImageData(0, 0, sample.width, sample.height).data;
  let total = 0;
  let bright = 0;
  let dark = 0;
  for (let index = 0; index < data.length; index += 4) {
    const light = (data[index] + data[index + 1] + data[index + 2]) / 3;
    total += light;
    if (light > 245) bright++;
    if (light < 35) dark++;
  }
  const pixels = Math.max(1, data.length / 4);
  if (total / pixels < 65) warnings.push("The photo is dark. Add even lighting and avoid shadows.");
  if (bright / pixels > 0.18) warnings.push("Strong glare may hide printed text. Tilt the light away from the card.");
  if (dark / pixels > 0.55) warnings.push("The card may occupy too little of the image. Move closer and fill the frame.");
  return warnings;
}

function marketPrice(card: { tcgplayer?: { prices?: Record<string, Record<string, number | null>> } }) {
  const prices = Object.values(card.tcgplayer?.prices || {}).flatMap((group) => [group.market, group.mid, group.low]).filter((value): value is number => typeof value === "number");
  return prices[0];
}

function nameEvidence(raw: string) {
  const normalized = raw
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .replace(/\b(?:BASIC|STAGE\s*[12]|HP\s*\d*)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  const tokens = normalized.split(" ").filter((token) => token.length > 1 && !/^(?:re|the|card|ability)$/i.test(token));
  const suffixToken = tokens.find((token) => /^(?:ex|gx|v|max|vmax|vstar|break|it)$/i.test(token));
  const suffix = suffixToken?.toLowerCase() === "it" ? "ex" : suffixToken?.toUpperCase() === "EX" ? "ex" : suffixToken?.toUpperCase();
  const words = tokens.filter((token) => token !== suffixToken && /[A-Za-z]{3}/.test(token));
  const strongestWord = [...words].sort((a, b) => b.length - a.length)[0]?.toLowerCase() || "";
  const cleanedFull = [strongestWord, suffix].filter(Boolean).join(" ");
  return { raw, cleanedFull, strongestWord, suffix: suffix || "" };
}

function levenshtein(left: string, right: string) {
  const a = left.toLowerCase(); const b = right.toLowerCase();
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

function fuzzyNameSimilarity(evidence: ReturnType<typeof nameEvidence>, officialName: string) {
  const official = officialName.toLowerCase();
  const baseOfficial = official.replace(/\b(?:ex|gx|vmax|vstar|v|break)\b/gi, "").trim();
  const distanceScore = evidence.strongestWord ? 1 - levenshtein(evidence.strongestWord, baseOfficial) / Math.max(evidence.strongestWord.length, baseOfficial.length, 1) : 0;
  const prefixScore = evidence.strongestWord && baseOfficial.startsWith(evidence.strongestWord.slice(0, Math.min(5, evidence.strongestWord.length))) ? 0.75 : 0;
  const suffixScore = evidence.suffix && official.includes(evidence.suffix.toLowerCase()) ? 0.12 : 0;
  return Math.min(1, Math.max(distanceScore, prefixScore) + suffixScore);
}

async function findPokemonCards(cardName: string | null, collectorNumber: string | null, nameConfidence: ScanConfidence): Promise<CardMatch[]> {
  if (!cardName && !collectorNumber) return [];
  const numerator = collectorNumber?.split("/")[0].replace(/[^A-Za-z0-9]/g, "") || "";
  const denominator = collectorNumber?.split("/")[1]?.replace(/\D/g, "") || "";
  const evidence = nameEvidence(cardName || "");
  const queries = [
    evidence.cleanedFull ? `name:"${evidence.cleanedFull}"${numerator ? ` number:${numerator}` : ""}` : "",
    evidence.strongestWord ? `name:${evidence.strongestWord}` : "",
    evidence.strongestWord ? `name:${evidence.strongestWord.slice(0, Math.min(5, evidence.strongestWord.length))}*` : "",
    numerator ? `number:${numerator}` : ""
  ].filter(Boolean);
  void nameConfidence;
  const cacheKey = queries.join("|");
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;
  const request = (async () => {
  try {
    type ApiCard = { id: string; name: string; number: string; rarity?: string; set?: { name?: string; printedTotal?: number; total?: number }; images?: { small?: string }; tcgplayer?: { prices?: Record<string, Record<string, number | null>> } };
    const fetchCards = async (query: string) => {
      const response = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=10&select=id,name,number,set,rarity,images,tcgplayer`, {
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) return [] as ApiCard[];
      const payload = await response.json() as { data?: ApiCard[] };
      return payload.data || [];
    };
    const batches = await Promise.all(queries.map(fetchCards));
    const cards = [...new Map(batches.flat().map((card) => [card.id, card])).values()];
    return cards.map((card) => {
      const similarity = fuzzyNameSimilarity(evidence, card.name);
      let score = similarity * 6;
      if (numerator && card.number.toLowerCase() === numerator.toLowerCase()) score += 4;
      if (denominator && (String(card.set?.printedTotal || "") === denominator || String(card.set?.total || "") === denominator)) score += 3;
      return {
      id: card.id, cardName: card.name, collectorNumber: card.number,
      setName: card.set?.name || "", rarity: card.rarity, imageUrl: card.images?.small,
      marketPrice: marketPrice(card), matchConfidence: score >= 8 ? "high" as const : score >= 4.25 ? "medium" as const : "low" as const,
      score
    }; }).sort((a, b) => b.score - a.score).slice(0, 5).map(({ score: _score, ...card }) => card);
  } catch {
    return [];
  }
  })();
  searchCache.set(cacheKey, request);
  return request;
}

export async function scanPokemonCard(front: File, requestedType: PokemonProductCategory, back?: File, force = false, options: ScanOptions = {}) {
  const startedAt = performance.now();
  let previousStage: CardScanStage | undefined;
  let previousStageAt = startedAt;
  const stage = (name: CardScanStage) => {
    checkAbort(options.signal);
    const now = performance.now();
    if (import.meta.env.DEV && previousStage) console.info("[Card scan stage:complete]", { stage: previousStage, durationMs: Math.round(now - previousStageAt) });
    previousStage = name;
    previousStageAt = now;
    options.onStage?.(name);
    if (import.meta.env.DEV) console.info("[Card scan stage:start]", { stage: name, elapsedMs: Math.round(now - startedAt), imageBytes: front.size });
  };
  stage("Preparing image");
  const hash = `${await imageHash(front)}:${back ? await imageHash(back) : ""}`;
  const cacheKey = `4nerds_name_correction_v1_${hash}`;
  if (!force) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return { suggestion: JSON.parse(cached) as CardScanSuggestion, hash, cached: true };
    } catch { /* Local caching is optional. */ }
  }

  const task = serializedOcr(async () => {
    stage("Detecting and cropping card");
    const corrected = await detectAndCorrectCard(front);
    checkAbort(options.signal);
    const frontImage = await imageElement(corrected.file);
    if (import.meta.env.DEV) console.info("[Card scan image]", { width: frontImage.naturalWidth, height: frontImage.naturalHeight, processedBytes: corrected.file.size, cardDetected: corrected.detected });
    const qualityWarnings = photoQualityWarnings(frontImage);
    stage("Initializing OCR");
    await timed(worker(), 12_000, "OCR could not start on this device.");
    stage("Reading card text");
    const full = await recognize(crop(frontImage, 0.01, 0.01, 0.98, 0.98, 1, false), "6");
    const top = await recognizeBest(frontImage, [0.03, 0.01, 0.94, 0.27], "7", 2.5);
    checkAbort(options.signal);
    stage("Reading collector number");
    const bottom = await recognizeBest(frontImage, [0.01, 0.74, 0.98, 0.25], "7", 3);
    stage("Reading sticker");
    const stickerRight = await recognizeBest(frontImage, [0.52, 0.05, 0.47, 0.90], "11", 2);
    const stickerLeft = await recognize(crop(frontImage, 0.01, 0.05, 0.47, 0.90, 2, false), "11");
    const sticker: OcrRegion = {
      text: `${stickerRight.text}\n${stickerLeft.text}`.trim(),
      confidence: Math.max(stickerRight.confidence, stickerLeft.confidence)
    };
    let label: OcrRegion = { text: "", confidence: 0 };
    if (requestedType === "graded_card") {
      const labelSource = back ? await imageElement(await compressSaleImage(back)) : frontImage;
      label = await recognizeBest(labelSource, [0.02, 0.01, 0.96, 0.40], "11", 2.5);
    }
    const rawNameCandidate = cardNameFrom(top.text, top.confidence) || cardNameFrom(full.text, full.confidence);
    const collectorNumber = collectorNumberFrom(`${bottom.text}\n${full.text}`, bottom.confidence);
    const stickerText = `${sticker.text}\n${bottom.text}\n${full.text}`;
    const condition = conditionFrom(stickerText);
    const stickerPrice = priceFrom(stickerText);
    const slab = slabFields(`${top.text}\n${label.text}`);
    stage("Visual matching");
    const visual = await timed(visualCardMatches(corrected.file, rawNameCandidate, collectorNumber), 18_000, "Visual matching took too long; using OCR search instead.")
      .catch(() => ({ matches: [] as CardMatch[], warning: "Visual matching was skipped because it took too long." }));
    stage("Searching Pokémon cards");
    const textMatches = visual.matches.length ? [] : await timed(findPokemonCards(rawNameCandidate, collectorNumber, confidence(top.confidence)), 15_000, "Pokémon card search timed out.");
    const possibleMatches = visual.matches.length ? visual.matches : textMatches;
    const correctedNameCandidate = possibleMatches[0]?.cardName;
    const correctedNameConfidence = possibleMatches[0]?.matchConfidence;
    const warnings: string[] = [...qualityWarnings];
    warnings.push(corrected.detected ? "Card boundary detected and perspective corrected." : "Automatic card boundary detection failed. Using the full photo; crop again if background dominates.");
    if (visual.warning) warnings.push(visual.warning);
    if (!correctedNameCandidate) warnings.push("No reliable corrected card name was found. Search manually or choose from possible matches.");
    if (!collectorNumber) warnings.push("Collector number was not clear enough to suggest.");
    if (!possibleMatches.length && (rawNameCandidate || collectorNumber)) warnings.push("No Pokémon TCG API match was found. Raw OCR remains available only in Technical Details.");
    const fieldConfidence = {
      cardName: correctedNameConfidence || "low" as const, collectorNumber: confidence(bottom.confidence),
      cardSet: possibleMatches.length ? "medium" as const : "low" as const, language: "low" as const,
      condition: condition ? confidence(sticker.confidence) : "low" as const,
      stickerPrice: stickerPrice != null ? confidence(sticker.confidence) : "low" as const,
      gradingCompany: slab.gradingCompany ? confidence(label.confidence || top.confidence) : "low" as const,
      grade: slab.grade ? confidence(label.confidence || top.confidence) : "low" as const,
      certificateNumber: slab.certificateNumber ? confidence(label.confidence || top.confidence) : "low" as const,
    };
    const strongest = Math.max(full.confidence, top.confidence, bottom.confidence, sticker.confidence, label.confidence);
    const evidence = nameEvidence(rawNameCandidate || "");
    const apiQuery = [
      evidence.cleanedFull ? `name:"${evidence.cleanedFull}"` : evidence.strongestWord ? `name:${evidence.strongestWord}` : "",
      collectorNumber ? `number:${collectorNumber.split("/")[0].replace(/[^A-Za-z0-9]/g, "")}` : ""
    ].filter(Boolean).join(" ");
    if (import.meta.env.DEV) console.info("[Local card OCR:result]", {
      fullText: full.text, topText: top.text, bottomText: bottom.text, stickerText: sticker.text,
      confidence: { full: full.confidence, top: top.confidence, bottom: bottom.confidence, sticker: sticker.confidence },
      parsed: { correctedNameCandidate, collectorNumber, condition, stickerPrice }, apiQuery, apiMatchCount: possibleMatches.length
    });
    stage("Preparing review");
    const suggestion = {
      suggestedType: requestedType === "graded_card" ? "graded_card" as const : "raw_card" as const,
      cardName: null, correctedNameCandidate, correctedNameConfidence,
      collectorNumber, cardSet: null, language: null, condition, stickerPrice,
      gradingCompany: slab.gradingCompany, grade: slab.grade, certificateNumber: slab.certificateNumber,
      labelInformation: label.text || null, barcodeText: null, overallConfidence: confidence(strongest),
      fieldConfidence, possibleMatches, warnings,
      technicalDetails: {
        fullText: full.text, topText: top.text, bottomText: bottom.text, stickerText: sticker.text,
        confidence: { full: full.confidence, top: top.confidence, bottom: bottom.confidence, sticker: sticker.confidence, label: label.confidence },
        parsed: { correctedNameCandidate, collectorNumber, condition, stickerPrice },
        apiQuery, apiMatchCount: possibleMatches.length
      }
    } satisfies CardScanSuggestion;
    return { suggestion, correctedFile: corrected.file, cardDetected: corrected.detected };
  }).finally(scheduleWorkerTermination);
  const analysis = await timed(task, 60_000, "Scanning took too long on this device. Retake the photo, crop the card, or enter the details manually.", () => void cancelCardScan());

  try { localStorage.setItem(cacheKey, JSON.stringify(analysis.suggestion)); } catch { /* Cache is optional. */ }
  return { ...analysis, hash, cached: false };
}
