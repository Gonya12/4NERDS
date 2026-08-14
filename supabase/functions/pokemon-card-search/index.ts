import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  buildPokemonApiQueries,
  escapePokemonLuceneValue,
  manualCardSearchValidationError,
  normalizeCardSearchText,
  parseCardSearchQuery,
  rankPokemonCardResults,
  type CardSearchConfidence,
  type RankablePokemonCard,
} from "../_shared/pokemonCardSearchCore.ts";
import {
  extractOnePieceCardCode,
  normalizeCardGame,
  normalizeCardLanguage,
  normalizeOnePieceCardCode,
  onePieceSearchName,
  rankOnePieceCards,
  type RankableOnePieceCard,
  type UnifiedCardMatch,
  type UnifiedCardPriceVariant,
  type UnifiedCardSearchInput,
} from "../_shared/unifiedCardSearchCore.ts";
import {
  parseCompatibleCardSearchRequest,
  type CardSearchRequestWithOptions,
} from "../_shared/cardSearchRequestContract.ts";

const pokemonCardsUrl = "https://api.pokemontcg.io/v2/cards";
const tcgdexUrl = "https://api.tcgdex.net/v2";
const optcgUrl = "https://optcgapi.com/api";
const selectedPokemonFields = "id,name,number,set,rarity,images,tcgplayer,subtypes,supertype,hp,types,abilities,attacks";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-request-id, retry-after",
};
const edgeDebugEnabled = Deno.env.get("CARD_SEARCH_DEBUG") === "true";

type SearchRequest = CardSearchRequestWithOptions;
type JsonRecord = Record<string, unknown>;
type UpstreamResult = {
  payload: unknown;
  status: number;
  retryAfter?: string;
};

const responseCache = new Map<string, { expiresAt: number; result: UpstreamResult }>();
const inFlight = new Map<string, Promise<UpstreamResult>>();

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function edgeDebug(event: string, details: Record<string, unknown>) {
  if (edgeDebugEnabled) console.info("[smart-card-search]", { event, ...details });
}

function withRequestId(response: Response, requestId: string) {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function structuredError(
  code: string,
  message: string,
  status: number,
  retryAfter?: string,
  details: { upstreamReached?: boolean; providerResponseStatus?: number } = {},
) {
  return json(
    {
      success: false,
      code,
      message,
      edgeFunctionReached: true,
      upstreamReached: details.upstreamReached ?? false,
      providerResponseStatus: details.providerResponseStatus,
    },
    status,
    retryAfter ? { "Retry-After": retryAfter, "Cache-Control": "no-store" } : { "Cache-Control": "no-store" },
  );
}

function debugFields(details: JsonRecord) {
  return edgeDebugEnabled ? details : {};
}

async function withDebugFields(response: Response, details: JsonRecord) {
  if (!edgeDebugEnabled) return response;
  const payload = await response.clone().json().catch(() => ({}));
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ ...record(payload), ...details }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function rows(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object"));
  const root = record(value);
  const data = root.data;
  if (Array.isArray(data)) return data.filter((item): item is JsonRecord => Boolean(item && typeof item === "object"));
  return data && typeof data === "object" ? [data as JsonRecord] : [];
}

async function fetchUpstream(
  endpoint: string,
  options: { headers?: HeadersInit; cacheMs?: number; timeoutMs?: number } = {},
): Promise<UpstreamResult> {
  const cached = responseCache.get(endpoint);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const active = inFlight.get(endpoint);
  if (active) return active;
  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10_000);
    try {
      const upstream = await fetch(endpoint, { headers: options.headers, signal: controller.signal });
      const payload = await upstream.json().catch(() => null);
      edgeDebug("provider response", {
        providerHost: new URL(endpoint).host,
        providerResponseStatus: upstream.status,
        resultCount: rows(payload).length,
      });
      const result = {
        payload,
        status: upstream.status,
        retryAfter: upstream.headers.get("Retry-After") || undefined,
      };
      if (upstream.ok) {
        if (responseCache.size >= 180) responseCache.delete(responseCache.keys().next().value as string);
        responseCache.set(endpoint, { expiresAt: Date.now() + (options.cacheMs || 2 * 60_000), result });
      }
      return result;
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => inFlight.delete(endpoint));
  inFlight.set(endpoint, promise);
  return promise;
}

