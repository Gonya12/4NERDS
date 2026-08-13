import type { Worker } from "tesseract.js";
import type { CardCondition, PokemonProductCategory } from "../../types/models";
import type {
  CardDataProvider,
  CardGame,
  CardLanguage,
} from "../../../supabase/functions/_shared/unifiedCardSearchCore.ts";
import {
  buildPokemonIdentificationSearchAttempts,
  identificationConfidenceLabel,
  isStrongVisualCatalogMatch,
  type PokemonCardIdentification,
} from "../../../supabase/functions/_shared/pokemonCardIdentificationCore.ts";
import { extractOnePieceCardCode } from "../../../supabase/functions/_shared/unifiedCardSearchCore.ts";
import { compressSaleImage, prepareCardRecognitionImage } from "../images/saleImageService";
import { automaticallyPrepareCard, terminateCardImageWorker } from "./cardImageProcessor";
import {
  buildNameEvidence,
  buildPokemonApiQueries,
  conditionFromVisibleText,
  extractRawNameCandidate,
  parseCollectorNumber,
  stickerPriceFromVisibleText,
} from "./cardScanParsing";
import {
  cardProviderLabel,
  fetchPokemonCardById,
  pricingFromUnifiedCard,
  searchPokemonCards,
  searchPokemonCardsManually,
  type CardMatch,
  type ManualCardSearchInput,
  type ManualCardSearchPage,
  type ScanConfidence,
  type TcgplayerPricing,
  type TcgplayerPriceVariant,
} from "./pokemonCardSearchService";

export { searchPokemonCards, searchPokemonCardsManually };
export type {
  CardMatch,
  ManualCardSearchInput,
  ManualCardSearchPage,
  ScanConfidence,
  TcgplayerPricing,
  TcgplayerPriceVariant,
};
export type CardScanSuggestion = {
  suggestedType: Extract<PokemonProductCategory, "raw_card" | "graded_card"> | null;
  cardName: string | null;
  collectorNumber: string | null;
  cardSet: string | null;
  language: string | null;
  cardGame?: CardGame;
  cardLanguage?: CardLanguage;
  dataProvider?: CardDataProvider;
  providerCardId?: string;
  cardCode?: string;
  marketPriceCurrency?: string;
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
  aiIdentification?: PokemonCardIdentification;
  aiRecognitionConfidence?: number;
  likelyMatchProviderId?: string;
  correctedNameCandidate?: string | null;
  correctedNameConfidence?: ScanConfidence;
  officialImageUrl?: string;
  cardSetId?: string;
  cardSetCode?: string;
  cardRarity?: string;
  pokemonTcgCardId?: string;
  tcgplayerUrl?: string;
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
    identificationProvider?: string;
    visualIdentification?: PokemonCardIdentification;
  };
};

type OcrRegion = { text: string; confidence: number };
export type CardScanStage =
  | "Preparing image"
  | "Detecting and cropping card"
  | "Reading card"
  | "Matching with TCG database"
  | "Found likely match"
  | "Reading visible text fallback"
  | "Initializing OCR"
  | "Reading card name"
  | "Reading collector number"
  | "Reading sticker"
  | "Reading full card fallback"
  | "Searching card catalog"
  | "Preparing review";
type ScanOptions = {
  signal?: AbortSignal;
  onStage?: (stage: CardScanStage) => void;
  skipCrop?: boolean;
  game?: CardGame;
  language?: CardLanguage;
};

let workerPromise: Promise<Worker> | null = null;
let workerIdleTimer: number | undefined;
let ocrQueue: Promise<unknown> = Promise.resolve();

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

