// Cost guard: visual recognition is pinned to Luna. Do not replace this with
// a UI-selected model or silently escalate to a larger model.
export const POKEMON_CARD_IDENTIFY_MODEL = "gpt-5.6-luna";
export const POKEMON_CARD_IDENTIFY_FUNCTION = "pokemon-card-identify";
export const supportedPokemonCardImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export type PokemonCardImageMimeType = typeof supportedPokemonCardImageTypes[number];
export type IdentificationFieldConfidence = "high" | "medium" | "low";
export type PokemonTopRegionIdentification = {
  cardName: string | null;
  hp: number | null;
  confidence: number;
};
export type PokemonIdentificationFieldConfidence = {
  card_name: IdentificationFieldConfidence;
  collector_number: IdentificationFieldConfidence;
  set: IdentificationFieldConfidence;
  hp: IdentificationFieldConfidence;
  stage: IdentificationFieldConfidence;
  ability: IdentificationFieldConfidence;
  attack: IdentificationFieldConfidence;
  attack_damage: IdentificationFieldConfidence;
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
  stage_or_subtype: string | null;
  ability_names: string[];
  ability_text_fragments: string[];
  attack_names: string[];
  attack_damage: string[];
  attack_text_fragments: string[];
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
  abilityName?: string;
  attackName?: string;
  reason: string;
};

export type ScannerCandidateEvidence = {
  name: string;
  collectorNumber: string;
  set: string;
  hp: number | null;
  stageOrSubtype: string;
  abilityNames: string[];
  abilityTextFragments: string[];
  attackNames: string[];
  attackDamage: string[];
  attackTextFragments: string[];
  language: "en" | "ja" | "unknown";
  nameConfidence: IdentificationFieldConfidence;
  collectorNumberConfidence: IdentificationFieldConfidence;
  setConfidence: IdentificationFieldConfidence;
  hpConfidence: IdentificationFieldConfidence;
  stageConfidence: IdentificationFieldConfidence;
  abilityConfidence: IdentificationFieldConfidence;
  attackConfidence: IdentificationFieldConfidence;
  attackDamageConfidence: IdentificationFieldConfidence;
};

export type ScannerCandidateScore = {
  providerCardId: string;
  candidateName: string;
  normalizedNameSimilarity: number;
  providerScore: number;
  numberScore: number;
  setScore: number;
  hpScore: number;
  stageScore: number;
  abilityScore: number;
  attackScore: number;
  attackDamageScore: number;
  languageScore: number;
  totalScore: number;
  accepted: boolean;
  reason: string;
};

export type PokemonIdentificationRejection = {
  field: "card_name" | "collector_number" | "set" | "visible_text";
  value: string;
  reason: string;
};

export type PokemonIdentificationUsefulness = {
  useful: boolean;
  searchIdentification: PokemonCardIdentification;
  recognizedName: string | null;
  recognizedCollectorNumber: string | null;
  rejectedFields: PokemonIdentificationRejection[];
  reasons: string[];
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

function textArray(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value)
    ? value.map((text) => nullableText(text, maxLength)).filter((text): text is string => Boolean(text)).slice(0, maxItems)
    : [];
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
    stage_or_subtype: nullableText(row.stage_or_subtype, 60),
    ability_names: textArray(row.ability_names, 3, 80),
    ability_text_fragments: textArray(row.ability_text_fragments, 4, 160),
    attack_names: textArray(row.attack_names, 4, 80),
    attack_damage: textArray(row.attack_damage, 4, 24),
    attack_text_fragments: textArray(row.attack_text_fragments, 6, 160),
    regulation_mark: nullableText(row.regulation_mark, 8),
    copyright_year: nullableInteger(row.copyright_year, 1996, 2100),
    visible_text: textArray(row.visible_text, 12, 100),
    artwork_characteristics: textArray(row.artwork_characteristics, 8, 120),
    confidence: overallConfidence,
    field_confidence: {
      card_name: fieldConfidence(rawFieldConfidence.card_name, fallbackConfidence),
      collector_number: fieldConfidence(rawFieldConfidence.collector_number, fallbackConfidence),
      set: fieldConfidence(rawFieldConfidence.set, fallbackConfidence),
      hp: fieldConfidence(rawFieldConfidence.hp, fallbackConfidence),
      stage: fieldConfidence(rawFieldConfidence.stage, fallbackConfidence),
      ability: fieldConfidence(rawFieldConfidence.ability, fallbackConfidence),
      attack: fieldConfidence(rawFieldConfidence.attack, fallbackConfidence),
      attack_damage: fieldConfidence(rawFieldConfidence.attack_damage, fallbackConfidence),
      language: fieldConfidence(rawFieldConfidence.language, fallbackConfidence),
      artwork: fieldConfidence(rawFieldConfidence.artwork, fallbackConfidence),
    },
    notes: Array.isArray(row.notes)
      ? row.notes.map((note) => nullableText(note, 180)).filter((note): note is string => Boolean(note)).slice(0, 8)
      : [],
  };
}