function confidenceFromScore(value: number) {
  return value >= 78 ? "high" as const : value >= 52 ? "medium" as const : "low" as const;
}

function pokemonPricing(card: RankablePokemonCard) {
  const variants: UnifiedCardPriceVariant[] = Object.entries(card.tcgplayer?.prices || {}).map(([name, price]) => ({
    name,
    market: number(price.market),
    low: number(price.low),
    mid: number(price.mid),
    high: number(price.high),
    directLow: number(price.directLow),
  }));
  const firstMarket = variants.find((variant) => variant.market != null);
  return {
    currency: "USD",
    market: firstMarket?.market,
    low: firstMarket?.low,
    mid: firstMarket?.mid,
    high: firstMarket?.high,
    updatedAt: card.tcgplayer?.updatedAt,
    source: "TCGplayer",
    variants,
  };
}

function pokemonMatch(
  card: RankablePokemonCard,
  matchScore: number,
  reasons: string[],
  searchConfidence: CardSearchConfidence,
): UnifiedCardMatch {
  return {
    game: "pokemon",
    language: "en",
    provider: "pokemontcg",
    providerCardId: card.id,
    name: card.name,
    collectorNumber: card.number,
    setId: card.set?.id,
    setName: card.set?.name,
    setCode: card.set?.ptcgoCode || card.set?.id,
    setReleaseDate: card.set?.releaseDate,
    rarity: card.rarity,
    imageSmall: card.images?.small,
    imageLarge: card.images?.large,
    productUrl: card.tcgplayer?.url,
    pricing: pokemonPricing(card),
    supertype: card.supertype,
    subtypes: card.subtypes,
    hp: card.hp,
    types: card.types,
    abilities: card.abilities,
    attacks: card.attacks,
    matchScore,
    reasons,
    searchConfidence,
    matchConfidence: confidenceFromScore(matchScore),
  };
}

function pokemonEndpoint(query: string, page: number, pageSize: number) {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    pageSize: String(pageSize),
    select: selectedPokemonFields,
  });
  return `${pokemonCardsUrl}?${params.toString()}`;
}

