import type { CardCondition, PokemonProductCategory } from "../../types/models";
import { fileToDataUrl } from "../images/saleImageService";
import { isSupabaseConfigured, supabase } from "../../utils/supabase";

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
  const { data, error } = await supabase.functions.invoke("card-scan", {
    body: { frontImage: await fileToDataUrl(front), backImage: back ? await fileToDataUrl(back) : undefined, requestedType },
  });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Card analysis failed.");
  localStorage.setItem(cacheKey, JSON.stringify(data));
  return { suggestion: data as CardScanSuggestion, hash, cached: false };
}
