export const CARD_SUFFIXES = ["ex", "EX", "GX", "V", "VMAX", "VSTAR", "BREAK"] as const;

const pokemonNames = `
Bulbasaur Ivysaur Venusaur Charmander Charmeleon Charizard Squirtle Wartortle Blastoise Caterpie Metapod Butterfree
Weedle Kakuna Beedrill Pidgey Pidgeotto Pidgeot Rattata Raticate Spearow Fearow Ekans Arbok Pikachu Raichu Sandshrew
Sandslash Nidoran Nidorina Nidoqueen Nidorino Nidoking Clefairy Clefable Vulpix Ninetales Jigglypuff Wigglytuff
Zubat Golbat Oddish Gloom Vileplume Paras Parasect Venonat Venomoth Diglett Dugtrio Meowth Persian Psyduck Golduck
Mankey Primeape Growlithe Arcanine Poliwag Poliwhirl Poliwrath Abra Kadabra Alakazam Machop Machoke Machamp
Bellsprout Weepinbell Victreebel Tentacool Tentacruel Geodude Graveler Golem Ponyta Rapidash Slowpoke Slowbro
Magnemite Magneton Farfetchd Doduo Dodrio Seel Dewgong Grimer Muk Shellder Cloyster Gastly Haunter Gengar Onix
Drowzee Hypno Krabby Kingler Voltorb Electrode Exeggcute Exeggutor Cubone Marowak Hitmonlee Hitmonchan Lickitung
Koffing Weezing Rhyhorn Rhydon Chansey Tangela Kangaskhan Horsea Seadra Goldeen Seaking Staryu Starmie MrMime
Scyther Jynx Electabuzz Magmar Pinsir Tauros Magikarp Gyarados Lapras Ditto Eevee Vaporeon Jolteon Flareon Porygon
Omanyte Omastar Kabuto Kabutops Aerodactyl Snorlax Articuno Zapdos Moltres Dratini Dragonair Dragonite Mewtwo Mew
Togepi Umbreon Espeon Lugia HoOh Celebi Gardevoir Rayquaza Lucario Garchomp Leafeon Glaceon Sylveon Greninja
Mimikyu Zacian Zamazenta Eternatus Hisuian Arceus Giratina Darkrai Palkia Dialga Koraidon Miraidon Ogerpon
Terapagos IronValiant RoaringMoon WalkingWake RagingBolt
`.trim().split(/\s+/);

const ignoredNameTokens = new Set([
  "pokemon", "pokémon", "basic", "stage", "trainer", "energy", "ability", "weakness", "resistance", "retreat",
  "illustrator", "card", "the", "this", "re", "hp",
]);
const ocrSuffixMap = new Map<string, string>([
  ["ex", "ex"],
  ["it", "ex"],
  ["gx", "GX"],
  ["v", "V"],
  ["max", "VMAX"],
  ["vmax", "VMAX"],
  ["vstar", "VSTAR"],
  ["break", "BREAK"],
]);

export type CollectorNumberParts = {
  normalized: string;
  numerator: string;
  denominator?: string;
};

export type NameEvidence = {
  raw: string;
  normalized: string;
  baseCandidate: string;
  suffix: string;
  candidates: string[];
};

export type RankablePokemonCard = {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set?: { name?: string; printedTotal?: number; total?: number };
  images?: { small?: string; large?: string };
  tcgplayer?: { prices?: Record<string, Record<string, number | null>> };
};

export type RankedPokemonCard = RankablePokemonCard & {
  matchScore: number;
  reasons: string[];
};

export function levenshtein(left: string, right: string) {
  const a = left.toLocaleLowerCase();
  const b = right.toLocaleLowerCase();
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
  const a = left.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  const b = right.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  if (!a || !b) return 0;
  return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length));
}

export function tokenSimilarity(left: string, right: string) {
  const tokens = (value: string) => new Set(value.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / new Set([...a, ...b]).size;
}

function normalizeNumberSide(value: string) {
  const compact = value.toUpperCase().replace(/\s+/g, "").replace(/\|/g, "1");
  const prefix = compact.match(/^[A-Z]{1,4}/)?.[0] || "";
  const remainder = compact.slice(prefix.length)
    .replace(/[OQ]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-Z]/g, "");
  return `${prefix}${remainder}`;
}

export function parseCollectorNumber(text: string): CollectorNumberParts | null {
  const normalizedText = text.normalize("NFKC").toUpperCase()
    .replace(/[—–]/g, "-")
    .replace(/\\+/g, "/");
  const fraction = normalizedText.match(/\b([A-Z]{0,4}\s*[0-9OQIL]{1,4}[A-Z]?)\s*[/|]\s*([A-Z]{0,4}\s*[0-9OQIL]{1,4}[A-Z]?)\b/);
  if (fraction) {
    const numerator = normalizeNumberSide(fraction[1]);
    const denominator = normalizeNumberSide(fraction[2]);
    return { normalized: `${numerator}/${denominator}`, numerator, denominator };
  }
  const standalone = normalizedText.match(/\b((?:SV|TG|GG|RC|SH|SWSH|XY|SM|BW)\s*[0-9OQIL]{1,4}[A-Z]?|[0-9]{3}[A-Z]?)\b/);
  if (!standalone) return null;
  const numerator = normalizeNumberSide(standalone[1]);
  return { normalized: numerator, numerator };
}

function displayPokemonName(value: string) {
  if (value === "Farfetchd") return "Farfetch'd";
  if (value === "MrMime") return "Mr. Mime";
  if (value === "HoOh") return "Ho-Oh";
  if (value === "IronValiant") return "Iron Valiant";
  if (value === "RoaringMoon") return "Roaring Moon";
  if (value === "WalkingWake") return "Walking Wake";
  if (value === "RagingBolt") return "Raging Bolt";
  return value;
}