export function normalizePokemonTopRegionIdentification(value: unknown): PokemonTopRegionIdentification {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const confidence = Number(row.confidence);
  return {
    cardName: nullableText(row.cardName ?? row.card_name),
    hp: nullableInteger(row.hp, 0, 9999),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
  };
}

export function identificationConfidenceLabel(confidence: number) {
  return confidence >= 0.75 ? "high" as const : confidence >= 0.4 ? "medium" as const : "low" as const;
}

const nonNameCardText = new Set([
  "ability", "ancient trait", "basic", "bench", "card", "damage", "energy", "evolves from",
  "hp", "illustrator", "item", "pokemon", "pokémon", "resistance", "retreat", "rule box",
  "special energy", "stage 1", "stage 2", "supporter", "trainer", "weakness",
]);
const acceptedShortNameTokens = new Set(["ex", "gx", "v"]);

function nameUsefulness(value: string | null, source: "card_name" | "visible_text") {
  if (!value) return { useful: false, reason: "No readable card name was supplied." };
  const clean = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const normalized = clean.toLocaleLowerCase().replace(/[.:]+$/g, "");
  const tokens = clean.match(/[\p{L}\p{N}]+/gu) || [];
  if (clean.length < 3 || clean.length > 52 || tokens.length === 0 || tokens.length > 7) {
    return { useful: false, reason: "The text does not have a plausible card-name shape." };
  }
  if (nonNameCardText.has(normalized) || !/[\p{L}]/u.test(clean)) {
    return { useful: false, reason: "The text is a card label or statistic, not a card name." };
  }
  const suspiciousAbbreviation = tokens.some((token, index) => (
    token.length <= 2
    && /^[A-Z]{2}$/u.test(token)
    && !acceptedShortNameTokens.has(token.toLocaleLowerCase())
    && !(index === tokens.length - 1 && /^(EX|GX)$/u.test(token))
  ));
  if (suspiciousAbbreviation) {
    return { useful: false, reason: "The phrase contains a short OCR-like fragment that is not a recognized card-name suffix." };
  }
  if (source === "visible_text" && tokens.length > 1 && !tokens.some((token) => acceptedShortNameTokens.has(token.toLocaleLowerCase()))) {
    return { useful: false, reason: "Unlabeled multi-word visible text may be an attack or rule and is unsafe to use as a card name." };
  }
  return { useful: true, reason: "The text has a plausible card-name shape." };
}