async function searchEnglishPokemon(input: SearchRequest, page: number, pageSize: number) {
  const apiKey = Deno.env.get("POKEMON_TCG_API_KEY");
  if (!apiKey) {
    return {
      error: structuredError(
        "POKEMON_TCG_API_KEY_NOT_CONFIGURED",
        "POKEMON_TCG_API_KEY is not configured",
        503,
      ),
    };
  }
  const headers = { "X-Api-Key": apiKey };
  const providerCardId = String(input.providerCardId || input.id || "").trim();
  if (providerCardId) {
    if (!/^[a-z0-9-]{2,80}$/i.test(providerCardId)) {
      return { error: structuredError("INVALID_CARD_ID", "Invalid Pokémon TCG API card ID.", 400) };
    }
    const params = new URLSearchParams({ select: selectedPokemonFields });
    const result = await fetchUpstream(`${pokemonCardsUrl}/${encodeURIComponent(providerCardId)}?${params}`, { headers });
    if (result.status === 429) {
      return { error: structuredError("RATE_LIMITED", "Pokémon TCG API rate limit reached.", 429, result.retryAfter, { upstreamReached: true, providerResponseStatus: 429 }) };
    }
    if (result.status < 200 || result.status >= 300) {
      return { error: structuredError("POKEMON_TCG_UNAVAILABLE", "Pokémon TCG API could not load that card.", result.status >= 500 ? 503 : result.status, undefined, { upstreamReached: true, providerResponseStatus: result.status }) };
    }
    const card = rows(result.payload)[0] as unknown as RankablePokemonCard | undefined;
    return {
      matches: card ? [pokemonMatch(card, 100, ["Exact provider card ID"], "exact")] : [],
      totalCount: card ? 1 : 0,
      hasMore: false,
      warnings: [],
      query: `id:${providerCardId}`,
      providerResponseStatus: result.status,
      upstreamReached: true,
    };
  }

  const fingerprintOnly = Boolean(!input.name && !input.collectorNumber && (input.abilityName || input.attackName));
  const validation = fingerprintOnly ? null : manualCardSearchValidationError(input);
  if (validation) return { error: structuredError("INVALID_QUERY_FORMAT", validation, 400) };
  const parsed = parseCardSearchQuery(input);
  const fingerprintQueries = [
    input.abilityName ? { label: "ability fingerprint", query: `abilities.name:\"${escapePokemonLuceneValue(input.abilityName)}\"` } : undefined,
    input.attackName ? { label: "attack fingerprint", query: `attacks.name:\"${escapePokemonLuceneValue(input.attackName)}\"` } : undefined,
  ].filter((query): query is { label: string; query: string } => Boolean(query));
  const queries = fingerprintOnly ? fingerprintQueries : buildPokemonApiQueries(parsed);
  const cards = new Map<string, RankablePokemonCard>();
  const warnings: string[] = [];
  let reportedTotal = 0;
  let hasMore = false;
  let successfulQueries = 0;
  let successfulQuery = "";
  let lastProviderStatus: number | undefined;

  for (const candidate of queries) {
    edgeDebug("provider request", {
      provider: "pokemontcg",
      generatedApiQuery: candidate.query,
      page,
      pageSize,
    });
    const result = await fetchUpstream(pokemonEndpoint(candidate.query, page, pageSize), { headers });
    lastProviderStatus = result.status;
    if (result.status === 429) {
      if (!cards.size) return { error: structuredError("RATE_LIMITED", "Pokémon TCG API rate limit reached.", 429, result.retryAfter, { upstreamReached: true, providerResponseStatus: 429 }) };
      warnings.push("Pokémon TCG API rate limiting stopped broader fallbacks; existing results are shown.");
      break;
    }
    if (result.status === 400) continue;
    if (result.status === 401 || result.status === 403) {
      return { error: structuredError("POKEMON_TCG_AUTH_UNAVAILABLE", "Pokémon TCG API authentication is unavailable.", 503, undefined, { upstreamReached: true, providerResponseStatus: result.status }) };
    }
    if (result.status >= 500) continue;
    if (result.status < 200 || result.status >= 300) continue;
    successfulQueries += 1;
    if (!successfulQuery) successfulQuery = candidate.query;
    const root = record(result.payload);
    const found = rows(result.payload) as unknown as RankablePokemonCard[];
    found.forEach((card) => cards.set(card.id, card));
    reportedTotal = Math.max(reportedTotal, Number(root.totalCount || found.length));
    hasMore ||= page * pageSize < Number(root.totalCount || 0);
    if (cards.size >= pageSize) break;
  }
  if (!successfulQueries && !cards.size) {
    const allRejected = lastProviderStatus === 400;
    return {
      error: structuredError(
        allRejected ? "INVALID_GENERATED_QUERY" : "POKEMON_TCG_UNAVAILABLE",
        allRejected
          ? "The Pokémon TCG API rejected every safe generated query."
          : "Pokémon TCG API did not complete a usable search.",
        allRejected ? 400 : 503,
        undefined,
        { upstreamReached: true, providerResponseStatus: lastProviderStatus },
      ),
    };
  }
  if (parsed.correction) warnings.push(`Possible spelling: ${parsed.correction.suggestion}. Original wording was also searched.`);
  const ranked = fingerprintOnly
    ? [...cards.values()].map((card) => pokemonMatch(card, 48, ["Provider content fingerprint candidate"], "possible"))
    : rankPokemonCardResults([...cards.values()], parsed)
      .filter((card) => card.confidence !== "unreliable")
      .map((card) => pokemonMatch(card, card.matchScore, card.reasons, card.confidence));
  return {
    matches: ranked,
    totalCount: Math.max(ranked.length, reportedTotal),
    hasMore,
    warnings,
    parsed,
    query: successfulQuery || queries[0]?.query || "",
    providerResponseStatus: lastProviderStatus,
    upstreamReached: true,
  };
}

