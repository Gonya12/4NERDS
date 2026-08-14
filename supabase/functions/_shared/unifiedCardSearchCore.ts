import {
  normalizeCardSearchText,
  textSimilarity,
  tokenSimilarity,
  type CardSearchConfidence,
} from "./pokemonCardSearchCore.ts";

export type CardGame = "pokemon" | "one_piece" | "other";
export type CardLanguage = "en" | "ja" | "unknown";
export type CardDataProvider = "pokemontcg" | "tcgdex" | "optcgapi" | "manual";

export type UnifiedCardPriceVariant = {
  name: string;
  market?: number;
  low?: number;
  mid?: number;
  high?: number;
  directLow?: number;
};

export interface UnifiedCardResult {
  game: "pokemon" | "one_piece";
  language: "en" | "ja";
  provider: "pokemontcg" | "tcgdex" | "optcgapi";
  providerCardId: string;
  name: string;
  cardCode?: string;
  collectorNumber?: string;
  setId?: string;
  setName?: string;
  rarity?: string;
  imageSmall?: string;
  imageLarge?: string;
  productUrl?: string;
  pricing?: {
    currency?: string;
    market?: number;
    low?: number;
    mid?: number;
    high?: number;
    updatedAt?: string;
    source?: string;
    variants?: UnifiedCardPriceVariant[];
  };
}

export type UnifiedCardMatch = UnifiedCardResult & {
  setCode?: string;
  setReleaseDate?: string;
  supertype?: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  abilities?: Array<{ name: string; text?: string; type?: string }>;
  attacks?: Array<{ name: string; text?: string; damage?: string; cost?: string[] }>;
  matchConfidence: "high" | "medium" | "low";
  searchConfidence: CardSearchConfidence;
  matchScore: number;
  reasons: string[];
};

export type UnifiedCardSearchInput = {
  game?: CardGame;
  language?: CardLanguage | string | null;
  query?: string | null;
  name?: string | null;
  collectorNumber?: string | null;
  set?: string | null;
  abilityName?: string | null;
  attackName?: string | null;
  finish?: string | null;
  cardType?: string | null;
  page?: number;
  pageSize?: number;
  disableCorrection?: boolean;
  providerCardId?: string;
};

export function normalizeCardGame(value: unknown): CardGame {
  const normalized = normalizeCardSearchText(String(value || "")).replace(/\s+/g, "_");
  if (normalized === "one_piece" || normalized === "onepiece") return "one_piece";
  if (normalized === "other" || normalized === "manual") return "other";
  return "pokemon";
}

export function normalizeCardLanguage(value: unknown, game: CardGame = "pokemon"): CardLanguage {
  if (game === "other") return "unknown";
  const normalized = normalizeCardSearchText(String(value || ""));
  if (normalized === "ja" || normalized === "japanese" || normalized === "日本語") return "ja";
  return "en";
}

export function normalizeOnePieceCardCode(value: string | null | undefined) {
  const compact = String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[^A-Z0-9]+/g, "");
  const promo = compact.match(/^P0*(\d{1,3})$/);
  if (promo) return `P-${promo[1].padStart(3, "0")}`;
  const match = compact.match(/^(OP|ST|EB|PRB)0*(\d{1,2})0*(\d{3})$/);
  if (!match) return "";
  return `${match[1]}${match[2].padStart(2, "0")}-${match[3]}`;
}