function nearestPokemon(value: string) {
  if (value.length < 3) return null;
  const ranked = pokemonNames
    .map((name) => ({ name: displayPokemonName(name), score: textSimilarity(value, name) }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.score >= (value.length >= 7 ? 0.62 : 0.72) ? ranked[0] : null;
}

export function buildNameEvidence(raw: string): NameEvidence {
  const normalized = raw.normalize("NFKC")
    .replace(/[©®™]/g, " ")
    .replace(/[0]/g, "O")
    .replace(/[^\p{L}\p{N}' .:&-]+/gu, " ")
    .replace(/\b(?:BASIC|STAGE\s*[12]|HP\s*\d*)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const suffixToken = [...tokens].reverse().find((token) => ocrSuffixMap.has(token.toLocaleLowerCase()));
  const suffix = suffixToken ? ocrSuffixMap.get(suffixToken.toLocaleLowerCase()) || "" : "";
  const words = tokens.filter((token) => token !== suffixToken
    && token.length >= 3
    && /[A-Za-z]/.test(token)
    && !ignoredNameTokens.has(token.toLocaleLowerCase())
    && !/^\d+$/.test(token));
  const likelyWords = [...words].sort((left, right) => right.length - left.length).slice(0, 3);
  const dictionaryCandidates = likelyWords
    .map((word) => nearestPokemon(word))
    .filter((value): value is { name: string; score: number } => Boolean(value))
    .sort((left, right) => right.score - left.score);
  const baseCandidate = dictionaryCandidates[0]?.name || likelyWords[0] || "";
  const values = [
    [baseCandidate, suffix].filter(Boolean).join(" "),
    baseCandidate,
    ...dictionaryCandidates.slice(1, 3).map((candidate) => [candidate.name, suffix].filter(Boolean).join(" ")),
  ].filter(Boolean);
  return {
    raw,
    normalized,
    baseCandidate,
    suffix,
    candidates: [...new Set(values)],
  };
}

export function extractRawNameCandidate(text: string, confidence: number) {
  const lines = text.split(/\r?\n/)
    .map((line) => line.replace(/[^\p{L}\p{N}' .:&-]/gu, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3 && line.length <= 36 && /[A-Za-z]{3}/.test(line))
    .filter((line) => !/\b(?:pokemon|pokémon|basic|stage|trainer|energy|ability|weakness|resistance|retreat|illustrator|damage)\b/i.test(line))
    .sort((left, right) => {
      const leftEvidence = buildNameEvidence(left);
      const rightEvidence = buildNameEvidence(right);
      return Number(Boolean(rightEvidence.baseCandidate)) - Number(Boolean(leftEvidence.baseCandidate))
        || Number(/\d/.test(left)) - Number(/\d/.test(right))
        || left.length - right.length;
    });
  const candidate = lines[0] || null;
  return confidence >= 20 || candidate ? candidate : null;
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

function suffixFromOfficialName(name: string) {
  return name.match(/\b(ex|EX|GX|V|VMAX|VSTAR|BREAK)\b/)?.[1] || "";
}

export function rankPokemonCards(cards: RankablePokemonCard[], evidence: NameEvidence, collector: CollectorNumberParts | null) {
  return cards.map((card): RankedPokemonCard => {
    const officialBase = card.name.replace(/\b(?:ex|EX|GX|V|VMAX|VSTAR|BREAK)\b/g, "").trim();
    const nameScore = evidence.baseCandidate
      ? Math.max(textSimilarity(evidence.baseCandidate, officialBase), tokenSimilarity(evidence.baseCandidate, officialBase))
      : 0;
    let score = nameScore * 55;
    const reasons: string[] = [];
    if (nameScore >= 0.82) reasons.push("card name closely matches OCR");
    else if (nameScore >= 0.58) reasons.push("card name is a fuzzy OCR match");
    if (collector?.numerator && card.number.toUpperCase() === collector.numerator.toUpperCase()) {
      score += 28;
      reasons.push("collector number matches");
    }
    const printedTotal = String(card.set?.printedTotal || "");
    const total = String(card.set?.total || "");
    const denominatorDigits = collector?.denominator?.replace(/\D/g, "") || "";
    if (denominatorDigits && (printedTotal === denominatorDigits || total === denominatorDigits)) {
      score += 12;
      reasons.push("set total matches");
    }
    const officialSuffix = suffixFromOfficialName(card.name);
    if (evidence.suffix && officialSuffix.toLocaleLowerCase() === evidence.suffix.toLocaleLowerCase()) {
      score += 5;
      reasons.push(`${officialSuffix} suffix matches`);
    } else if (evidence.suffix && officialSuffix) {
      score -= 4;
      reasons.push("printed suffix differs");
    }
    if (!reasons.length) reasons.push("broad search candidate");
    return { ...card, matchScore: Math.max(0, Math.min(100, Math.round(score))), reasons };
  }).sort((left, right) => right.matchScore - left.matchScore);
}

export function buildPokemonApiQueries(evidence: NameEvidence, collector: CollectorNumberParts | null, manualName?: string) {
  const manual = manualName?.trim().replace(/["\\]/g, " ");
  const nameCandidates = manual ? [manual] : evidence.candidates;
  const primaryName = nameCandidates[0];
  const queries = [
    primaryName && collector?.numerator ? `name:"${primaryName}" number:${collector.numerator}` : "",
    primaryName ? `name:"${primaryName}"` : "",
    collector?.numerator ? `number:${collector.numerator}` : "",
    evidence.baseCandidate ? `name:${evidence.baseCandidate.slice(0, Math.min(6, evidence.baseCandidate.length))}*` : "",
  ].filter(Boolean);
  return [...new Set(queries)].slice(0, 3);
}