function devCardScanLog(event: string, details: Record<string, unknown>) {
  if (import.meta.env.DEV) console.info("[Visual card scanner]", { event, ...details });
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

/*
 * The previous client-side Pokémon API implementation intentionally remains
 * visible in source history during this migration, but is disabled here.
 * Search traffic now goes through pokemonCardSearchService and the Edge
 * Function so browser code never owns an API key or a competing query path.
function marketPrice(card: RankablePokemonCard) {
  const values = Object.values(card.tcgplayer?.prices || {})
    .map((group) => group.market)
    .filter((value): value is number => typeof value === "number");
  return values[0];
}

function pricingFromCard(card: RankablePokemonCard): TcgplayerPricing {
  const variants = Object.entries(card.tcgplayer?.prices || {}).map(([variant, price]) => ({
    variant,
    market: typeof price.market === "number" ? price.market : undefined,
    low: typeof price.low === "number" ? price.low : undefined,
    mid: typeof price.mid === "number" ? price.mid : undefined,
    high: typeof price.high === "number" ? price.high : undefined,
    directLow: typeof price.directLow === "number" ? price.directLow : undefined,
  }));
  return {
    url: card.tcgplayer?.url,
    updatedAt: card.tcgplayer?.updatedAt,
    checkedAt: new Date().toISOString(),
    variants,
    selectedVariant: variants.length === 1 ? variants[0].variant : undefined,
    targetPercent: 75,
  };
}

function cardMatch(card: RankablePokemonCard, matchScore: number, reasons: string[]): CardMatch {
  return {
    id: card.id,
    cardName: card.name,
    collectorNumber: card.number,
    setName: card.set?.name || "",
    setId: card.set?.id,
    setCode: card.set?.ptcgoCode || card.set?.id,
    setReleaseDate: card.set?.releaseDate,
    rarity: card.rarity,
    imageUrl: card.images?.small,
    largeImageUrl: card.images?.large,
    marketPrice: marketPrice(card),
    supertype: card.supertype,
    subtypes: card.subtypes,
    tcgplayerPricing: pricingFromCard(card),
    matchConfidence: confidenceFromMatchScore(matchScore),
    matchScore,
    reasons,
  };
}

function fetchWithTimeout(url: string, signal?: AbortSignal, timeoutMs = 8_000, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  });
}

const pokemonCardSelect = "id,name,number,set,rarity,images,tcgplayer,subtypes,supertype";

type PokemonApiPayload = {
  data?: RankablePokemonCard[] | RankablePokemonCard;
  page?: number;
  pageSize?: number;
  count?: number;
  totalCount?: number;
};

function pokemonApiError(status: number, payload?: { error?: string; message?: string }) {
  if (status === 429) return new Error("Pokémon TCG API rate limit reached. Wait a moment, then try again.");
  return new Error(payload?.error || payload?.message || `Pokémon TCG API request failed (${status}).`);
}

async function fetchPokemonApi(
  request: { q?: string; id?: string; page?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<PokemonApiPayload> {
  checkAbort(signal);
  if (isSupabaseConfigured && supabaseUrl && supabasePublishableKey) {
    try {
      const proxied = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/${CARD_SEARCH_FUNCTION_NAME}`,
        signal,
        8_000,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: supabasePublishableKey,
            Authorization: `Bearer ${supabasePublishableKey}`,
          },
          body: JSON.stringify(request),
        },
      );
      const payload = await proxied.json().catch(() => ({})) as PokemonApiPayload & { error?: string; message?: string };
      if (!proxied.ok) throw pokemonApiError(proxied.status, payload);
      return payload;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (error instanceof Error && /rate limit/i.test(error.message)) throw error;
      // Local mode and projects that have not deployed the function can use the
      // public anonymous allowance without exposing a server secret.
    }
  }

  const url = "disabled-legacy-client-route";
  const response = await fetchWithTimeout(url, signal);
  const payload = await response.json().catch(() => ({})) as PokemonApiPayload & { error?: string; message?: string };
  if (!response.ok) throw pokemonApiError(response.status, payload);
  return payload;
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
      const payload = await fetchPokemonApi({ q: query, page: 1, pageSize: 10 }, signal);
      const rows = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
      for (const card of rows) cards.set(card.id, card);
      if (cards.size >= 10) break;
    } catch (error) {
      if (signal?.aborted) throw abortError();
    }
  }
  const matches = rankPokemonCards([...cards.values()], evidence, collector)
    // Keep only cards supported by a reliable name or an exact printed number.
    // Broad API results must never become a scanner suggestion by themselves.
    .filter((card) => card.number.toUpperCase() === collector?.numerator?.toUpperCase()
      || (evidence.isReliable && card.matchScore >= 48))
    .slice(0, 5)
    .map((card) => cardMatch(card, card.matchScore, card.reasons));
  if (searchCache.size >= 50) searchCache.delete(searchCache.keys().next().value as string);
  searchCache.set(cacheKey, matches);
  return matches;
}

export function searchPokemonCardsManually(input: ManualCardSearchInput, signal?: AbortSignal) {
  const validationError = manualCardSearchValidationError(input);
  if (validationError) return Promise.reject(new Error(validationError));
  const normalizedTerms = normalizeManualCardSearchTerms(input);
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.min(20, Math.max(1, Math.floor(input.pageSize || 20)));
  const collector = parseCollectorNumber(normalizedTerms.collectorNumber);
  const ignoredCollector = Boolean(normalizedTerms.collectorNumber && !collector);
  const safeTerms = { ...normalizedTerms, collectorNumber: collector?.normalized || "" };
  const query = buildManualPokemonQuery(safeTerms);
  const cacheKey = JSON.stringify({ query, language: normalizedTerms.language.toLocaleLowerCase(), page, pageSize });
  const cached = manualSearchCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  const existing = manualSearchInFlight.get(cacheKey);
  if (existing) return existing;

  const fallbackQuery = normalizedTerms.set
    ? buildManualPokemonQuery({ ...safeTerms, set: "" })
    : "";
  const promise = (async () => {
    let payload = await fetchPokemonApi({ q: query, page, pageSize }, signal);
    let rows = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
    // A set name is optional. If it is stale or malformed, name/number results
    // are more useful than an empty result or an upstream query error.
    if (!rows.length && fallbackQuery && fallbackQuery !== query) {
      payload = await fetchPokemonApi({ q: fallbackQuery, page, pageSize }, signal);
      rows = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
    }
    const evidence = buildNameEvidence(normalizedTerms.name);
    const ranked = normalizedTerms.name || collector
      ? rankPokemonCards(rows, evidence, collector)
      : rows.map((card) => ({ ...card, matchScore: 50, reasons: ["set search candidate"] }));
    const matches = ranked.map((card) => cardMatch(card, card.matchScore, card.reasons));
    const totalCount = Number(payload.totalCount || matches.length);
    const result: ManualCardSearchPage = {
      matches,
      page,
      pageSize,
      totalCount,
      hasMore: page * pageSize < totalCount,
      normalizedTerms,
      warnings: ignoredCollector ? ["Collector number was ignored because its format was not recognized."] : undefined,
    };
    if (manualSearchCache.size >= 75) manualSearchCache.delete(manualSearchCache.keys().next().value as string);
    manualSearchCache.set(cacheKey, result);
    return result;
  })().finally(() => {
    manualSearchInFlight.delete(cacheKey);
  });
  manualSearchInFlight.set(cacheKey, promise);
  return promise;
}

*/
export async function confirmPokemonCardMatch(suggestion: CardScanSuggestion, match: CardMatch, signal?: AbortSignal) {
  let pricing = pricingFromUnifiedCard(match);
  let detailedMatch = match;
  if (!match.pricing) {
    try {
      const card = await fetchPokemonCardById(match.providerCardId, signal, {
        game: match.game,
        language: match.language,
      });
      if (card) {
        pricing = pricingFromUnifiedCard(card);
        detailedMatch = { ...match, ...card };
      }
    } catch (error) {
      if (signal?.aborted) throw abortError();
    }
  }
  return {
    ...suggestion,
    cardName: detailedMatch.name,
    collectorNumber: detailedMatch.collectorNumber || null,
    cardSet: detailedMatch.setName || null,
    cardSetId: detailedMatch.setId,
    cardSetCode: detailedMatch.setCode,
    cardRarity: detailedMatch.rarity,
    cardGame: detailedMatch.game,
    cardLanguage: detailedMatch.language,
    language: detailedMatch.language,
    dataProvider: detailedMatch.provider,
    providerCardId: detailedMatch.providerCardId,
    cardCode: detailedMatch.cardCode,
    marketPriceCurrency: detailedMatch.pricing?.currency,
    pokemonTcgCardId: detailedMatch.provider === "pokemontcg" ? detailedMatch.providerCardId : undefined,
    officialImageUrl: detailedMatch.imageLarge || detailedMatch.imageSmall,
    tcgplayerUrl: pricing.url,
    fieldConfidence: {
      ...suggestion.fieldConfidence,
      cardName: detailedMatch.matchConfidence,
      collectorNumber: detailedMatch.matchConfidence,
      cardSet: detailedMatch.matchConfidence,
    },
    possibleMatches: [],
    tcgplayerPricing: pricing,
  };
}

async function scanPokemonCardWithVisualAi(
  preparedFront: File,
  requestedType: PokemonProductCategory,
  hash: string,
  cacheKey: string,
  options: ScanOptions,
  startedAt: number,
) {
  options.onStage?.("Reading card");
  const { identifyPokemonCardVisually, matchPokemonIdentification } = await import("./pokemonCardIdentificationService");
  const identification = await identifyPokemonCardVisually(preparedFront, options.signal);
  devCardScanLog("vision succeeded", {
    extractedName: identification.card_name || identification.pokemon_name,
    extractedCollectorNumber: identification.collector_number,
    extractedSetHint: identification.set_name_hint || identification.set_code_hint,
    confidence: identification.confidence,
    visibleText: identification.visible_text,
  });
  checkAbort(options.signal);
  const recognitionConfidence = identificationConfidenceLabel(identification.confidence);
  options.onStage?.("Matching with TCG database");
  const possibleMatches = await matchPokemonIdentification(identification, options.signal);
  devCardScanLog("catalog matching complete", {
    candidateSearchQuery: buildPokemonIdentificationSearchAttempts(identification).map((attempt) => ({
      name: attempt.name,
      collectorNumber: attempt.collectorNumber,
      set: attempt.set,
    })),
    candidateCount: possibleMatches.length,
  });
  checkAbort(options.signal);
  const likelyMatch = isStrongVisualCatalogMatch(identification, possibleMatches) ? possibleMatches[0] : undefined;
  if (likelyMatch) options.onStage?.("Found likely match");
  const detectedLanguage = identification.language === "ja" ? "ja" : "en";
  const correctedNameCandidate = identification.card_name || identification.pokemon_name || identification.visible_text[0] || null;
  const warnings = [...identification.notes];
  if (identification.confidence < 0.5) warnings.push("AI recognition confidence is low. Confirm the detected text or search manually.");
  if (!possibleMatches.length) warnings.push(`No ${detectedLanguage === "ja" ? "TCGdex" : "Pokémon TCG API"} match was found. Search manually with the detected text.`);
  const fieldConfidence = {
    cardName: correctedNameCandidate ? recognitionConfidence : "low" as const,
    collectorNumber: identification.collector_number ? recognitionConfidence : "low" as const,
    cardSet: identification.set_name_hint || identification.set_code_hint ? recognitionConfidence : "low" as const,
    language: identification.language !== "unknown" ? recognitionConfidence : "low" as const,
    condition: "low" as const,
    stickerPrice: "low" as const,
    gradingCompany: "low" as const,
    grade: "low" as const,
    certificateNumber: "low" as const,
  };
  const suggestion = {
    suggestedType: requestedType === "graded_card" ? "graded_card" as const : "raw_card" as const,
    cardName: null,
    correctedNameCandidate,
    correctedNameConfidence: recognitionConfidence,
    collectorNumber: identification.collector_number,
    cardSet: identification.set_name_hint || identification.set_code_hint,
    language: detectedLanguage,
    cardGame: "pokemon" as const,
    cardLanguage: detectedLanguage,
    dataProvider: "manual" as const,
    condition: null,
    stickerPrice: null,
    gradingCompany: null,
    grade: null,
    certificateNumber: null,
    labelInformation: null,
    barcodeText: null,
    overallConfidence: recognitionConfidence,
    fieldConfidence,
    possibleMatches,
    aiIdentification: identification,
    aiRecognitionConfidence: identification.confidence,
    likelyMatchProviderId: likelyMatch?.providerCardId,
    warnings,
    technicalDetails: {
      fullText: "",
      topText: "",
      bottomText: "",
      stickerText: "",
      confidence: { gemini: Math.round(identification.confidence * 100) },
      parsed: {
        cardName: identification.card_name,
        pokemonName: identification.pokemon_name,
        collectorNumber: identification.collector_number,
        setNameHint: identification.set_name_hint,
        setCodeHint: identification.set_code_hint,
        language: identification.language,
      },
      apiQuery: buildPokemonIdentificationSearchAttempts(identification).map((attempt) => attempt.reason).join(" → "),
      apiMatchCount: possibleMatches.length,
      cropMethod: options.skipCrop ? "user-selected crop/full image" : "optimized card image",
      processingMs: Math.round(performance.now() - startedAt),
      identificationProvider: "Gemini visual identification",
      visualIdentification: identification,
    },
  } satisfies CardScanSuggestion;
  try {
    localStorage.setItem(cacheKey, JSON.stringify(suggestion));
  } catch {
    // Cache is optional.
  }
  return { suggestion, correctedFile: preparedFront, cardDetected: false, hash, cached: false };
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
  const preparedFront = await prepareCardRecognitionImage(front);
  const preparedBack = back ? await compressSaleImage(back) : undefined;
  if (import.meta.env.DEV) {
    const processedImage = await imageElement(preparedFront);
    devCardScanLog("image prepared", {
      originalFileSize: front.size,
      processedFileSize: preparedFront.size,
      processedWidth: processedImage.naturalWidth,
      processedHeight: processedImage.naturalHeight,
      mimeType: preparedFront.type,
    });
  }
  const hash = `${await imageHash(preparedFront)}:${preparedBack ? await imageHash(preparedBack) : ""}`;
  const scanGame = options.game || "pokemon";
  const scanLanguage = scanGame === "pokemon" ? options.language || "en" : "en";
  const cacheKey = `4nerds_card_scan_v4_${scanGame}_${scanLanguage}_${hash}`;
  if (!force) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return { suggestion: JSON.parse(cached) as CardScanSuggestion, hash, cached: true };
    } catch {
      // Cache is optional.
    }
  }

  let visualFailure: unknown;
  if (scanGame === "pokemon") {
    try {
      return await scanPokemonCardWithVisualAi(preparedFront, requestedType, hash, cacheKey, options, startedAt);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      visualFailure = error;
      devCardScanLog("vision failed; starting local text fallback", {
        upstreamErrorCode: error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "UNKNOWN") : "UNKNOWN",
        message: error instanceof Error ? error.message : "Unknown recognition error",
      });
      options.onStage?.("Reading visible text fallback");
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

    const selectedGame = options.game || "pokemon";
    const selectedLanguage = selectedGame === "pokemon" ? options.language || "en" : "en";
    const onePieceCode = selectedGame === "one_piece"
      ? extractOnePieceCardCode(`${bottom.text}\n${full.text}`)
      : "";
    const searchableName = selectedGame === "one_piece"
      ? rawNameCandidate || null
      : nameEvidence.isReliable ? nameEvidence.candidates[0] || null : null;
    const searchableNumber = onePieceCode || collector?.normalized || null;
    stage("Searching card catalog");
    const possibleMatches = await timed(
      searchPokemonCards(searchableName, searchableNumber, options.signal, {
        game: selectedGame,
        language: selectedLanguage,
      }),
      18_000,
      `${selectedGame === "one_piece" ? "OPTCG API" : selectedLanguage === "ja" ? "TCGdex" : "Pokémon card search"} timed out.`,
    ).catch((error) => {
      if (options.signal?.aborted) throw abortError();
      return [] as CardMatch[];
    });
    const correctedNameCandidate = possibleMatches[0]?.name
      || (selectedGame === "one_piece" ? rawNameCandidate : nameEvidence.isReliable ? nameEvidence.candidates[0] : undefined);
    const correctedNameConfidence = possibleMatches[0]?.matchConfidence
      || (correctedNameCandidate ? confidence(top.confidence) : undefined);
    const warnings = [...qualityWarnings];
    if (visualFailure) warnings.push("Visual recognition was unavailable; local text reading and the existing card catalog were used instead.");
    if (options.skipCrop) {
      warnings.push("The selected crop was used for OCR.");
    } else if (prepared.cropped) {
      warnings.push("Card boundary detected and perspective corrected.");
    } else {
      warnings.push("Automatic card detection was uncertain. Adjust the four corners before relying on OCR.");
    }
    if (!searchableName && !searchableNumber) warnings.push("No reliable card name or number was detected. Search manually or enter the card details.");
    if (!searchableNumber) warnings.push(selectedGame === "one_piece"
      ? "The One Piece card code was not clear enough to suggest."
      : "Collector number was not clear enough to suggest.");
    if (!possibleMatches.length && (rawNameCandidate || searchableNumber)) {
      const provider = selectedGame === "one_piece" ? "optcgapi" : selectedLanguage === "ja" ? "tcgdex" : "pokemontcg";
      warnings.push(`No ${cardProviderLabel(provider)} match was found. Raw OCR is available only under Technical Details.`);
    }
    const fieldConfidence = {
      cardName: correctedNameConfidence || "low" as const,
      collectorNumber: onePieceCode || collector ? confidence(bottom.confidence) : "low" as const,
      cardSet: possibleMatches.length ? "medium" as const : "low" as const,
      language: "low" as const,
      condition: condition ? confidence(sticker.confidence) : "low" as const,
      stickerPrice: stickerPrice != null ? confidence(sticker.confidence) : "low" as const,
      gradingCompany: slab.gradingCompany ? confidence(label.confidence || top.confidence) : "low" as const,
      grade: slab.grade ? confidence(label.confidence || top.confidence) : "low" as const,
      certificateNumber: slab.certificateNumber ? confidence(label.confidence || top.confidence) : "low" as const,
    };
    const strongest = Math.max(full.confidence, top.confidence, bottom.confidence, sticker.confidence, label.confidence);
    const apiQuery = selectedGame === "one_piece"
      ? [searchableName, searchableNumber].filter(Boolean).join(" ")
      : buildPokemonApiQueries(nameEvidence, collector).join(" | ");
    stage("Preparing review");
    const suggestion = {
      suggestedType: requestedType === "graded_card" ? "graded_card" as const : "raw_card" as const,
      cardName: null,
      correctedNameCandidate,
      correctedNameConfidence,
      collectorNumber: selectedGame === "one_piece" ? onePieceCode || null : collector?.normalized || null,
      cardCode: selectedGame === "one_piece" ? onePieceCode || undefined : undefined,
      cardSet: null,
      language: selectedLanguage,
      cardGame: selectedGame,
      cardLanguage: selectedLanguage,
      dataProvider: "manual" as const,
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
          collectorNumber: selectedGame === "one_piece" ? onePieceCode || null : collector?.normalized || null,
          cleanedCandidates: nameEvidence.candidateScores.map((candidate) => `${candidate.candidate}: ${Math.round(candidate.score * 100)}%`).join(", ") || null,
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
  if (visualFailure
    && !analysis.suggestion.possibleMatches?.length
    && !analysis.suggestion.correctedNameCandidate
    && !analysis.suggestion.collectorNumber) {
    throw visualFailure;
  }
  try {
    localStorage.setItem(cacheKey, JSON.stringify(analysis.suggestion));
  } catch {
    // Cache is optional.
  }
  return { ...analysis, hash, cached: false };
}
