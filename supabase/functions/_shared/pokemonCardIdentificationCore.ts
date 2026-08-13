export const POKEMON_CARD_IDENTIFY_MODEL = "gemini-3.6-flash";
export const POKEMON_CARD_IDENTIFY_FUNCTION = "pokemon-card-identify";
export const supportedPokemonCardImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export type PokemonCardImageMimeType = typeof supportedPokemonCardImageTypes[number];
export type PokemonCardIdentification = {
  card_name: string | null;
  pokemon_name: string | null;
  collector_number: string | null;
  printed_total_number: string | null;
  set_name_hint: string | null;
  set_code_hint: string | null;
  language: "en" | "ja" | "unknown";
  rarity_hint: string | null;
  hp: number | null;
  regulation_mark: string | null;
  copyright_year: number | null;
  confidence: number;
  notes: string[];
};

export type IdentificationSearchAttempt = {
  name: string;
  collectorNumber: string;
  set: string;
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

export function stripPokemonCardImagePrefix(value: string) {
  return value.trim().replace(/^data:image\/(?:jpeg|png|webp);base64,/i, "").replace(/\s+/g, "");
}

export function normalizePokemonCardIdentification(value: unknown): PokemonCardIdentification {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const language = row.language === "en" || row.language === "ja" ? row.language : "unknown";
  const confidence = Number(row.confidence);
  return {
    card_name: nullableText(row.card_name),
    pokemon_name: nullableText(row.pokemon_name),
    collector_number: nullableText(row.collector_number, 32),
    printed_total_number: nullableText(row.printed_total_number, 32),
    set_name_hint: nullableText(row.set_name_hint),
    set_code_hint: nullableText(row.set_code_hint, 32),
    language,
    rarity_hint: nullableText(row.rarity_hint, 80),
    hp: nullableInteger(row.hp, 0, 9999),
    regulation_mark: nullableText(row.regulation_mark, 8),
    copyright_year: nullableInteger(row.copyright_year, 1996, 2100),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    notes: Array.isArray(row.notes)
      ? row.notes.map((note) => nullableText(note, 180)).filter((note): note is string => Boolean(note)).slice(0, 8)
      : [],
  };
}

export function identificationConfidenceLabel(confidence: number) {
  return confidence >= 0.8 ? "high" as const : confidence >= 0.5 ? "medium" as const : "low" as const;
}

export function hasUsefulPokemonIdentification(value: PokemonCardIdentification) {
  return Boolean(value.card_name || value.pokemon_name || value.collector_number);
}

export function buildPokemonIdentificationSearchAttempts(value: PokemonCardIdentification) {
  const cardName = value.card_name || "";
  const pokemonName = value.pokemon_name || "";
  const collectorNumber = value.collector_number || "";
  const set = value.set_name_hint || value.set_code_hint || "";
  const attempts: IdentificationSearchAttempt[] = [
    { name: cardName, collectorNumber, set: "", reason: "collector number + card name" },
    { name: pokemonName, collectorNumber, set: "", reason: "collector number + Pokémon name" },
    { name: cardName, collectorNumber: "", set, reason: "card name + set" },
    { name: pokemonName, collectorNumber: "", set, reason: "Pokémon name + set" },
    { name: cardName || pokemonName, collectorNumber: "", set: "", reason: "card name fallback" },
  ].filter((attempt) => Boolean(attempt.name || attempt.collectorNumber));
  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    const key = `${attempt.name.toLocaleLowerCase()}|${attempt.collectorNumber.toLocaleLowerCase()}|${attempt.set.toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isStrongVisualCatalogMatch(
  identification: PokemonCardIdentification,
  matches: Array<{ providerCardId: string; matchScore: number; matchConfidence?: string }>,
) {
  const first = matches[0];
  const second = matches[1];
  return Boolean(
    identification.confidence >= 0.8
    && first
    && (first.matchConfidence === "high" || first.matchScore >= 85)
    && (!second || first.matchScore - second.matchScore >= 8),
  );
}