type TcgDexDetail = JsonRecord & {
  id?: string;
  localId?: string;
  name?: string;
  rarity?: string;
  image?: string;
  updated?: string;
  set?: { id?: string; name?: string };
  pricing?: JsonRecord;
  variants_detailed?: Array<{ type?: string; size?: string; pricing?: JsonRecord }>;
};

function tcgdexMarket(pricingValue: unknown) {
  const pricing = record(pricingValue);
  const tcgplayer = record(pricing.tcgplayer);
  const cardmarket = record(pricing.cardmarket);
  const tcgMarket = number(tcgplayer.marketPrice ?? tcgplayer.market);
  if (tcgMarket != null) {
    return {
      currency: "USD",
      market: tcgMarket,
      low: number(tcgplayer.lowPrice ?? tcgplayer.low),
      mid: number(tcgplayer.midPrice ?? tcgplayer.mid),
      high: number(tcgplayer.highPrice ?? tcgplayer.high),
      updatedAt: String(tcgplayer.updatedAt || tcgplayer.updated || "") || undefined,
      source: "TCGdex / TCGplayer",
    };
  }
  const cardmarketValue = number(cardmarket.trend ?? cardmarket.avg);
  if (cardmarketValue != null) {
    return {
      currency: String(cardmarket.unit || "EUR"),
      market: cardmarketValue,
      low: number(cardmarket.low),
      mid: number(cardmarket.avg),
      high: number(cardmarket.avg1),
      updatedAt: String(cardmarket.updated || "") || undefined,
      source: "TCGdex / Cardmarket",
    };
  }
  return undefined;
}

function tcgdexMatch(detail: TcgDexDetail, input: SearchRequest, aliasLookup: boolean): UnifiedCardMatch {
  const rawQuery = String(input.query || [input.name, input.collectorNumber].filter(Boolean).join(" ")).trim();
  const parsed = parseCardSearchQuery(input);
  const requestedName = normalizeCardSearchText(parsed.originalName);
  const requestedNumber = parsed.collector?.numerator;
  const exactName = Boolean(requestedName && normalizeCardSearchText(detail.name) === requestedName);
  const exactNumber = Boolean(requestedNumber && normalizeCardSearchText(detail.localId) === normalizeCardSearchText(requestedNumber));
  let score = exactName ? 48 : requestedName && normalizeCardSearchText(detail.name).includes(requestedName) ? 34 : 0;
  const reasons: string[] = [];
  if (exactNumber) {
    score += 52;
    reasons.push("Exact Japanese collector number");
  }
  if (exactName) reasons.push("Exact Japanese printed name");
  else if (aliasLookup) {
    score += 70;
    reasons.push("English alias matched this TCGdex card ID; verify the Japanese printing");
  }
  const wantedSet = normalizeCardSearchText(input.set);
  if (wantedSet && normalizeCardSearchText(`${detail.set?.id || ""} ${detail.set?.name || ""}`).includes(wantedSet)) {
    score += 12;
    reasons.push("Set matches");
  } else if (wantedSet) {
    score -= 12;
  }
  if (!rawQuery) score = 0;
  score = Math.max(0, Math.min(100, score));
  const directPricing = tcgdexMarket(detail.pricing);
  const variants: UnifiedCardPriceVariant[] = (detail.variants_detailed || []).flatMap((variant) => {
    const price = tcgdexMarket(variant.pricing);
    return price ? [{
      name: [variant.type, variant.size].filter(Boolean).join(" ") || "Provider variant",
      market: price.market,
      low: price.low,
      mid: price.mid,
      high: price.high,
    }] : [];
  });
  const pricing = directPricing ? { ...directPricing, variants } : undefined;
  const image = detail.image ? String(detail.image) : undefined;
  const searchConfidence: CardSearchConfidence = exactName && exactNumber
    ? "exact"
    : score >= 70 ? "likely" : score >= 44 ? "possible" : "unreliable";
  return {
    game: "pokemon",
    language: "ja",
    provider: "tcgdex",
    providerCardId: String(detail.id || ""),
    name: String(detail.name || ""),
    collectorNumber: String(detail.localId || ""),
    setId: detail.set?.id,
    setName: detail.set?.name,
    setCode: detail.set?.id,
    rarity: detail.rarity,
    imageSmall: image ? `${image}/low.webp` : undefined,
    imageLarge: image ? `${image}/high.webp` : undefined,
    pricing,
    matchScore: score,
    reasons: reasons.length ? reasons : ["Japanese catalog candidate"],
    searchConfidence,
    matchConfidence: confidenceFromScore(score),
  };
}

