import type { Worker } from "tesseract.js";
import type { CardCondition, PokemonProductCategory } from "../../types/models";
import { compressSaleImage } from "../images/saleImageService";

export type ScanConfidence = "high" | "medium" | "low";
export type CardMatch = {
  id: string; cardName: string; collectorNumber: string; setName: string;
  rarity?: string; imageUrl?: string; marketPrice?: number; matchConfidence: ScanConfidence;
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
  warnings: string[];
};

type OcrRegion = { text: string; confidence: number };
let workerPromise: Promise<Worker> | null = null;
let ocrQueue: Promise<unknown> = Promise.resolve();
let workerIdleTimer: number | undefined;
const searchCache = new Map<string, Promise<CardMatch[]>>();

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

function crop(image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * width));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * height));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not prepare the image for OCR.");
  context.filter = "grayscale(1) contrast(1.45)";
  context.drawImage(
    image,
    Math.round(image.naturalWidth * x), Math.round(image.naturalHeight * y),
    Math.round(image.naturalWidth * width), Math.round(image.naturalHeight * height),
    0, 0, canvas.width, canvas.height
  );
  return canvas;
}

async function recognize(canvas: HTMLCanvasElement): Promise<OcrRegion> {
  const engine = await worker();
  const result = await engine.recognize(canvas);
  return { text: result.data.text.trim(), confidence: Number(result.data.confidence || 0) };
}

function serializedOcr<T>(task: () => Promise<T>) {
  const run = ocrQueue.then(task, task);
  ocrQueue = run.catch(() => undefined);
  return run;
}