function collectorNumberUsefulness(value: string | null) {
  if (!value) return { useful: false, reason: "No collector number was supplied." };
  const clean = value.normalize("NFKC").trim().replace(/^#+\s*/, "");
  const useful = /^(?:[A-Z0-9]{1,10}[-\s]*)?\d{1,4}(?:\s*\/\s*\d{1,4})?[A-Z]?$/iu.test(clean);
  return useful
    ? { useful: true, reason: "The collector number has a supported printed-number shape." }
    : { useful: false, reason: "The collector number is not in a supported printed-number format." };
}

/** Raw fields remain available for diagnostics; only plausible fields reach search. */
export function assessPokemonIdentification(value: PokemonCardIdentification): PokemonIdentificationUsefulness {
  const rejectedFields: PokemonIdentificationRejection[] = [];
  const reasons: string[] = [];
  const directCandidates = [value.card_name, value.pokemon_name];
  let safeCardName: string | null = null;
  let safePokemonName: string | null = null;
  let recognizedName: string | null = null;
  for (const [index, candidate] of directCandidates.entries()) {
    if (!candidate) continue;
    const assessment = nameUsefulness(candidate, "card_name");
    if (assessment.useful) {
      if (index === 0) safeCardName = candidate;
      else safePokemonName = candidate;
      if (!recognizedName) recognizedName = candidate;
    }
    else if (!assessment.useful) rejectedFields.push({ field: "card_name", value: candidate, reason: assessment.reason });
  }
  if (!recognizedName) {
    for (const visibleText of value.visible_text) {
      const assessment = nameUsefulness(visibleText, "visible_text");
      if (assessment.useful) {
        recognizedName = visibleText;
        reasons.push("A conservative visible-text fallback supplied the card-name query.");
        break;
      }
    }
  }

  const numberAssessment = collectorNumberUsefulness(value.collector_number);
  const recognizedCollectorNumber = numberAssessment.useful ? value.collector_number : null;
  if (value.collector_number && !numberAssessment.useful) {
    rejectedFields.push({ field: "collector_number", value: value.collector_number, reason: numberAssessment.reason });
  }
  const trustedSet = value.field_confidence.set === "low" ? null : value.set_name_hint;
  const trustedSetCode = value.field_confidence.set === "low" ? null : value.set_code_hint;
  if ((value.set_name_hint || value.set_code_hint) && !trustedSet && !trustedSetCode) {
    rejectedFields.push({
      field: "set",
      value: value.set_name_hint || value.set_code_hint || "",
      reason: "A low-confidence set hint is preserved in raw recognition but excluded from search.",
    });
  }

  const contentFingerprintIsUseful = Boolean(
    (value.ability_names.length && value.field_confidence.ability !== "low")
    || (value.attack_names.length && value.field_confidence.attack !== "low"),
  );
  // A collector number without a readable card name is not enough to claim a
  // useful visual identification. Many unrelated cards share the same printed
  // number, and the scanner must retry the name region before catalog search.
  const useful = Boolean(recognizedName || contentFingerprintIsUseful);
  if (recognizedName) reasons.push("A plausible card name is available for catalog search.");
  else if (contentFingerprintIsUseful) reasons.push("A medium/high-confidence ability or attack name is available as a provider search hint.");
  else if (recognizedCollectorNumber) reasons.push("A collector number was preserved for review, but a card name is required before automatic catalog search.");
  else reasons.push("No safe card name or content fingerprint is available for catalog search.");

  return {
    useful,
    recognizedName,
    recognizedCollectorNumber,
    rejectedFields,
    reasons,
    searchIdentification: {
      ...value,
      card_name: safeCardName || (!safePokemonName ? recognizedName : null),
      pokemon_name: safePokemonName,
      collector_number: recognizedCollectorNumber,
      set_name_hint: trustedSet,
      set_code_hint: trustedSetCode,
      visible_text: value.visible_text.filter((text) => nameUsefulness(text, "visible_text").useful),
    },
  };
}

export function hasUsefulPokemonIdentification(value: PokemonCardIdentification) {
  return assessPokemonIdentification(value).useful;
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
  const assessment = assessPokemonIdentification(value);
  if (!assessment.useful) return [];
  const safeValue = assessment.searchIdentification;
  const cardName = safeValue.card_name || "";
  const pokemonName = safeValue.pokemon_name || "";
  const collectorNumber = normalizeIdentificationCollectorNumber(safeValue.collector_number);
  const set = safeValue.set_name_hint || safeValue.set_code_hint || "";
  const visibleName = safeValue.visible_text.find((text) => nameUsefulness(text, "visible_text").useful) || "";
  const name = cardName || pokemonName || visibleName;
  const nameConfidence = safeValue.field_confidence.card_name;
  const numberConfidence = safeValue.field_confidence.collector_number;
  const abilityName = safeValue.field_confidence.ability === "low" ? "" : safeValue.ability_names[0] || "";
  const attackName = safeValue.field_confidence.attack === "low" ? "" : safeValue.attack_names[0] || "";
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
    planned = [...nameOnly];
  }
  if (!name && !collectorNumber && (abilityName || attackName)) {
    planned = [{
      name: "",
      collectorNumber: "",
      set: "",
      abilityName,
      attackName,
      reason: "content fingerprint fallback",
    }];
  }
  const seen = new Set<string>();
  return planned.filter((attempt) => Boolean(attempt.name || attempt.collectorNumber || attempt.abilityName || attempt.attackName)).filter((attempt) => {
    const key = `${attempt.name.toLocaleLowerCase()}|${attempt.collectorNumber.toLocaleLowerCase()}|${attempt.set.toLocaleLowerCase()}|${attempt.abilityName?.toLocaleLowerCase() || ""}|${attempt.attackName?.toLocaleLowerCase() || ""}`;
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
  const printedSuffix = (value: string) => value.normalize("NFKC").trim().match(/(?:^|\s|[-‐‑‒–—―])(VMAX|VSTAR|BREAK|GX|EX|ex|V)$/)?.[1] || "";
  const recognizedPrintedSuffix = printedSuffix(recognizedName);
  const candidatePrintedSuffix = printedSuffix(candidateName);
  if (recognizedPrintedSuffix && candidatePrintedSuffix && recognizedPrintedSuffix !== candidatePrintedSuffix) return 0.45;
  const left = normalizedNameTokens(recognizedName);
  const right = normalizedNameTokens(candidateName);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const suffixes = new Set(["ex", "gx", "v", "vmax", "vstar", "break"]);
  const suffix = (value: string) => value.split(" ").filter((token) => suffixes.has(token)).slice(-1)[0] || "";
  const base = (value: string) => value.split(" ").filter((token) => !suffixes.has(token)).join(" ");
  if (base(left) && base(left) === base(right)) {
    const leftSuffix = suffix(left);
    const rightSuffix = suffix(right);
    if (leftSuffix && rightSuffix && leftSuffix !== rightSuffix) return 0.45;
    if (Boolean(leftSuffix) !== Boolean(rightSuffix)) return 0.72;
    return 0.9;
  }
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenScore = overlap / new Set([...leftTokens, ...rightTokens]).size;
  return Math.max(editSimilarity(left, right), tokenScore);
}

function normalizedFingerprintText(value: string) {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[il|!1]/g, "l")
    .replace(/0/g, "o")
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fuzzy comparison for short OCR-derived ability and attack fingerprints. */
export function scannerFingerprintSimilarity(recognized: string, providerText: string) {
  const left = normalizedFingerprintText(recognized);
  const right = normalizedFingerprintText(providerText);
  if (!left || !right) return 0;
  if (left === right || right.includes(left) || left.includes(right)) return 1;
  const compactLeft = left.replace(/\s+/g, "");
  const compactRight = right.replace(/\s+/g, "");
  const row = Array.from({ length: compactRight.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= compactLeft.length; leftIndex++) {
    let previous = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= compactRight.length; rightIndex++) {
      const saved = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        previous + (compactLeft[leftIndex - 1] === compactRight[rightIndex - 1] ? 0 : 1),
      );
      previous = saved;
    }
  }
  const editScore = Math.max(0, 1 - row[compactRight.length] / Math.max(compactLeft.length, compactRight.length));
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 1));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenScore = overlap / Math.max(1, new Set([...leftTokens, ...rightTokens]).size);
  return Math.max(editScore, tokenScore);
}