async function searchJapanesePokemon(input: SearchRequest, page: number, pageSize: number) {
  const providerCardId = String(input.providerCardId || input.id || "").trim();
  const parsed = parseCardSearchQuery(input);
  const rawName = parsed.originalName || parsed.name;
  const usesLatinAlias = Boolean(rawName && /^[\x00-\x7F\s.'’-]+$/.test(rawName));
  const briefById = new Map<string, JsonRecord>();
  let aliasLookup = false;

  if (providerCardId) {
    briefById.set(providerCardId, { id: providerCardId });
  } else {
    const validation = manualCardSearchValidationError(input);
    if (validation) return { error: structuredError("INVALID_QUERY_FORMAT", validation, 400) };
    const endpoints: string[] = [];
    if (rawName) {
      const params = new URLSearchParams({ name: rawName });
      endpoints.push(`${tcgdexUrl}/${usesLatinAlias ? "en" : "ja"}/cards?${params}`);
      aliasLookup = usesLatinAlias;
    }
    if (parsed.collector?.numerator) {
      const params = new URLSearchParams({ localId: parsed.collector.numerator });
      endpoints.push(`${tcgdexUrl}/ja/cards?${params}`);
    }
    for (const endpoint of endpoints) {
      const result = await fetchUpstream(endpoint);
      if (result.status >= 500) continue;
      if (result.status >= 200 && result.status < 300) {
        rows(result.payload).forEach((brief) => {
          const id = String(brief.id || "");
          if (id) briefById.set(id, brief);
        });
      }
    }
  }

  if (!briefById.size) {
    return { matches: [], totalCount: 0, hasMore: false, warnings: [], parsed };
  }
  const ids = [...briefById.keys()].slice((page - 1) * pageSize, page * pageSize);
  const details = await Promise.all(ids.map(async (id) => {
    const detail = await fetchUpstream(`${tcgdexUrl}/ja/cards/${encodeURIComponent(id)}`);
    return detail.status >= 200 && detail.status < 300 ? record(detail.payload) as TcgDexDetail : undefined;
  }));
  const matches = details
    .filter((detail): detail is TcgDexDetail => Boolean(detail?.id && detail?.name))
    .map((detail) => tcgdexMatch(detail, input, aliasLookup))
    .filter((match) => match.searchConfidence !== "unreliable")
    .sort((left, right) => right.matchScore - left.matchScore);
  const warnings = aliasLookup
    ? ["English was used only as a search aid. Confirm the exact Japanese name, number, set, and image; no English pricing was reused."]
    : [];
  return {
    matches,
    totalCount: briefById.size,
    hasMore: page * pageSize < briefById.size,
    warnings,
    parsed,
  };
}

type OptcgCard = JsonRecord & {
  inventory_price?: number;
  market_price?: number;
  card_name?: string;
  set_name?: string;
  set_id?: string;
  rarity?: string;
  card_set_id?: string;
  card_type?: string;
  card_color?: string;
  color?: string;
  sub_types?: string;
  date_scraped?: string;
  card_image_id?: string;
  card_image?: string;
};

function optcgRankable(card: OptcgCard): RankableOnePieceCard {
  return {
    providerCardId: String(card.card_image_id || card.card_set_id || ""),
    name: String(card.card_name || ""),
    cardCode: normalizeOnePieceCardCode(String(card.card_set_id || "")),
    collectorNumber: normalizeOnePieceCardCode(String(card.card_set_id || "")),
    setId: String(card.set_id || "") || undefined,
    setName: String(card.set_name || "") || undefined,
    rarity: String(card.rarity || "") || undefined,
    character: String(card.sub_types || "") || undefined,
    cardType: [card.card_color || card.color, card.card_type].filter(Boolean).join(" · ") || undefined,
  };
}

function optcgMatch(card: OptcgCard, ranked: ReturnType<typeof rankOnePieceCards>[number]): UnifiedCardMatch {
  const market = number(card.market_price);
  const low = number(card.inventory_price);
  const variantName = /(?:parallel|alternate|manga)/i.test(String(card.card_name || card.card_image_id || ""))
    ? "Alternate printing"
    : "Standard printing";
  return {
    game: "one_piece",
    language: "en",
    provider: "optcgapi",
    providerCardId: ranked.providerCardId,
    name: ranked.name,
    cardCode: ranked.cardCode,
    collectorNumber: ranked.cardCode,
    setId: ranked.setId,
    setName: ranked.setName,
    setCode: ranked.setId,
    rarity: ranked.rarity,
    imageSmall: String(card.card_image || "") || undefined,
    imageLarge: String(card.card_image || "") || undefined,
    pricing: market != null || low != null ? {
      currency: "USD",
      market,
      low,
      updatedAt: String(card.date_scraped || "") || undefined,
      source: "OPTCG API",
      variants: [{ name: variantName, market, low }],
    } : undefined,
    supertype: ranked.cardType,
    subtypes: ranked.character ? [ranked.character] : undefined,
    matchScore: ranked.matchScore,
    reasons: ranked.reasons,
    searchConfidence: ranked.confidence,
    matchConfidence: ranked.matchConfidence,
  };
}

async function optcgCatalog() {
  const endpoints = [`${optcgUrl}/allSetCards/`, `${optcgUrl}/allSTCards/`];
  const results = await Promise.all(endpoints.map((endpoint) => fetchUpstream(endpoint, { cacheMs: 30 * 60_000, timeoutMs: 15_000 })));
  return results.flatMap((result) => result.status >= 200 && result.status < 300 ? rows(result.payload) as OptcgCard[] : []);
}

async function searchOnePiece(input: SearchRequest, page: number, pageSize: number) {
  const rawQuery = String(input.query || [input.name, input.collectorNumber].filter(Boolean).join(" ")).trim();
  const cardCode = extractOnePieceCardCode(input.collectorNumber || rawQuery);
  const searchName = String(input.name || onePieceSearchName(rawQuery) || input.cardType || "").trim();
  if (!cardCode && searchName.replace(/[^\p{L}\p{N}]/gu, "").length < 2 && !input.set) {
    return { error: structuredError("INVALID_QUERY_FORMAT", "Enter a One Piece card name, code, set, character, or rarity.", 400) };
  }
  const found = new Map<string, OptcgCard>();
  const add = (value: unknown) => rows(value).forEach((row) => {
    const card = row as OptcgCard;
    const key = String(card.card_image_id || `${card.card_set_id || ""}:${card.card_name || ""}`);
    if (key) found.set(key, card);
  });

  if (cardCode) {
    const encoded = encodeURIComponent(cardCode);
    const exactEndpoints = cardCode.startsWith("ST")
      ? [`${optcgUrl}/decks/card/${encoded}/`, `${optcgUrl}/sets/card/${encoded}/`]
      : [`${optcgUrl}/sets/card/${encoded}/`, `${optcgUrl}/decks/card/${encoded}/`];
    const exact = await Promise.all(exactEndpoints.map((endpoint) => fetchUpstream(endpoint)));
    exact.forEach((result) => {
      if (result.status >= 200 && result.status < 300) add(result.payload);
    });
  }
  if (searchName) {
    const params = new URLSearchParams({ card_name: searchName });
    const filtered = await Promise.all([
      fetchUpstream(`${optcgUrl}/sets/filtered/?${params}`),
      fetchUpstream(`${optcgUrl}/decks/filtered/?${params}`),
    ]);
    filtered.forEach((result) => {
      if (result.status >= 200 && result.status < 300) add(result.payload);
    });
  }

  const rankInput = { ...input, query: rawQuery || searchName };
  let ranked = rankOnePieceCards([...found.values()].map(optcgRankable), rankInput);
  if (!ranked.some((item) => item.confidence !== "unreliable")) {
    const catalog = await optcgCatalog();
    catalog.forEach((card) => {
      const key = String(card.card_image_id || `${card.card_set_id || ""}:${card.card_name || ""}`);
      if (key) found.set(key, card);
    });
    ranked = rankOnePieceCards([...found.values()].map(optcgRankable), rankInput);
  }
  const reliable = ranked.filter((item) => item.confidence !== "unreliable");
  const visible = reliable.slice((page - 1) * pageSize, page * pageSize);
  const cardsById = new Map([...found.values()].map((card) => [String(card.card_image_id || card.card_set_id || ""), card]));
  return {
    matches: visible.map((item) => optcgMatch(cardsById.get(item.providerCardId) || {}, item)),
    totalCount: reliable.length,
    hasMore: page * pageSize < reliable.length,
    warnings: [],
    parsed: {
      rawQuery,
      normalizedQuery: normalizeCardSearchText(rawQuery),
      originalName: searchName,
      name: searchName,
      normalizedName: normalizeCardSearchText(searchName),
      collector: cardCode ? { original: cardCode, normalized: cardCode, numerator: cardCode, variants: [cardCode] } : null,
      set: String(input.set || ""),
      language: "English",
      finish: "",
      cardType: "",
      suffix: "",
      baseName: searchName,
      numberOnly: Boolean(cardCode && !searchName),
    },
  };
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const respond = (response: Response) => withRequestId(response, requestId);
  if (request.method === "OPTIONS") return respond(new Response(null, { status: 204, headers: corsHeaders }));
  if (request.method !== "POST") return respond(structuredError("METHOD_NOT_ALLOWED", "Method not allowed.", 405));
  let input: SearchRequest;
  let receivedKeys: string[] = [];
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return respond(structuredError("INVALID_REQUEST", "The request body must be a JSON object.", 400));
    }
    const recordBody = body as JsonRecord;
    receivedKeys = Object.keys(recordBody).sort();
    input = parseCompatibleCardSearchRequest(recordBody);
  } catch {
    return respond(structuredError("INVALID_JSON", "A valid JSON request body is required.", 400));
  }
  if (!["pokemon", "one_piece"].includes(String(input.game || ""))) {
    return respond(structuredError("INVALID_GAME", "game must be pokemon or one_piece.", 400));
  }
  if (!["en", "ja"].includes(String(input.language || ""))) {
    return respond(structuredError("INVALID_LANGUAGE", "language must be en or ja.", 400));
  }
  const game = normalizeCardGame(input.game);
  const language = normalizeCardLanguage(input.language, game);
  const parsed = parseCardSearchQuery(input);
  const page = Math.min(100, Math.max(1, Math.floor(Number(input.page) || 1)));
  const pageSize = Math.min(30, Math.max(1, Math.floor(Number(input.pageSize) || 30)));
  const provider = game === "one_piece" ? "optcgapi" : language === "ja" ? "tcgdex" : "pokemontcg";
  const queryPresent = Boolean(
    input.query.trim()
    || input.name?.trim()
    || input.collectorNumber?.trim()
    || input.set?.trim()
    || input.abilityName?.trim()
    || input.attackName?.trim()
    || input.providerCardId?.trim()
    || input.id?.trim()
  );
  const initialProviderQuery = provider === "pokemontcg"
    ? input.abilityName
      ? `abilities.name:\"${escapePokemonLuceneValue(input.abilityName)}\"`
      : input.attackName
        ? `attacks.name:\"${escapePokemonLuceneValue(input.attackName)}\"`
        : buildPokemonApiQueries(parsed)[0]?.query || ""
    : parsed.normalizedQuery;
  const requestDebug = {
    receivedKeys,
    queryPresent,
    normalizedQuery: parsed.normalizedQuery,
    providerQuery: initialProviderQuery,
  };
  if (!queryPresent) {
    return respond(await withDebugFields(
      structuredError("INVALID_QUERY", "Invalid or empty PokÃ©mon card query.", 400),
      { ...requestDebug, upstreamReached: false, providerHttpStatus: null, resultCount: 0 },
    ));
  }
  edgeDebug("request", {
    requestId,
    selectedGame: game,
    selectedLanguage: language,
    rawInput: input.query || "",
    normalizedInput: parsed.normalizedQuery,
    parsedCardName: parsed.name || null,
    parsedCollectorNumber: parsed.collector?.normalized || null,
    selectedProvider: provider,
    edgeFunctionName: "pokemon-card-search",
  });

  try {
    const result = game === "one_piece"
      ? await searchOnePiece(input, page, pageSize)
      : language === "ja"
        ? await searchJapanesePokemon(input, page, pageSize)
        : await searchEnglishPokemon(input, page, pageSize);
    const normalizedResult = result as {
      error?: Response;
      matches?: UnifiedCardMatch[];
      totalCount?: number;
      hasMore?: boolean;
      warnings?: string[];
      parsed?: ReturnType<typeof parseCardSearchQuery>;
      query?: string;
      upstreamReached?: boolean;
      providerResponseStatus?: number;
    };
    if (normalizedResult.error) {
      return respond(await withDebugFields(normalizedResult.error, {
        ...requestDebug,
        upstreamReached: normalizedResult.upstreamReached ?? false,
        providerHttpStatus: normalizedResult.providerResponseStatus ?? null,
        resultCount: 0,
      }));
    }
    const resultCount = normalizedResult.matches?.length || 0;
    const providerQuery = normalizedResult.query || initialProviderQuery;
    return respond(json({
      success: true,
      provider,
      query: normalizedResult.query || parsed.normalizedQuery,
      results: normalizedResult.matches || [],
      page,
      pageSize,
      count: resultCount,
      totalCount: normalizedResult.totalCount || 0,
      hasMore: Boolean(normalizedResult.hasMore),
      warnings: normalizedResult.warnings || [],
      parsed: normalizedResult.parsed,
      requestId,
      edgeFunctionReached: true,
      upstreamReached: normalizedResult.upstreamReached ?? true,
      providerResponseStatus: normalizedResult.providerResponseStatus ?? 200,
      ...debugFields({
        ...requestDebug,
        normalizedQuery: parsed.normalizedQuery,
        providerQuery,
        providerHttpStatus: normalizedResult.providerResponseStatus ?? 200,
        resultCount,
      }),
    }, 200, { "Cache-Control": "public, max-age=120" }));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      edgeDebug("timeout", { requestId, provider, timeout: true });
      const providerLabel = game === "one_piece" ? "OPTCG API" : language === "ja" ? "TCGdex" : "Pokémon TCG API";
      return respond(structuredError("UPSTREAM_TIMEOUT", `${providerLabel} took too long to respond.`, 504, undefined, { upstreamReached: true }));
    }
    console.error("unified-card-search", {
      game,
      language,
      kind: error instanceof Error ? error.name : "unknown",
    });
    const providerLabel = game === "one_piece" ? "OPTCG API" : language === "ja" ? "TCGdex" : "Pokémon TCG API";
    return respond(structuredError("UPSTREAM_CONNECTION_FAILED", `${providerLabel} could not be reached. Other card providers were not affected.`, 502, undefined, { upstreamReached: true }));
  }
});
