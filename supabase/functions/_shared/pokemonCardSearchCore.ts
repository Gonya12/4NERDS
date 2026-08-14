export const CARD_SUFFIXES = [
  "Tag Team",
  "Radiant",
  "VMAX",
  "VSTAR",
  "BREAK",
  "Prime",
  "LV.X",
  "Mega",
  "GX",
  "EX",
  "ex",
  "Star",
  "V",
  "M",
] as const;

export type CardSearchConfidence = "exact" | "likely" | "possible" | "unreliable";

export type CollectorNumberParts = {
  original: string;
  normalized: string;
  numerator: string;
  denominator?: string;
  variants: string[];
};

export type CardSearchCorrection = {
  original: string;
  suggestion: string;
  matchedName: string;
  similarity: number;
};

export type CardSearchInput = {
  query?: string | null;
  name?: string | null;
  collectorNumber?: string | null;
  set?: string | null;
  language?: string | null;
  finish?: string | null;
  cardType?: string | null;
  page?: number;
  pageSize?: number;
  disableCorrection?: boolean;
};

export type ParsedCardSearchQuery = {
  rawQuery: string;
  normalizedQuery: string;
  originalName: string;
  name: string;
  normalizedName: string;
  collector: CollectorNumberParts | null;
  set: string;
  language: string;
  finish: string;
  cardType: string;
  suffix: string;
  baseName: string;
  numberOnly: boolean;
  correction?: CardSearchCorrection;
};

export type RankablePokemonCard = {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set?: {
    id?: string;
    name?: string;
    ptcgoCode?: string;
    releaseDate?: string;
    printedTotal?: number;
    total?: number;
  };
  images?: { small?: string; large?: string };
  tcgplayer?: {
    url?: string;
    updatedAt?: string;
    prices?: Record<string, Record<string, number | null>>;
  };
  subtypes?: string[];
  supertype?: string;
  hp?: string;
  types?: string[];
  abilities?: Array<{ name: string; text?: string; type?: string }>;
  attacks?: Array<{ name: string; text?: string; damage?: string; cost?: string[] }>;
};

export type RankedPokemonCard = RankablePokemonCard & {
  matchScore: number;
  reasons: string[];
  confidence: CardSearchConfidence;
};

export type PokemonApiQuery = {
  label: string;
  query: string;
};

const pokemonNames = `
Bulbasaur Ivysaur Venusaur Charmander Charmeleon Charizard Squirtle Wartortle Blastoise Caterpie Metapod Butterfree
Weedle Kakuna Beedrill Pidgey Pidgeotto Pidgeot Rattata Raticate Spearow Fearow Ekans Arbok Pikachu Raichu Sandshrew
Sandslash Nidoran Nidorina Nidoqueen Nidorino Nidoking Clefairy Clefable Vulpix Ninetales Jigglypuff Wigglytuff
Zubat Golbat Oddish Gloom Vileplume Paras Parasect Venonat Venomoth Diglett Dugtrio Meowth Persian Psyduck Golduck
Mankey Primeape Growlithe Arcanine Poliwag Poliwhirl Poliwrath Abra Kadabra Alakazam Machop Machoke Machamp
Bellsprout Weepinbell Victreebel Tentacool Tentacruel Geodude Graveler Golem Ponyta Rapidash Slowpoke Slowbro
Magnemite Magneton Farfetchd Doduo Dodrio Seel Dewgong Grimer Muk Shellder Cloyster Gastly Haunter Gengar Onix
Drowzee Hypno Krabby Kingler Voltorb Electrode Exeggcute Exeggutor Cubone Marowak Hitmonlee Hitmonchan Lickitung
Koffing Weezing Rhyhorn Rhydon Chansey Tangela Kangaskhan Horsea Seadra Goldeen Seaking Staryu Starmie Scyther
Jynx Electabuzz Magmar Pinsir Tauros Magikarp Gyarados Lapras Ditto Eevee Vaporeon Jolteon Flareon Porygon
Omanyte Omastar Kabuto Kabutops Aerodactyl Snorlax Articuno Zapdos Moltres Dratini Dragonair Dragonite Mewtwo Mew
Togepi Umbreon Espeon Lugia Celebi Gardevoir Rayquaza Lucario Garchomp Leafeon Glaceon Sylveon Greninja
Mimikyu Zacian Zamazenta Eternatus Arceus Giratina Darkrai Palkia Dialga Koraidon Miraidon Ogerpon Terapagos
`.trim().split(/\s+/);

