import type { CardCondition, PokemonProductCategory } from "../../types/models";
import { fileToDataUrl } from "../images/saleImageService";
import { compressSaleImage } from "../images/saleImageService";
import { isSupabaseConfigured, supabase } from "../../utils/supabase";
import { z } from "zod";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

export type ScanConfidence = "high" | "medium" | "low";
export type CardScanSuggestion = {
  suggestedType: Extract<PokemonProductCategory, "raw_card" | "graded_card" | "sealed_product" | "other_pokemon_product"> | null;
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
};

const confidenceSchema = z.enum(["high", "medium", "low"]);
const suggestionSchema = z.object({
  suggestedType: z.enum(["raw_card", "graded_card", "sealed_product", "other_pokemon_product"]).nullable(),
  cardName: z.string().nullable(), collectorNumber: z.string().nullable(), cardSet: z.string().nullable(),
  language: z.string().nullable(), condition: z.enum(["Mint", "Near Mint / NM", "Lightly Played / LP", "Moderately Played / MP", "Heavily Played / HP", "Damaged"]).nullable(),
  stickerPrice: z.number().nonnegative().nullable(), gradingCompany: z.string().nullable(), grade: z.string().nullable(),
  certificateNumber: z.string().nullable(), labelInformation: z.string().nullable(), barcodeText: z.string().nullable(),
  overallConfidence: confidenceSchema, fieldConfidence: z.record(z.string(), confidenceSchema)
});

export async function imageHash(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function scanPokemonCard(front: File, requestedType: PokemonProductCategory, back?: File, force = false) {
  const hash = `${await imageHash(front)}:${back ? await imageHash(back) : ""}`;
  const cacheKey = `4nerds_card_scan_${hash}`;
  if (!force) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return { suggestion: JSON.parse(cached) as CardScanSuggestion, hash, cached: true };
    } catch { /* Scan caching is optional. */ }
  }
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase must be configured to scan cards.");
  const preparedFront = await compressSaleImage(front);
  const preparedBack = back ? await compressSaleImage(back) : undefined;
  const { data, error } = await supabase.functions.invoke("card-scan", {
    body: { frontImage: await fileToDataUrl(preparedFront), backImage: preparedBack ? await fileToDataUrl(preparedBack) : undefined, requestedType },
    signal: AbortSignal.timeout(60_000),
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response;
      const details = await response.clone().json().catch(() => null) as { error?: string } | null;
      throw new Error(details?.error || `Card scanner returned HTTP ${response.status}.`);
    }
    if (error instanceof FunctionsRelayError) throw new Error("The scanner function relay failed. Confirm card-scan is deployed to this Supabase project.");
    if (error instanceof FunctionsFetchError) throw new Error("The scanner function was not reached. Check deployment, internet access, and CORS/preflight configuration.");
    throw new Error(error.message || "Card analysis failed.");
  }
  if (data?.error || data?.success === false) throw new Error(data?.error || "Card analysis failed.");
  const candidate = data?.suggestions ? {
    suggestedType: data.cardType || requestedType, ...data.suggestions,
    cardSet: data.suggestions.setName ?? data.suggestions.cardSet ?? null,
    overallConfidence: data.overallConfidence || confidenceSchema.safeParse(data.confidence?.overall).data || "low",
    fieldConfidence: data.confidence || {}
  } : data;
  const parsed = suggestionSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("Card scanner returned an invalid response. No suggestions were applied.");
  localStorage.setItem(cacheKey, JSON.stringify(parsed.data));
  return { suggestion: parsed.data as CardScanSuggestion, hash, cached: false };
}