export function extractOnePieceCardCode(value: string | null | undefined) {
  const text = String(value || "").normalize("NFKC").toUpperCase();
  const promo = text.match(/(?:^|\s|#)(P)\s*[- ]?\s*(\d{1,3})(?=$|\s|[),.;])/);
  if (promo) return normalizeOnePieceCardCode(`${promo[1]}-${promo[2]}`);
  const match = text.match(/(?:^|\s|#)((?:OP|ST|EB|PRB)\s*[- ]?\s*\d{1,2}\s*[- ]?\s*\d{3})(?=$|\s|[),.;])/);
  return match ? normalizeOnePieceCardCode(match[1]) : "";
}

export function onePieceSearchName(value: string | null | undefined) {
  const raw = String(value || "").normalize("NFKC").trim();
  const code = extractOnePieceCardCode(raw);
  let withoutCode = raw;
  if (code) {
    const escaped = raw.match(/[.*+?^${}()|[\]\\]/g) ? code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : code;
    const flexibleCode = escaped
      .replace(/-/g, "[-\\s]*")
      .replace(/(OP|ST|EB|PRB)(\d{2})/i, "$1[-\\s]*$2");
    withoutCode = raw.replace(new RegExp(flexibleCode, "i"), " ");
  }
  return withoutCode
    .replace(/\s+#?0*(\d{3})(?:\/\d+)?\s*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function confidenceFor(score: number, exactCode: boolean, exactName: boolean): CardSearchConfidence {
  if (exactCode || exactName || score >= 92) return "exact";
  if (score >= 70) return "likely";
  if (score >= 46) return "possible";
  return "unreliable";
}

function matchConfidence(score: number) {
  return score >= 78 ? "high" as const : score >= 52 ? "medium" as const : "low" as const;
}

export type RankableOnePieceCard = {
  providerCardId: string;
  name: string;
  cardCode: string;
  collectorNumber?: string;
  setId?: string;
  setName?: string;
  rarity?: string;
  character?: string;
  cardType?: string;
};

export function rankOnePieceCards(cards: RankableOnePieceCard[], input: UnifiedCardSearchInput | string) {
  const request = typeof input === "string" ? { query: input } : input;
  const rawQuery = String(request.query || [request.name, request.collectorNumber].filter(Boolean).join(" ")).trim();
  const wantedCode = extractOnePieceCardCode(request.collectorNumber || rawQuery);
  const bareNumber = !wantedCode
    ? String(request.collectorNumber || rawQuery).match(/(?:^|\s|#)0*(\d{1,3})(?:\/\d+)?\s*$/)
    : null;
  const wantedNumber = bareNumber?.[1]?.padStart(3, "0") || "";
  const wantedName = normalizeCardSearchText(request.name || onePieceSearchName(rawQuery));
  const wantedSet = normalizeCardSearchText(request.set);

  return cards.map((card) => {
    const cardCode = normalizeOnePieceCardCode(card.cardCode);
    const cardName = normalizeCardSearchText(card.name);
    const setText = normalizeCardSearchText(`${card.setId || ""} ${card.setName || ""}`);
    const gameFields = [
      card.setId,
      card.setName,
      card.rarity,
      card.character,
      card.cardType,
    ].map(normalizeCardSearchText).filter(Boolean);
    const supportingText = normalizeCardSearchText(
      `${card.name} ${card.cardCode} ${card.setId || ""} ${card.setName || ""} ${card.rarity || ""} ${card.character || ""} ${card.cardType || ""}`,
    );
    const exactCode = Boolean(wantedCode && cardCode === wantedCode);
    const exactNumber = Boolean(wantedNumber && cardCode.endsWith(`-${wantedNumber}`));
    const exactName = Boolean(wantedName && cardName === wantedName);
    const fuzzyTokenSimilarity = wantedName
      ? Math.max(0, ...wantedName.split(" ").filter((token) => token.length >= 3).flatMap((wantedToken) =>
        cardName.split(" ").filter((token) => token.length >= 3).map((cardToken) => textSimilarity(wantedToken, cardToken)),
      ))
      : 0;
    const similarity = wantedName
      ? Math.max(textSimilarity(wantedName, cardName), tokenSimilarity(wantedName, cardName), fuzzyTokenSimilarity)
      : 0;
    let score = 0;
    const reasons: string[] = [];
    if (exactCode) {
      score += 62;
      reasons.push("Exact One Piece card code");
    }
    if (exactNumber) {
      score += exactName ? 36 : 30;
      reasons.push("Exact card-number suffix");
    }
    if (exactName) {
      score += 48;
      reasons.push("Exact printed name");
    } else if (wantedName && cardName.includes(wantedName)) {
      score += 38;
      reasons.push("Printed name contains search");
    } else if (wantedName && gameFields.some((value) => value === wantedName || value.includes(wantedName))) {
      score += 50;
      reasons.push("Exact set, character, type, or rarity field");
    } else if (wantedName && supportingText.includes(wantedName)) {
      score += 44;
      reasons.push("Set, character, or rarity matches");
    } else if (similarity >= 0.74) {
      score += Math.round(similarity * (fuzzyTokenSimilarity >= 0.8 ? 60 : 48));
      reasons.push(`Conservative typo match ${Math.round(similarity * 100)}%`);
    }
    if (wantedSet && setText.includes(wantedSet)) {
      score += wantedName || wantedCode ? 14 : 52;
      reasons.push("Set matches");
    } else if (wantedSet) {
      score -= 12;
    }
    if (wantedCode && !exactCode) score -= 18;
    if (wantedNumber && !exactNumber) score -= 12;
    const bounded = Math.max(0, Math.min(100, score));
    return {
      ...card,
      matchScore: bounded,
      reasons: reasons.length ? reasons : ["Catalog candidate"],
      confidence: confidenceFor(bounded, exactCode, exactName),
      matchConfidence: matchConfidence(bounded),
    };
  }).sort((left, right) => right.matchScore - left.matchScore
    || left.cardCode.localeCompare(right.cardCode));
}