function cardNameFrom(text: string, score: number) {
  if (score < 45) return null;
  const ignored = /\b(?:pokemon|pokémon|basic|stage|trainer|energy|ability|weakness|resistance|retreat|illustrator|hp)\b/i;
  return text.split(/\r?\n/)
    .map((line) => line.replace(/[^\p{L}\p{N}' .:&-]/gu, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3 && line.length <= 32 && /[A-Za-z]{3}/.test(line) && !ignored.test(line))
    .sort((a, b) => a.length - b.length)[0] || null;
}

function collectorNumberFrom(text: string, score: number) {
  if (score < 42) return null;
  const fraction = text.match(/\b(?:[A-Z]{1,4}\s*)?\d{1,3}\s*\/\s*(?:[A-Z]{1,4}\s*)?\d{1,3}\b/i)?.[0];
  if (fraction) return fraction.replace(/\s+/g, "");
  return text.match(/\b(?:SV|TG|GG|RC|SH|SWSH|XY|SM|BW)?\d{1,3}[A-Z]?\b/i)?.[0] || null;
}

function conditionFrom(text: string): CardCondition | null {
  const normalized = ` ${text.toUpperCase().replace(/[^A-Z]+/g, " ")} `;
  if (/\sDMG\s|\sDAMAGED\s/.test(normalized)) return "Damaged";
  if (/\sHP\s|\sHEAVILY PLAYED\s/.test(normalized)) return "Heavily Played / HP";
  if (/\sMP\s|\sMODERATELY PLAYED\s/.test(normalized)) return "Moderately Played / MP";
  if (/\sLP\s|\sLIGHTLY PLAYED\s/.test(normalized)) return "Lightly Played / LP";
  if (/\sNM\s|\sNEAR MINT\s/.test(normalized)) return "Near Mint / NM";
  return null;
}

function priceFrom(text: string) {
  const match = text.match(/(?:\$\s*(\d{1,5}(?:[.,]\d{2})?)|(\d{1,5}(?:[.,]\d{2})?)\s*\$)(?!\d)/);
  if (!match) return null;
  const value = Number((match[1] || match[2]).replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function slabFields(text: string) {
  const gradingCompany = text.match(/\b(PSA|BGS|BECKETT|CGC|SGC|ACE)\b/i)?.[1]?.toUpperCase() || null;
  const grade = gradingCompany ? text.match(/\b(?:GEM\s*MINT|MINT|NM-MT|PRISTINE)?\s*(10(?:\.0)?|9\.5|9|8\.5|8|7\.5|7)\b/i)?.[1] || null : null;
  const certificateNumber = text.match(/\b(?:CERT(?:IFICATE)?\.?\s*(?:NO\.?|#)?\s*)?(\d[\d -]{6,15}\d)\b/i)?.[1]?.replace(/[ -]/g, "") || null;
  return { gradingCompany, grade, certificateNumber };
}

function marketPrice(card: { tcgplayer?: { prices?: Record<string, Record<string, number | null>> } }) {
  const prices = Object.values(card.tcgplayer?.prices || {}).flatMap((group) => [group.market, group.mid, group.low]).filter((value): value is number => typeof value === "number");
  return prices[0];
}

async function findPokemonCards(cardName: string | null, collectorNumber: string | null, nameConfidence: ScanConfidence): Promise<CardMatch[]> {
  if (!cardName && !collectorNumber) return [];
  const numerator = collectorNumber?.split("/")[0].replace(/[^A-Za-z0-9]/g, "") || "";
  const denominator = collectorNumber?.split("/")[1]?.replace(/\D/g, "") || "";
  const cleanName = cardName?.replace(/"/g, "").trim() || "";
  const nameQueryValue = cleanName.includes(" ") ? `"${cleanName}"` : cleanName;
  const clauses = [
    cleanName ? `${nameConfidence === "high" ? "!" : ""}name:${nameQueryValue}` : "",
    numerator ? `number:${numerator}` : ""
  ].filter(Boolean);
  const cacheKey = clauses.join(" ");
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
    let cards = await fetchCards(cacheKey);
    if (!cards.length && cardName && numerator) {
      const [nameMatches, numberMatches] = await Promise.all([
        fetchCards(clauses[0]), fetchCards(`number:${numerator}`)
      ]);
      cards = [...new Map([...nameMatches, ...numberMatches].map((card) => [card.id, card])).values()];
    }
    return cards.map((card) => {
      let score = 0;
      if (cardName && card.name.toLowerCase() === cardName.toLowerCase()) score += 4;
      else if (cardName && card.name.toLowerCase().includes(cardName.toLowerCase())) score += 2;
      if (numerator && card.number.toLowerCase() === numerator.toLowerCase()) score += 4;
      if (denominator && (String(card.set?.printedTotal || "") === denominator || String(card.set?.total || "") === denominator)) score += 3;
      return {
      id: card.id, cardName: card.name, collectorNumber: card.number,
      setName: card.set?.name || "", rarity: card.rarity, imageUrl: card.images?.small,
      marketPrice: marketPrice(card), matchConfidence: score >= 8 ? "high" as const : score >= 4 ? "medium" as const : "low" as const,
      score
    }; }).sort((a, b) => b.score - a.score).slice(0, 5).map(({ score: _score, ...card }) => card);
  } catch {
    return [];
  }
  })();
  searchCache.set(cacheKey, request);
  return request;
}

export async function scanPokemonCard(front: File, requestedType: PokemonProductCategory, back?: File, force = false) {
  const hash = `${await imageHash(front)}:${back ? await imageHash(back) : ""}`;
  const cacheKey = `4nerds_local_ocr_${hash}`;
  if (!force) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return { suggestion: JSON.parse(cached) as CardScanSuggestion, hash, cached: true };
    } catch { /* Local caching is optional. */ }
  }

  const suggestion = await serializedOcr(async () => {
    const preparedFront = await compressSaleImage(front);
    const frontImage = await imageElement(preparedFront);
    const top = await recognize(crop(frontImage, 0.03, 0.02, 0.94, 0.25));
    const bottom = await recognize(crop(frontImage, 0.02, 0.70, 0.96, 0.29));
    const sticker = await recognize(crop(frontImage, 0.50, 0.15, 0.49, 0.70));
    let label: OcrRegion = { text: "", confidence: 0 };
    if (requestedType === "graded_card") {
      const labelSource = back ? await imageElement(await compressSaleImage(back)) : frontImage;
      label = await recognize(crop(labelSource, 0.02, 0.01, 0.96, 0.38));
    }
    const cardName = cardNameFrom(top.text, top.confidence);
    const collectorNumber = collectorNumberFrom(bottom.text, bottom.confidence);
    const stickerText = `${sticker.text}\n${bottom.text}`;
    const condition = conditionFrom(stickerText);
    const stickerPrice = priceFrom(stickerText);
    const slab = slabFields(`${top.text}\n${label.text}`);
    const possibleMatches = await findPokemonCards(cardName, collectorNumber, confidence(top.confidence));
    const warnings: string[] = [];
    if (!cardName) warnings.push("Card name confidence was low; enter it manually or choose a possible match.");
    if (!collectorNumber) warnings.push("Collector number was not clear enough to suggest.");
    if (!possibleMatches.length && (cardName || collectorNumber)) warnings.push("No Pokémon TCG API match was found. OCR suggestions remain editable.");
    const fieldConfidence = {
      cardName: confidence(top.confidence), collectorNumber: confidence(bottom.confidence),
      cardSet: possibleMatches.length ? "medium" as const : "low" as const, language: "low" as const,
      condition: condition ? confidence(sticker.confidence) : "low" as const,
      stickerPrice: stickerPrice != null ? confidence(sticker.confidence) : "low" as const,
      gradingCompany: slab.gradingCompany ? confidence(label.confidence || top.confidence) : "low" as const,
      grade: slab.grade ? confidence(label.confidence || top.confidence) : "low" as const,
      certificateNumber: slab.certificateNumber ? confidence(label.confidence || top.confidence) : "low" as const,
    };
    const strongest = Math.max(top.confidence, bottom.confidence, sticker.confidence, label.confidence);
    return {
      suggestedType: requestedType === "graded_card" ? "graded_card" as const : "raw_card" as const,
      cardName, collectorNumber, cardSet: null, language: null, condition, stickerPrice,
      gradingCompany: slab.gradingCompany, grade: slab.grade, certificateNumber: slab.certificateNumber,
      labelInformation: label.text || null, barcodeText: null, overallConfidence: confidence(strongest),
      fieldConfidence, possibleMatches, warnings
    } satisfies CardScanSuggestion;
  }).finally(scheduleWorkerTermination);

  try { localStorage.setItem(cacheKey, JSON.stringify(suggestion)); } catch { /* Cache is optional. */ }
  return { suggestion, hash, cached: false };
}
