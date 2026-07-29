import {
  CARD_SUFFIXES,
  buildManualPokemonQuery,
  buildPokemonApiQueries as buildStructuredPokemonApiQueries,
  levenshtein,
  manualCardSearchValidationError,
  normalizeManualCardSearchTerms,
  parseCardSearchQuery,
  parseCollectorNumber,
  rankPokemonCardResults,
  suggestPokemonNameCorrection,
  textSimilarity,
  tokenSimilarity,
  type CollectorNumberParts,
  type ManualCardSearchTerms,
  type RankablePokemonCard,
  type RankedPokemonCard,
} from "../../../supabase/functions/_shared/pokemonCardSearchCore.ts";

export {
  CARD_SUFFIXES,
  buildManualPokemonQuery,
  levenshtein,
  manualCardSearchValidationError,
  normalizeManualCardSearchTerms,
  parseCardSearchQuery,
  parseCollectorNumber,
  rankPokemonCardResults,
  suggestPokemonNameCorrection,
  textSimilarity,
  tokenSimilarity,
};
export type { CollectorNumberParts, ManualCardSearchTerms, RankablePokemonCard, RankedPokemonCard };

export type NameEvidence = {
  raw: string;
  normalized: string;
  baseCandidate: string;
  suffix: string;
  candidates: string[];
  candidateScores: Array<{ candidate: string; score: number }>;
  isReliable: boolean;
};

const ignoredNameTokens = new Set([
  "pokemon", "pokémon", "basic", "stage", "trainer", "energy", "ability", "weakness", "resistance", "retreat",
  "illustrator", "card", "the", "this", "re", "hp",
]);

function cleanOcrName(raw: string) {
  return raw.normalize("NFKC")
    .replace(/[©®™]/g, " ")
    .replace(/\b(?:BASIC|STAGE\s*[12]|HP\s*\d*)\b/gi, " ")
    .replace(/[^\p{L}\p{N}'’.:&♀♂-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildNameEvidence(raw: string): NameEvidence {
  const normalized = cleanOcrName(raw);
  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  const suffixToken = [...rawTokens].reverse().find((token) => /^(?:ex|EX|GX|V|VMAX|VSTAR|BREAK|LV\.?X|Prime|Star|Radiant|Mega|M|it)$/i.test(token));
  const suffix = !suffixToken ? ""
    : /^it$/i.test(suffixToken) ? "ex"
      : suffixToken === "EX" ? "EX"
        : suffixToken.toLowerCase() === "ex" ? "ex"
          : suffixToken.toUpperCase().replace("LVX", "LV.X");
  const words = rawTokens
    .filter((token) => token !== suffixToken)
    .filter((token) => token.length >= 2 && /[\p{L}]/u.test(token))
    .filter((token) => !ignoredNameTokens.has(token.toLocaleLowerCase()));
  const joined = words.join(" ");
  const correction = suggestPokemonNameCorrection(joined);
  const parsed = parseCardSearchQuery({
    query: [correction?.suggestion || joined, suffix].filter(Boolean).join(" "),
    disableCorrection: true,
  });
  const baseCandidate = parsed.baseName;
  const isReliable = Boolean(baseCandidate && (correction || suggestPokemonNameCorrection(baseCandidate) === undefined)
    && !/\b(?:damage|resistance|retreat|ability|aerial)\b/i.test(baseCandidate));
  const primary = isReliable ? [baseCandidate, suffix].filter(Boolean).join(" ") : "";
  return {
    raw,
    normalized,
    baseCandidate: isReliable ? baseCandidate : "",
    suffix,
    candidates: primary ? [primary, baseCandidate].filter((value, index, values) => values.indexOf(value) === index) : [],
    candidateScores: correction ? [{ candidate: correction.matchedName, score: correction.similarity }] : [],
    isReliable,
  };
}

export function extractRawNameCandidate(text: string, confidence: number) {
  const lines = text.split(/\r?\n/)
    .map(cleanOcrName)
    .filter((line) => line.length >= 3 && line.length <= 48 && /\p{L}{3}/u.test(line))
    .filter((line) => !/\b(?:pokemon|pokémon|basic|stage|trainer|energy|ability|weakness|resistance|retreat|illustrator|damage)\b/i.test(line))
    .sort((left, right) => Number(buildNameEvidence(right).isReliable) - Number(buildNameEvidence(left).isReliable)
      || Number(/\d/.test(left)) - Number(/\d/.test(right))
      || left.length - right.length);
  return confidence >= 45 ? lines[0] || null : null;
}

export function conditionFromVisibleText(text: string) {
  const normalized = ` ${text.toUpperCase().replace(/[^A-Z]+/g, " ")} `;
  if (/\sDMG\s|\sDAMAGED\s/.test(normalized)) return "Damaged" as const;
  if (/\sHP\s|\sHEAVILY PLAYED\s/.test(normalized)) return "Heavily Played / HP" as const;
  if (/\sMP\s|\sMODERATELY PLAYED\s/.test(normalized)) return "Moderately Played / MP" as const;
  if (/\sLP\s|\sLIGHTLY PLAYED\s/.test(normalized)) return "Lightly Played / LP" as const;
  if (/\sNM\s|\sNEAR MINT\s/.test(normalized)) return "Near Mint / NM" as const;
  if (/\sMINT\s/.test(normalized)) return "Mint" as const;
  return null;
}

export function stickerPriceFromVisibleText(text: string) {
  const match = text.match(/(?:\$\s*(\d{1,5}(?:[.,]\d{2})?)|(\d{1,5}(?:[.,]\d{2})?)\s*\$|USD\s*(\d{1,5}(?:[.,]\d{2})?))(?!\d)/i);
  if (!match) return null;
  const value = Number((match[1] || match[2] || match[3]).replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

// OCR callers retain their compact legacy signature; every network search uses
// the structured builder from the shared core.
export function buildPokemonApiQueries(evidence: NameEvidence, collector: CollectorNumberParts | null, manualName?: string) {
  const name = manualName?.trim() || evidence.candidates[0] || "";
  const values = [
    collector?.numerator ? `number:${collector.numerator}` : "",
    name && collector?.numerator ? `name:"${name.replace(/["\\]/g, "\\$&")}" number:${collector.numerator}` : "",
    name ? `name:"${name.replace(/["\\]/g, "\\$&")}"` : "",
  ].filter(Boolean);
  return [...new Set(values)];
}

export function rankPokemonCards(cards: RankablePokemonCard[], evidence: NameEvidence, collector: CollectorNumberParts | null) {
  const ranked = rankPokemonCardResults(cards, {
    name: evidence.candidates[0] || evidence.baseCandidate,
    collectorNumber: collector?.normalized,
    disableCorrection: true,
  });
  return ranked.map((card) => ({
    ...card,
    reasons: card.reasons.map((reason) => {
      if (reason === "Exact collector number") return "collector number matches";
      if (reason === "Set total matches") return "set total matches";
      return reason;
    }),
  }));
}

export const buildCanonicalPokemonApiQueries = buildStructuredPokemonApiQueries;
