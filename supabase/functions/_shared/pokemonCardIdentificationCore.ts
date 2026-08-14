export const POKEMON_CARD_IDENTIFY_MODEL = "gemini-3.6-flash";
export const POKEMON_CARD_IDENTIFY_FUNCTION = "pokemon-card-identify";
export const supportedPokemonCardImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export type PokemonCardImageMimeType = typeof supportedPokemonCardImageTypes[number];
export type IdentificationFieldConfidence = "high" | "medium" | "low";
export type PokemonIdentificationFieldConfidence = {
  card_name: IdentificationFieldConfidence;
  collector_number: IdentificationFieldConfidence;
  set: IdentificationFieldConfidence;
  hp: IdentificationFieldConfidence;
  language: IdentificationFieldConfidence;
  artwork: IdentificationFieldConfidence;
};
export type PokemonCardIdentification = {
  card_name: string | null;
  pokemon_name: string | null;
  collector_number: string | null;
  printed_total_number: string | null;
  set_name_hint: string | null;
  set_code_hint: string | null;
  card_game: "pokemon" | "one_piece" | "unknown";
  language: "en" | "ja" | "unknown";
  rarity_hint: string | null;
  hp: number | null;
  regulation_mark: string | null;
  copyright_year: number | null;
  visible_text: string[];
  artwork_characteristics: string[];
  confidence: number;
  field_confidence: PokemonIdentificationFieldConfidence;
  notes: string[];
};

export type IdentificationSearchAttempt = {
  name: string;
  collectorNumber: string;
  set: string;
  reason: string;
};

export type ScannerCandidateEvidence = {
  name: string;
  collectorNumber: string;
  set: string;
  language: "en" | "ja" | "unknown";
  nameConfidence: IdentificationFieldConfidence;
  collectorNumberConfidence: IdentificationFieldConfidence;
  setConfidence: IdentificationFieldConfidence;
};

export type ScannerCandidateScore = {
  providerCardId: string;
  candidateName: string;
  normalizedNameSimilarity: number;
  providerScore: number;
  numberScore: number;
  setScore: number;
  languageScore: number;
  totalScore: number;
  accepted: boolean;
  reason: string;
};