const specialPokemonNames = [
  "Mr. Mime",
  "Mime Jr.",
  "Farfetch'd",
  "Sirfetch'd",
  "Type: Null",
  "Nidoran♀",
  "Nidoran♂",
  "Ho-Oh",
  "Porygon-Z",
  "Flabébé",
  "Tapu Bulu",
  "Iron Valiant",
  "Roaring Moon",
  "Walking Wake",
  "Raging Bolt",
];

const canonicalPokemonNames = [...pokemonNames, ...specialPokemonNames];
const suffixPattern = "(?:Tag\\s*Team|Radiant|VMAX|VSTAR|BREAK|Prime|LV\\.?\\s*X|Mega|GX|EX|ex|Star|V|M)";
const luceneSpecial = /([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)/g;

function tidyUnicode(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘‛`´]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\u00a0/g, " ");
}

export function normalizeCardSearchText(value: string | null | undefined) {
  return tidyUnicode(String(value || ""))
    .replace(/([a-z])(?=(?:GX|EX|VMAX|VSTAR|BREAK)\b)/g, "$1 ")
    .replace(/[-_]+/g, " ")
    .replace(/['"]/g, "")
    .replace(/[.,;!?()[\]{}:]/g, " ")
    .replace(/[♀]/g, " female ")
    .replace(/[♂]/g, " male ")
    .replace(/[^\p{L}\p{N}/&+ ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function levenshtein(left: string, right: string) {
  const a = normalizeCardSearchText(left).replace(/\s+/g, "");
  const b = normalizeCardSearchText(right).replace(/\s+/g, "");
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= a.length; leftIndex++) {
    let previous = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= b.length; rightIndex++) {
      const saved = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        previous + (a[leftIndex - 1] === b[rightIndex - 1] ? 0 : 1),
      );
      previous = saved;
    }
  }
  return row[b.length];
}

export function textSimilarity(left: string, right: string) {
  const a = normalizeCardSearchText(left).replace(/[^a-z0-9]/g, "");
  const b = normalizeCardSearchText(right).replace(/[^a-z0-9]/g, "");
  if (!a || !b) return 0;
  return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length));
}

export function tokenSimilarity(left: string, right: string) {
  const tokens = (value: string) => new Set(normalizeCardSearchText(value).split(/\s+/).filter(Boolean));
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / new Set([...a, ...b]).size;
}

function normalizeNumberSide(value: string) {
  const compact = tidyUnicode(value).toUpperCase().replace(/\s+/g, "").replace(/\|/g, "1");
  const prefix = compact.match(/^(?:SWSH|SV|TG|GG|RC|SH|XY|SM|BW|H)/)?.[0] || "";
  const remainder = compact.slice(prefix.length)
    .replace(/[OQ]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-Z]/g, "");
  return `${prefix}${remainder}`;
}

function numberVariants(numerator: string) {
  const match = numerator.match(/^([A-Z]*)(\d+)([A-Z]?)$/);
  if (!match) return [numerator];
  const withoutZeros = `${match[1]}${String(Number(match[2]))}${match[3]}`;
  return [...new Set([numerator, withoutZeros])];
}

export function parseCollectorNumber(text: string | null | undefined): CollectorNumberParts | null {
  const originalText = String(text || "").normalize("NFKC").trim();
  if (!originalText) return null;
  const normalizedText = tidyUnicode(originalText).toUpperCase().replace(/\\+/g, "/");
  const fraction = normalizedText.match(/(?:^|\s|#)((?:(?:SWSH|SV|TG|GG|RC|SH|XY|SM|BW|H)\s*)?[0-9OQIL]{1,4}[A-Z]?)\s*[/|]\s*((?:(?:SWSH|SV|TG|GG|RC|SH|XY|SM|BW|H)\s*)?[0-9OQIL]{1,4}[A-Z]?)(?=$|\s|[),.;])/);
  if (fraction) {
    const numerator = normalizeNumberSide(fraction[1]);
    const denominator = normalizeNumberSide(fraction[2]);
    if (!/\d/.test(numerator) || !/\d/.test(denominator)) return null;
    return {
      original: fraction[0].replace(/^[\s#]+/, "").trim(),
      normalized: `${numerator}/${denominator}`,
      numerator,
      denominator,
      variants: [...new Set([`${numerator}/${denominator}`, ...numberVariants(numerator)])],
    };
  }
  const standalone = normalizedText.match(/(?:^|\s|#)((?:(?:SWSH|SV|TG|GG|RC|SH|XY|SM|BW|H)\s*)?[0-9OQIL]{1,4}[A-Z]?)(?=$|\s|[),.;])/);
  if (!standalone) return null;
  const numerator = normalizeNumberSide(standalone[1]);
  if (!/\d/.test(numerator)) return null;
  return {
    original: standalone[1].trim(),
    normalized: numerator,
    numerator,
    variants: numberVariants(numerator),
  };
}

function suffixFromName(value: string) {
  const raw = tidyUnicode(value).trim();
  const match = raw.match(new RegExp(`(?:^|\\s)(${suffixPattern})\\s*$`, "i"));
  if (!match) return "";
  const suffix = match[1].replace(/\s+/g, " ");
  if (/^ex$/.test(suffix)) return "ex";
  if (/^EX$/.test(suffix)) return "EX";
  if (/^lv/i.test(suffix)) return "LV.X";
  if (/^tag/i.test(suffix)) return "Tag Team";
  if (/^(radiant|prime|mega|star)$/i.test(suffix)) {
    return suffix[0].toUpperCase() + suffix.slice(1).toLowerCase();
  }
  return suffix.toUpperCase();
}

function withoutSuffix(value: string) {
  return tidyUnicode(value)
    .replace(new RegExp(`(?:^|\\s)${suffixPattern}\\s*$`, "i"), "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectorSpan(query: string, collector: CollectorNumberParts | null) {
  if (!collector) return query;
  const escaped = collector.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return query.replace(new RegExp(`(?:^|\\s|#)${escaped}(?=$|\\s|[),.;])`, "i"), " ");
}

function displayName(value: string) {
  if (value === "Farfetchd") return "Farfetch'd";
  return value;
}

function bestSpeciesMatch(value: string) {
  const normalized = normalizeCardSearchText(value);
  if (!normalized) return null;
  const exact = canonicalPokemonNames.find((name) => {
    const candidate = normalizeCardSearchText(name);
    return normalized === candidate
      || normalized.startsWith(`${candidate} `)
      || normalized.endsWith(` ${candidate}`)
      || normalized.includes(` ${candidate} `);
  });
  if (exact) return { name: displayName(exact), similarity: 1, original: exact };

  const tokens = normalized.split(" ");
  const windows = new Set<string>([normalized]);
  for (let start = 0; start < tokens.length; start++) {
    for (let length = 1; length <= Math.min(3, tokens.length - start); length++) {
      windows.add(tokens.slice(start, start + length).join(" "));
    }
  }
  let best: { name: string; similarity: number; source: string } | null = null;
  for (const source of windows) {
    if (source.length < 3) continue;
    for (const name of canonicalPokemonNames) {
      const normalizedName = normalizeCardSearchText(name);
      const similarity = textSimilarity(source, normalizedName);
      if (!best || similarity > best.similarity) best = { name: displayName(name), similarity, source };
    }
  }
  if (!best) return null;
  const compactSource = best.source.replace(/\s/g, "");
  const compactName = normalizeCardSearchText(best.name).replace(/\s/g, "");
  const distance = levenshtein(compactSource, compactName);
  const sharedPrefixLength = compactSource.length <= 6 ? 3 : 4;
  const sharedToken = best.source.split(" ").some((token) => token.length >= 4
    && normalizeCardSearchText(best.name).split(" ").includes(token));
  const sharedPrefix = compactSource.slice(0, sharedPrefixLength) === compactName.slice(0, sharedPrefixLength)
    || sharedToken;
  const threshold = compactName.length >= 7 ? 0.77 : 0.84;
  if (!sharedPrefix || best.similarity < threshold || distance > (compactName.length >= 8 ? 3 : 2)) return null;
  return { name: best.name, similarity: best.similarity, original: best.source };
}

export function suggestPokemonNameCorrection(value: string | null | undefined): CardSearchCorrection | undefined {
  const raw = String(value || "").trim();
  const suffix = suffixFromName(raw);
  const base = withoutSuffix(raw);
  const best = bestSpeciesMatch(base);
  if (!best || best.similarity >= 0.999) return undefined;
  const normalizedBase = normalizeCardSearchText(base);
  const normalizedOriginal = normalizeCardSearchText(best.original);
  const index = normalizedBase.indexOf(normalizedOriginal);
  const normalizedSuggestion = index >= 0
    ? `${normalizedBase.slice(0, index)}${best.name}${normalizedBase.slice(index + normalizedOriginal.length)}`
    : best.name;
  const suggestion = [normalizedSuggestion, suffix].filter(Boolean).join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    original: raw,
    suggestion,
    matchedName: best.name,
    similarity: best.similarity,
  };
}

function cleanDisplayTerm(value: string | null | undefined, maxLength = 120) {
  return tidyUnicode(String(value || ""))
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function expandCompactSuffix(value: string) {
  return value.replace(
    /([\p{Ll}])(?=(?:GX|EX|VMAX|VSTAR|BREAK|LV\.?X|Prime|Star|Radiant|Mega|TagTeam)$)/u,
    "$1 ",
  );
}

export function parseCardSearchQuery(input: CardSearchInput | string): ParsedCardSearchQuery {
  const structured = typeof input === "string" ? { query: input } : input;
  const rawQuery = cleanDisplayTerm(structured.query || "");
  const explicitCollector = parseCollectorNumber(structured.collectorNumber);
  const combinedCollector = explicitCollector || parseCollectorNumber(rawQuery || structured.name || "");
  const combinedName = expandCompactSuffix(cleanDisplayTerm(collectorSpan(structured.name || rawQuery, combinedCollector)))
    .replace(/^[#\s]+|[#\s]+$/g, "");
  const correction = structured.disableCorrection ? undefined : suggestPokemonNameCorrection(combinedName);
  const name = correction?.suggestion || combinedName;
  const suffix = suffixFromName(name);
  const baseName = withoutSuffix(name);
  return {
    rawQuery,
    normalizedQuery: normalizeCardSearchText(rawQuery),
    originalName: combinedName,
    name,
    normalizedName: normalizeCardSearchText(name),
    collector: combinedCollector,
    set: cleanDisplayTerm(structured.set || "", 80),
    language: cleanDisplayTerm(structured.language || "", 40),
    finish: cleanDisplayTerm(structured.finish || "", 40),
    cardType: cleanDisplayTerm(structured.cardType || "", 40),
    suffix,
    baseName,
    numberOnly: Boolean(combinedCollector && !combinedName),
    correction,
  };
}

export function manualCardSearchValidationError(input: CardSearchInput | string) {
  const parsed = parseCardSearchQuery(input);
  const usefulName = parsed.originalName.replace(/[^\p{L}\p{N}]/gu, "");
  if (parsed.originalName && usefulName.length < 2) return "Enter at least two useful characters in the card name.";
  if (!parsed.originalName && !parsed.collector && !parsed.set) {
    return "Enter a card name, collector number, or set.";
  }
  return "";
}

export function escapePokemonLuceneValue(value: string) {
  return cleanDisplayTerm(value).replace(luceneSpecial, "\\$1");
}

function quoted(field: string, value: string) {
  return `${field}:"${escapePokemonLuceneValue(value)}"`;
}

function unquoted(field: string, value: string) {
  return `${field}:${escapePokemonLuceneValue(value)}`;
}

function setClause(value: string) {
  if (!value) return "";
  const looksLikeId = !/\s/.test(value) && /^[a-z0-9-]{2,24}$/i.test(value);
  return looksLikeId ? unquoted("set.id", value) : quoted("set.name", value);
}

export function buildPokemonApiQueries(input: CardSearchInput | ParsedCardSearchQuery): PokemonApiQuery[] {
  const parsed = "normalizedQuery" in input ? input : parseCardSearchQuery(input);
  const values: PokemonApiQuery[] = [];
  const add = (label: string, parts: string[]) => {
    const query = parts.filter(Boolean).join(" ").trim();
    if (query && !values.some((value) => value.query === query)) values.push({ label, query });
  };
  const number = parsed.collector?.numerator || "";
  const alternativeNumber = parsed.collector?.variants
    .map((value) => value.split("/")[0])
    .find((value) => value && value !== number) || "";
  const set = setClause(parsed.set);
  const spacedName = parsed.name;
  const hyphenatedName = parsed.suffix && parsed.baseName
    ? `${parsed.baseName}-${parsed.suffix.replace(/\s+/g, "-")}`
    : "";
  const preferHyphen = /^(?:GX|EX)$/.test(parsed.suffix);
  const nameVariants = [...new Set(
    (preferHyphen ? [hyphenatedName, spacedName] : [spacedName, hyphenatedName]).filter(Boolean),
  )];
  const originalName = parsed.originalName && normalizeCardSearchText(parsed.originalName) !== parsed.normalizedName
    ? parsed.originalName
    : "";
  const normalizedBase = normalizeCardSearchText(parsed.baseName);
  const simpleName = parsed.name && !parsed.suffix && /^[\p{L}\p{N}]+$/u.test(parsed.name)
    ? normalizeCardSearchText(parsed.name)
    : "";
  const safePrefix = normalizedBase.length >= 3
    ? escapePokemonLuceneValue(normalizedBase.slice(0, Math.min(4, normalizedBase.length)))
    : "";

  // Short prefixes work best as a bounded wildcard. Complete names use an exact
  // provider query first, with the wildcard immediately behind as a safe fallback.
  if (!number && !set && simpleName) {
    if (simpleName.length <= 4) {
      add("name prefix", [`name:${escapePokemonLuceneValue(simpleName)}*`]);
      add("exact normalized name", [unquoted("name", simpleName)]);
    } else {
      add("exact normalized name", [unquoted("name", simpleName)]);
      add("name prefix", [`name:${escapePokemonLuceneValue(simpleName)}*`]);
    }
  }

  for (const name of nameVariants) {
    if (number && set) {
      add("exact name, number, and set", [
        simpleName ? unquoted("name", simpleName) : quoted("name", name),
        unquoted("number", number),
        set,
      ]);
    }
  }
  for (const name of nameVariants) {
    if (number) {
      add("exact name and number", [
        simpleName ? unquoted("name", simpleName) : quoted("name", name),
        unquoted("number", number),
      ]);
    }
  }
  if (parsed.baseName && number && parsed.baseName !== parsed.name) {
    add("base name and number", [quoted("name", parsed.baseName), unquoted("number", number)]);
  }
  if (number && set) add("collector number and set", [unquoted("number", number), set]);
  if (number) add("exact collector number", [unquoted("number", number)]);
  for (const name of nameVariants) {
    if (set) add("exact name and set", [quoted("name", name), set]);
  }
  if (number && simpleName) add("exact normalized name", [unquoted("name", simpleName)]);
  for (const name of nameVariants) {
    if (!simpleName) add("exact card name", [quoted("name", name)]);
  }
  if (originalName && number) add("original name and number", [quoted("name", originalName), unquoted("number", number)]);
  if (originalName) add("original typed name", [quoted("name", originalName)]);
  if (parsed.baseName && parsed.baseName !== parsed.name) add("base card name", [quoted("name", parsed.baseName)]);
  if (safePrefix) add("broader name prefix", [`name:${safePrefix}*`]);
  if (alternativeNumber && simpleName) {
    add("unpadded name and collector number", [unquoted("name", simpleName), unquoted("number", alternativeNumber)]);
  }
  if (alternativeNumber) add("unpadded collector number", [unquoted("number", alternativeNumber)]);
  if (!parsed.name && set) add("set", [set]);
  return values.slice(0, 8);
}

function normalizedCardNumber(value: string) {
  return normalizeNumberSide(value);
}

function suffixKey(value: string) {
  const suffix = suffixFromName(value);
  if (suffix === "ex") return "ex-lower";
  if (suffix === "EX") return "ex-upper";
  return suffix.toLocaleLowerCase();
}

function confidenceFor(score: number, exactNumber: boolean, exactName: boolean): CardSearchConfidence {
  if ((exactNumber && exactName) || score >= 92) return "exact";
  if (score >= 70 || exactNumber) return "likely";
  if (score >= 43) return "possible";
  return "unreliable";
}

export function rankPokemonCardResults(cards: RankablePokemonCard[], input: CardSearchInput | ParsedCardSearchQuery | string) {
  const parsed = typeof input !== "string" && "normalizedQuery" in input ? input : parseCardSearchQuery(input);
  const wantedNumberVariants = new Set(parsed.collector?.variants.map(normalizedCardNumber) || []);
  const wantedName = parsed.normalizedName;
  const wantedBase = normalizeCardSearchText(parsed.baseName);
  const wantedSuffix = suffixKey(parsed.name);
  const wantedSet = normalizeCardSearchText(parsed.set);

  return cards.map((card) => {
    const cardName = normalizeCardSearchText(card.name);
    const cardBase = normalizeCardSearchText(withoutSuffix(card.name));
    const cardNumber = normalizedCardNumber(card.number);
    const exactNumber = wantedNumberVariants.has(cardNumber);
    const exactName = Boolean(wantedName && cardName === wantedName);
    const nameSimilarity = wantedName
      ? Math.max(textSimilarity(wantedName, cardName), tokenSimilarity(wantedName, cardName))
      : 0;
    const baseSimilarity = wantedBase
      ? Math.max(textSimilarity(wantedBase, cardBase), tokenSimilarity(wantedBase, cardBase))
      : 0;
    let score = 0;
    const reasons: string[] = [];

    if (exactNumber) {
      score += 52;
      reasons.push("Exact collector number");
    }
    if (exactName) {
      score += 45;
      reasons.push("Exact printed name");
    } else if (wantedName.length >= 3 && cardName.startsWith(wantedName)) {
      score += 50;
      reasons.push("Card name starts with search");
    } else if (baseSimilarity >= 0.92) {
      score += 34;
      reasons.push("Card name closely matches");
    } else if (nameSimilarity >= 0.7 || baseSimilarity >= 0.7) {
      score += Math.round(Math.max(nameSimilarity, baseSimilarity) * 26);
      reasons.push("Possible fuzzy name match");
    }
    if (exactNumber && (exactName || baseSimilarity >= 0.82)) {
      score += 12;
      reasons.push("Name and number agree");
    }

    const cardSuffix = suffixKey(card.name);
    if (wantedSuffix) {
      if (cardSuffix === wantedSuffix) {
        score += 14;
        reasons.push(`${suffixFromName(card.name)} suffix matches`);
      } else {
        score -= 28;
        reasons.push("Printed suffix differs");
      }
    }

    const cardSetValues = [
      card.set?.id,
      card.set?.name,
      card.set?.ptcgoCode,
    ].map(normalizeCardSearchText);
    if (wantedSet && cardSetValues.some((value) => value === wantedSet || value.includes(wantedSet))) {
      score += 16;
      reasons.push("Requested set matches");
    }

    const denominatorDigits = parsed.collector?.denominator?.replace(/\D/g, "") || "";
    if (denominatorDigits && [card.set?.printedTotal, card.set?.total].some((value) => String(value || "") === denominatorDigits)) {
      score += 8;
      reasons.push("Set total matches");
    }
    if (parsed.correction && (exactName || baseSimilarity >= 0.9)) reasons.push(`Matches suggested spelling “${parsed.correction.suggestion}”`);
    if (!reasons.length) reasons.push("Broad catalog candidate");
    const matchScore = Math.max(0, Math.min(100, Math.round(score)));
    return {
      ...card,
      matchScore,
      reasons,
      confidence: confidenceFor(matchScore, exactNumber, exactName),
    } satisfies RankedPokemonCard;
  }).sort((left, right) => right.matchScore - left.matchScore
    || String(right.set?.releaseDate || "").localeCompare(String(left.set?.releaseDate || "")));
}

// Compatibility helpers for older callers while the unified UI uses `query`.
export type ManualCardSearchTerms = {
  query?: string | null;
  name?: string | null;
  collectorNumber?: string | null;
  set?: string | null;
  language?: string | null;
  finish?: string | null;
  cardType?: string | null;
  disableCorrection?: boolean;
};

export function normalizeManualCardSearchTerms(input: ManualCardSearchTerms) {
  const parsed = parseCardSearchQuery(input);
  return {
    name: parsed.originalName,
    collectorNumber: parsed.collector?.normalized || "",
    set: parsed.set,
    language: parsed.language,
  };
}

export function buildManualPokemonQuery(input: ManualCardSearchTerms) {
  const parsed = parseCardSearchQuery({ ...input, disableCorrection: true });
  const number = parsed.collector?.numerator || "";
  return [
    parsed.originalName ? quoted("name", parsed.originalName.replace(/["\\]/g, " ").replace(/\s+/g, " ").replace(/[.,;:!?]+$/g, "")) : "",
    number ? unquoted("number", number) : "",
    setClause(parsed.set),
  ].filter(Boolean).join(" ");
}
