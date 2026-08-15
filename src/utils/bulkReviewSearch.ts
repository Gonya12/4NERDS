import {
  normalizeCardSearchText,
  parseCardSearchQuery,
} from "../../supabase/functions/_shared/pokemonCardSearchCore.ts";
import {
  normalizePokemonCardIdentification,
  rankScannerCandidates,
  scannerCandidateEvidence,
  scannerCardNameSimilarity,
} from "../../supabase/functions/_shared/pokemonCardIdentificationCore.ts";
import type { CardMatch } from "../services/sales/cardScanService.ts";

export type BulkReviewSearchSource = {
  id: string;
  recognizedName?: string | null;
  recognizedCollectorNumber?: string | null;
  recognizedSet?: string | null;
  recognizedCardGame?: string | null;
  recognizedLanguage?: string | null;
  rawRecognition?: Record<string, unknown>;
  selectedCandidate?: CardMatch;
  alternativeCandidates?: CardMatch[];
};

export function normalizeBulkReviewSearchIntent(source: BulkReviewSearchSource) {
  const rawName = String(source.recognizedName || source.selectedCandidate?.name || "").trim();
  // Only collapse separators immediately before a known printed card class so
  // legitimate species punctuation such as Ho-Oh remains intact.
  const parseableName = rawName.replace(/\s*[-‐‑‒–—―]\s*(?=(?:ex|gx|v|vmax|vstar|break|lv\.?\s*x)\s*$)/i, " ");
  const parsed = parseCardSearchQuery({ query: parseableName, name: parseableName });
  const baseName = parsed.baseName || parsed.name || parsed.originalName;
  const cardClass = normalizeCardSearchText(parsed.suffix);
  const normalizedBase = normalizeCardSearchText(baseName);
  const normalizedName = [normalizedBase, cardClass].filter(Boolean).join(" ");
  const game = source.recognizedCardGame === "one_piece" ? "one_piece" as const : "pokemon" as const;
  const language = source.recognizedLanguage === "ja" ? "ja" as const : "en" as const;
  const cacheKey = [game, language, normalizedBase, cardClass].filter(Boolean).join("|");
  return { rawName, normalizedName, baseName, cardClass, game, language, cacheKey, correction: parsed.correction?.suggestion };
}

function recognitionFor(source: BulkReviewSearchSource) {
  return normalizePokemonCardIdentification({
    ...(source.rawRecognition || {}),
    card_name: source.recognizedName || source.rawRecognition?.card_name,
    pokemon_name: source.recognizedName || source.rawRecognition?.pokemon_name,
    collector_number: source.recognizedCollectorNumber || source.rawRecognition?.collector_number,
    set_name_hint: source.recognizedSet || source.rawRecognition?.set_name_hint,
    card_game: source.recognizedCardGame || source.rawRecognition?.card_game || "pokemon",
    language: source.recognizedLanguage || source.rawRecognition?.language || "en",
  });
}

export function filterBulkReviewCandidatesLocally(matches: CardMatch[], source: BulkReviewSearchSource) {
  const intent = normalizeBulkReviewSearchIntent(source);
  if (!intent.normalizedName) return matches;
  return matches.filter((match) => {
    const candidate = parseCardSearchQuery({ query: match.name, name: match.name, disableCorrection: true });
    const candidateClass = normalizeCardSearchText(candidate.suffix);
    const baseSimilarity = scannerCardNameSimilarity(intent.baseName, candidate.baseName || candidate.name);
    if (baseSimilarity < 0.58) return false;
    if (intent.cardClass && candidateClass && intent.cardClass !== candidateClass) return false;
    if (intent.cardClass && !candidateClass) return false;
    return true;
  });
}

export function rankBulkReviewCandidatesLocally(matches: CardMatch[], source: BulkReviewSearchSource) {
  const evidence = scannerCandidateEvidence(recognitionFor(source));
  return rankScannerCandidates(filterBulkReviewCandidatesLocally(matches, source), evidence);
}