function nullableText(value: unknown, maxLength = 120) {
  if (typeof value !== "string") return null;
  const clean = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function nullableInteger(value: unknown, minimum: number, maximum: number) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function fieldConfidence(value: unknown, fallback: IdentificationFieldConfidence) {
  return value === "high" || value === "medium" || value === "low" ? value : fallback;
}

export function stripPokemonCardImagePrefix(value: string) {
  return value.trim().replace(/^data:image\/(?:jpeg|png|webp);base64,/i, "").replace(/\s+/g, "");
}

export function normalizePokemonCardIdentification(value: unknown): PokemonCardIdentification {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const language = row.language === "en" || row.language === "ja" ? row.language : "unknown";
  const confidence = Number(row.confidence);
  const overallConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  const fallbackConfidence = identificationConfidenceLabel(overallConfidence);
  const rawFieldConfidence = row.field_confidence && typeof row.field_confidence === "object" && !Array.isArray(row.field_confidence)
    ? row.field_confidence as Record<string, unknown>
    : {};
  return {
    card_name: nullableText(row.card_name),
    pokemon_name: nullableText(row.pokemon_name),
    collector_number: nullableText(row.collector_number, 32),
    printed_total_number: nullableText(row.printed_total_number, 32),
    set_name_hint: nullableText(row.set_name_hint),
    set_code_hint: nullableText(row.set_code_hint, 32),
    card_game: row.card_game === "pokemon" || row.card_game === "one_piece" ? row.card_game : "unknown",
    language,
    rarity_hint: nullableText(row.rarity_hint, 80),
    hp: nullableInteger(row.hp, 0, 9999),
    regulation_mark: nullableText(row.regulation_mark, 8),
    copyright_year: nullableInteger(row.copyright_year, 1996, 2100),
    visible_text: Array.isArray(row.visible_text)
      ? row.visible_text.map((text) => nullableText(text, 100)).filter((text): text is string => Boolean(text)).slice(0, 12)
      : [],
    artwork_characteristics: Array.isArray(row.artwork_characteristics)
      ? row.artwork_characteristics.map((text) => nullableText(text, 120)).filter((text): text is string => Boolean(text)).slice(0, 8)
      : [],
    confidence: overallConfidence,
    field_confidence: {
      card_name: fieldConfidence(rawFieldConfidence.card_name, fallbackConfidence),
      collector_number: fieldConfidence(rawFieldConfidence.collector_number, fallbackConfidence),
      set: fieldConfidence(rawFieldConfidence.set, fallbackConfidence),
      hp: fieldConfidence(rawFieldConfidence.hp, fallbackConfidence),
      language: fieldConfidence(rawFieldConfidence.language, fallbackConfidence),
      artwork: fieldConfidence(rawFieldConfidence.artwork, fallbackConfidence),
    },
    notes: Array.isArray(row.notes)
      ? row.notes.map((note) => nullableText(note, 180)).filter((note): note is string => Boolean(note)).slice(0, 8)
      : [],
  };
}

export function identificationConfidenceLabel(confidence: number) {
  return confidence >= 0.75 ? "high" as const : confidence >= 0.4 ? "medium" as const : "low" as const;
}

export function hasUsefulPokemonIdentification(value: PokemonCardIdentification) {
  return Boolean(value.card_name || value.pokemon_name || value.collector_number || value.visible_text.length);
}

export function normalizeIdentificationCollectorNumber(value: string | null) {
  if (!value) return "";
  const clean = value.normalize("NFKC").trim().replace(/^#+\s*/, "");
  const fraction = clean.match(/(?:[A-Z]{2,6}[-\s]*)?#?\s*(\d{1,4})\s*\/\s*(\d{1,4})/i);
  if (fraction) return `${fraction[1]}/${fraction[2]}`;
  const promo = clean.match(/^[A-Z]{2,6}[-\s]*#?\s*(\d{1,4})$/i);
  if (promo) return promo[1];
  const simple = clean.match(/^0*\d{1,4}[A-Z]?$/i);
  return simple ? clean : clean.replace(/\s+/g, " ");
}

export function buildPokemonIdentificationSearchAttempts(value: PokemonCardIdentification) {
  const cardName = value.card_name || "";
  const pokemonName = value.pokemon_name || "";
  const collectorNumber = normalizeIdentificationCollectorNumber(value.collector_number);
  const set = value.set_name_hint || value.set_code_hint || "";
  const visibleName = value.visible_text.find((text) => /^[\p{L}][\p{L}\p{N}'’.:& -]{2,48}$/u.test(text)) || "";
  const name = cardName || pokemonName || visibleName;
  const nameConfidence = value.field_confidence.card_name;
  const numberConfidence = value.field_confidence.collector_number;
  const nameOnly: IdentificationSearchAttempt[] = [
    { name: cardName, collectorNumber: "", set, reason: "card name first" },
    { name: pokemonName, collectorNumber: "", set, reason: "Pokémon name first" },
    { name, collectorNumber: "", set: "", reason: "card name fallback" },
  ];
  const combined: IdentificationSearchAttempt[] = [
    { name: cardName || pokemonName, collectorNumber, set: "", reason: "high-confidence name + collector number" },
    { name: pokemonName, collectorNumber, set: "", reason: "Pokémon name + collector number" },
  ];
  let planned: IdentificationSearchAttempt[];
  if (nameConfidence === "high" && numberConfidence === "high") {
    planned = [...combined, ...nameOnly];
  } else if ((nameConfidence === "high" || nameConfidence === "medium") && numberConfidence !== "high") {
    // A questionable number may reorder same-name printings, but must never
    // turn an unrelated #2 card into a Charizard suggestion.
    planned = [...nameOnly, ...(numberConfidence === "medium" ? combined : [])];
  } else if (numberConfidence === "high") {
    planned = [
      { name: nameConfidence === "medium" ? name : "", collectorNumber, set: "", reason: nameConfidence === "medium" ? "collector number with name sanity check" : "high-confidence collector number" },
      ...nameOnly,
    ];
  } else {
    planned = [...nameOnly, { name: "", collectorNumber, set: "", reason: "low-confidence fuzzy fallback" }];
  }
  const seen = new Set<string>();
  return planned.filter((attempt) => Boolean(attempt.name || attempt.collectorNumber)).filter((attempt) => {
    const key = `${attempt.name.toLocaleLowerCase()}|${attempt.collectorNumber.toLocaleLowerCase()}|${attempt.set.toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedCollector(value: string | null | undefined) {
  return normalizeIdentificationCollectorNumber(value || "").split("/")[0].replace(/^0+(?=\d)/, "").toLocaleLowerCase();
}

function normalizedNameTokens(value: string) {
  return value.normalize("NFKC")
    .replace(/([a-z])(?=(?:GX|EX|VMAX|VSTAR|BREAK)\b)/g, "$1 ")
    .replace(/[-_]+/g, " ")
    .replace(/['’‘‛`´"]/g, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function editSimilarity(left: string, right: string) {
  const a = normalizedNameTokens(left).replace(/\s+/g, "");
  const b = normalizedNameTokens(right).replace(/\s+/g, "");
  if (!a || !b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= a.length; leftIndex++) {
    let previous = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= b.length; rightIndex++) {
      const saved = row[rightIndex];
      row[rightIndex] = Math.min(row[rightIndex] + 1, row[rightIndex - 1] + 1, previous + (a[leftIndex - 1] === b[rightIndex - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return Math.max(0, 1 - row[b.length] / Math.max(a.length, b.length));
}

/** Normalizes punctuation, typography, whitespace and suffix casing before comparison. */
export function scannerCardNameSimilarity(recognizedName: string, candidateName: string) {
  const left = normalizedNameTokens(recognizedName);
  const right = normalizedNameTokens(candidateName);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const suffixes = new Set(["ex", "gx", "v", "vmax", "vstar", "break"]);
  const base = (value: string) => value.split(" ").filter((token) => !suffixes.has(token)).join(" ");
  if (base(left) && base(left) === base(right)) return 0.9;
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenScore = overlap / new Set([...leftTokens, ...rightTokens]).size;
  return Math.max(editSimilarity(left, right), tokenScore);
}

export function scannerCandidateEvidence(value: PokemonCardIdentification): ScannerCandidateEvidence {
  return {
    name: value.card_name || value.pokemon_name || "",
    collectorNumber: normalizeIdentificationCollectorNumber(value.collector_number),
    set: value.set_name_hint || value.set_code_hint || "",
    language: value.language,
    nameConfidence: value.field_confidence.card_name,
    collectorNumberConfidence: value.field_confidence.collector_number,
    setConfidence: value.field_confidence.set,
  };
}

export function scoreScannerCandidate(match: {
  providerCardId: string;
  name: string;
  collectorNumber?: string;
  setName?: string;
  setId?: string;
  setCode?: string;
  language?: string;
  matchScore: number;
}, evidence: ScannerCandidateEvidence): ScannerCandidateScore {
  const nameThreshold = evidence.nameConfidence === "high" ? 0.58 : evidence.nameConfidence === "medium" ? 0.42 : 0;
  const numberWeight = evidence.collectorNumberConfidence === "high" ? 32 : evidence.collectorNumberConfidence === "medium" ? 12 : 2;
  const nameWeight = evidence.nameConfidence === "high" ? 72 : evidence.nameConfidence === "medium" ? 52 : 16;
  const bothLow = evidence.nameConfidence === "low" && evidence.collectorNumberConfidence === "low";
  const normalizedNameSimilarity = evidence.name ? scannerCardNameSimilarity(evidence.name, match.name) : 0;
  if (evidence.name && nameThreshold && normalizedNameSimilarity < nameThreshold) {
    return {
      providerCardId: match.providerCardId,
      candidateName: match.name,
      normalizedNameSimilarity,
      providerScore: Math.round(Math.min(100, Math.max(0, match.matchScore)) * 0.18 * 100) / 100,
      numberScore: 0,
      setScore: 0,
      languageScore: 0,
      totalScore: 0,
      accepted: false,
      reason: `Name similarity ${Math.round(normalizedNameSimilarity * 100)}% is below the ${Math.round(nameThreshold * 100)}% sanity threshold.`,
    };
  }
  const numberMatches = Boolean(
    evidence.collectorNumber
    && normalizedCollector(evidence.collectorNumber) === normalizedCollector(match.collectorNumber),
  );
  const setSimilarity = evidence.set
    ? scannerCardNameSimilarity(evidence.set, `${match.setName || ""} ${match.setCode || match.setId || ""}`)
    : 0;
  const providerScore = Math.min(100, Math.max(0, match.matchScore)) * 0.18;
  const numberScore = numberMatches ? numberWeight : evidence.collectorNumber && evidence.collectorNumberConfidence === "high" ? -8 : 0;
  const setScore = setSimilarity * (evidence.setConfidence === "high" ? 10 : evidence.setConfidence === "medium" ? 6 : 2);
  const languageScore = evidence.language !== "unknown" && match.language === evidence.language ? 2 : 0;
  const totalScore = Math.round(Math.max(0, Math.min(bothLow ? 69 : 99,
    normalizedNameSimilarity * nameWeight + providerScore + numberScore + setScore + languageScore,
  )));
  return {
    providerCardId: match.providerCardId,
    candidateName: match.name,
    normalizedNameSimilarity,
    providerScore: Math.round(providerScore * 100) / 100,
    numberScore,
    setScore: Math.round(setScore * 100) / 100,
    languageScore,
    totalScore,
    accepted: true,
    reason: numberMatches
      ? `Accepted; collector number is a ${evidence.collectorNumberConfidence}-confidence ranking signal.`
      : "Accepted by name sanity check; collector number did not filter the result.",
  };
}

export function rankScannerCandidates<T extends {
  providerCardId: string;
  name: string;
  collectorNumber?: string;
  setName?: string;
  setId?: string;
  setCode?: string;
  language?: string;
  matchScore: number;
  matchConfidence?: string;
  searchConfidence?: string;
  reasons?: string[];
}>(matches: T[], evidence: ScannerCandidateEvidence) {
  const bothLow = evidence.nameConfidence === "low" && evidence.collectorNumberConfidence === "low";
  return matches.flatMap((match) => {
    const score = scoreScannerCandidate(match, evidence);
    if (!score.accepted) return [];
    const confidence = score.totalScore >= 78 ? "high" : score.totalScore >= 52 ? "medium" : "low";
    const searchConfidence = bothLow ? "possible" : match.searchConfidence;
    return [{
      ...match,
      matchScore: score.totalScore,
      matchConfidence: confidence,
      searchConfidence,
      reasons: [
        ...(match.reasons || []),
        evidence.name ? `Name similarity ${Math.round(score.normalizedNameSimilarity * 100)}%` : "",
        score.numberScore > 0 ? `Collector number matched (${evidence.collectorNumberConfidence}-confidence evidence)` : "",
      ].filter(Boolean),
    } as T];
  }).sort((left, right) => right.matchScore - left.matchScore);
}

export function isStrongVisualCatalogMatch(
  identification: PokemonCardIdentification,
  matches: Array<{ providerCardId: string; matchScore: number; matchConfidence?: string }>,
) {
  const first = matches[0];
  const second = matches[1];
  return Boolean(
    identification.confidence >= 0.72
    && first
    && (first.matchConfidence === "high" || first.matchScore >= 80)
    && (!second || first.matchScore - second.matchScore >= 6),
  );
}

export function selectScannerCandidates<T extends { providerCardId: string; matchScore: number; searchConfidence?: string }>(matches: T[]) {
  const unique = new Map<string, T>();
  for (const match of matches) {
    if (match.searchConfidence === "unreliable") continue;
    const existing = unique.get(match.providerCardId);
    if (!existing || match.matchScore > existing.matchScore) unique.set(match.providerCardId, match);
  }
  return [...unique.values()].sort((left, right) => right.matchScore - left.matchScore).slice(0, 5);
}