function bestFingerprintSimilarity(recognized: string[], provider: string[]) {
  if (!recognized.length || !provider.length) return 0;
  return Math.max(...recognized.flatMap((wanted) => provider.map((candidate) => scannerFingerprintSimilarity(wanted, candidate))));
}

function confidenceWeight(confidence: IdentificationFieldConfidence, high: number, medium: number, low: number) {
  return confidence === "high" ? high : confidence === "medium" ? medium : low;
}

export function scannerCandidateEvidence(value: PokemonCardIdentification): ScannerCandidateEvidence {
  const safeValue = assessPokemonIdentification(value).searchIdentification;
  return {
    name: safeValue.card_name || safeValue.pokemon_name || "",
    collectorNumber: normalizeIdentificationCollectorNumber(safeValue.collector_number),
    set: safeValue.set_name_hint || safeValue.set_code_hint || "",
    hp: safeValue.hp,
    stageOrSubtype: safeValue.stage_or_subtype || "",
    abilityNames: safeValue.ability_names,
    abilityTextFragments: safeValue.ability_text_fragments,
    attackNames: safeValue.attack_names,
    attackDamage: safeValue.attack_damage,
    attackTextFragments: safeValue.attack_text_fragments,
    language: safeValue.language,
    nameConfidence: safeValue.field_confidence.card_name,
    collectorNumberConfidence: safeValue.field_confidence.collector_number,
    setConfidence: safeValue.field_confidence.set,
    hpConfidence: safeValue.field_confidence.hp,
    stageConfidence: safeValue.field_confidence.stage,
    abilityConfidence: safeValue.field_confidence.ability,
    attackConfidence: safeValue.field_confidence.attack,
    attackDamageConfidence: safeValue.field_confidence.attack_damage,
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
  hp?: string;
  subtypes?: string[];
  types?: string[];
  abilities?: Array<{ name: string; text?: string; type?: string }>;
  attacks?: Array<{ name: string; text?: string; damage?: string; cost?: string[] }>;
  matchScore: number;
}, evidence: ScannerCandidateEvidence): ScannerCandidateScore {
  const nameThreshold = evidence.nameConfidence === "high" ? 0.62 : evidence.nameConfidence === "medium" ? 0.46 : 0;
  const numberWeight = evidence.collectorNumberConfidence === "high" ? 32 : evidence.collectorNumberConfidence === "medium" ? 12 : 0;
  const nameWeight = evidence.nameConfidence === "high" ? 60 : evidence.nameConfidence === "medium" ? 46 : 14;
  const bothLow = evidence.nameConfidence === "low" && evidence.collectorNumberConfidence === "low";
  const normalizedNameSimilarity = evidence.name ? scannerCardNameSimilarity(evidence.name, match.name) : 0;
  if (evidence.name && nameThreshold && normalizedNameSimilarity < nameThreshold) {
    return {
      providerCardId: match.providerCardId,
      candidateName: match.name,
      normalizedNameSimilarity,
      providerScore: Math.round(Math.min(100, Math.max(0, match.matchScore)) * 0.12 * 100) / 100,
      numberScore: 0,
      setScore: 0,
      hpScore: 0,
      stageScore: 0,
      abilityScore: 0,
      attackScore: 0,
      attackDamageScore: 0,
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
  const providerAbilities = (match.abilities || []).flatMap((ability) => [ability.name, ability.text || ""]).filter(Boolean);
  const providerAttacks = (match.attacks || []).flatMap((attack) => [attack.name, attack.text || ""]).filter(Boolean);
  const rawAbilitySimilarity = bestFingerprintSimilarity(
    [...(evidence.abilityNames || []), ...(evidence.abilityTextFragments || [])],
    providerAbilities,
  );
  const rawAttackSimilarity = bestFingerprintSimilarity(
    [...(evidence.attackNames || []), ...(evidence.attackTextFragments || [])],
    providerAttacks,
  );
  const rawStageSimilarity = evidence.stageOrSubtype
    ? bestFingerprintSimilarity([evidence.stageOrSubtype], match.subtypes || [])
    : 0;
  const abilitySimilarity = rawAbilitySimilarity >= 0.64 ? rawAbilitySimilarity : 0;
  const attackSimilarity = rawAttackSimilarity >= 0.64 ? rawAttackSimilarity : 0;
  const stageSimilarity = rawStageSimilarity >= 0.64 ? rawStageSimilarity : 0;
  const recognizedDamage = (evidence.attackDamage || []).map((damage) => damage.toLocaleLowerCase().replace(/[^0-9+x]/g, "")).filter(Boolean);
  const providerDamage = (match.attacks || []).map((attack) => String(attack.damage || "").toLocaleLowerCase().replace(/[^0-9+x]/g, "")).filter(Boolean);
  const attackDamageMatches = recognizedDamage.some((damage) => providerDamage.includes(damage));
  const providerHp = Number(String(match.hp || "").replace(/\D/g, ""));
  const hpMatches = Boolean(evidence.hp != null && Number.isFinite(providerHp) && providerHp === evidence.hp);
  const providerScore = Math.min(100, Math.max(0, match.matchScore)) * 0.12;
  const numberScore = numberMatches ? numberWeight : evidence.collectorNumber && evidence.collectorNumberConfidence === "high" ? -8 : 0;
  const setScore = setSimilarity * (evidence.setConfidence === "high" ? 10 : evidence.setConfidence === "medium" ? 6 : 2);
  const hpScore = hpMatches
    ? confidenceWeight(evidence.hpConfidence || "low", 12, 8, 2)
    : evidence.hp != null && providerHp && evidence.hpConfidence === "high" ? -5 : 0;
  const stageScore = stageSimilarity * confidenceWeight(evidence.stageConfidence || "low", 6, 4, 1);
  const abilityScore = abilitySimilarity * confidenceWeight(evidence.abilityConfidence || "low", 18, 13, 4);
  const attackScore = attackSimilarity * confidenceWeight(evidence.attackConfidence || "low", 20, 14, 4);
  const attackDamageScore = attackDamageMatches ? confidenceWeight(evidence.attackDamageConfidence || "low", 7, 5, 1) : 0;
  const languageScore = evidence.language !== "unknown" && match.language === evidence.language ? 2 : 0;
  const totalScore = Math.round(Math.max(0, Math.min(bothLow ? 69 : 99,
    normalizedNameSimilarity * nameWeight
      + providerScore
      + numberScore
      + setScore
      + hpScore
      + stageScore
      + abilityScore
      + attackScore
      + attackDamageScore
      + languageScore,
  )));
  return {
    providerCardId: match.providerCardId,
    candidateName: match.name,
    normalizedNameSimilarity,
    providerScore: Math.round(providerScore * 100) / 100,
    numberScore,
    setScore: Math.round(setScore * 100) / 100,
    hpScore,
    stageScore: Math.round(stageScore * 100) / 100,
    abilityScore: Math.round(abilityScore * 100) / 100,
    attackScore: Math.round(attackScore * 100) / 100,
    attackDamageScore,
    languageScore,
    totalScore,
    accepted: true,
    reason: [
      "Accepted by the name gate.",
      abilityScore >= 8 ? "Ability fingerprint matched." : "",
      attackScore >= 8 ? "Attack fingerprint matched." : "",
      hpMatches ? "HP matched." : "",
      attackDamageMatches ? "Attack damage matched." : "",
      numberMatches ? `Collector number contributed as ${evidence.collectorNumberConfidence}-confidence evidence.` : "",
    ].filter(Boolean).join(" "),
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
        score.abilityScore >= 8 ? `Ability fingerprint +${Math.round(score.abilityScore)}` : "",
        score.attackScore >= 8 ? `Attack fingerprint +${Math.round(score.attackScore)}` : "",
        score.hpScore > 0 ? `HP fingerprint +${score.hpScore}` : "",
        score.attackDamageScore > 0 ? `Attack damage +${score.attackDamageScore}` : "",
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
  const regionEvidenceIsStrong = (
    identification.field_confidence.card_name === "high"
    || identification.field_confidence.ability === "high"
    || identification.field_confidence.attack === "high"
  );
  return Boolean(
    (identification.confidence >= 0.72 || regionEvidenceIsStrong)
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
