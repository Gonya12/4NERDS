import {
  normalizeCardSearchText,
  normalizeManualCardSearchTerms,
  parseCardSearchQuery,
  type ParsedCardSearchQuery,
} from "../../../supabase/functions/_shared/pokemonCardSearchCore.ts";
import {
  normalizeCardGame,
  normalizeCardLanguage,
  type CardDataProvider,
  type CardGame,
  type CardLanguage,
  type UnifiedCardMatch,
  type UnifiedCardResult,
  type UnifiedCardSearchInput,
} from "../../../supabase/functions/_shared/unifiedCardSearchCore.ts";
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from "../../utils/supabase";

export type ScanConfidence = "high" | "medium" | "low";
export type TcgplayerPriceVariant = {
  variant: string;
  market?: number;
  low?: number;
  mid?: number;
  high?: number;
  directLow?: number;
};
export type TcgplayerPricing = {
  url?: string;
  updatedAt?: string;
  checkedAt: string;
  currency?: string;
  source?: string;
  variants: TcgplayerPriceVariant[];
  selectedVariant?: string;
  targetPercent?: number;
};

export type CardMatch = UnifiedCardMatch;
export type ManualCardSearchInput = UnifiedCardSearchInput & {
  page?: number;
  pageSize?: number;
};
export type ManualCardSearchPage = {
  matches: CardMatch[];
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;
  normalizedTerms: ReturnType<typeof normalizeManualCardSearchTerms>;
  parsed: ParsedCardSearchQuery;
  warnings: string[];
  provider?: CardDataProvider;
};

type UnifiedApiPayload = {
  data?: UnifiedCardMatch[] | UnifiedCardMatch;
  page?: number;
  pageSize?: number;
  count?: number;
  totalCount?: number;
  hasMore?: boolean;
  warnings?: string[];
  parsed?: ParsedCardSearchQuery;
  provider?: CardDataProvider;
};

export type PokemonCardSearchErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_QUERY"
  | "RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "MALFORMED_RESPONSE";

export class PokemonCardSearchError extends Error {
  code: PokemonCardSearchErrorCode;
  retryAfterSeconds?: number;

  constructor(message: string, code: PokemonCardSearchErrorCode, retryAfterSeconds?: number) {
    super(message);
    this.name = "PokemonCardSearchError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const memoryCache = new Map<string, { expiresAt: number; value: ManualCardSearchPage }>();
const inFlight = new Map<string, Promise<ManualCardSearchPage>>();
const sessionPrefix = "4nerds_unified_card_search_v1:";
const cacheTtlMs = 5 * 60_000;

export function cardProviderLabel(provider: CardDataProvider | undefined) {
  if (provider === "tcgdex") return "TCGdex";
  if (provider === "optcgapi") return "OPTCG API";
  if (provider === "manual") return "Manual";
  return "Pokémon TCG API";
}

export function pricingFromUnifiedCard(card: UnifiedCardResult): TcgplayerPricing {
  const variants = (card.pricing?.variants || []).map((variant) => ({
    variant: variant.name,
    market: variant.market,
    low: variant.low,
    mid: variant.mid,
    high: variant.high,
    directLow: variant.directLow,
  }));
  if (!variants.length && card.pricing && [
    card.pricing.market,
    card.pricing.low,
    card.pricing.mid,
    card.pricing.high,
  ].some((value) => value != null)) {
    variants.push({
      variant: card.game === "one_piece" ? "Provider price" : "Market",
      market: card.pricing.market,
      low: card.pricing.low,
      mid: card.pricing.mid,
      high: card.pricing.high,
      directLow: undefined,
    });
  }
  return {
    url: card.productUrl,
    updatedAt: card.pricing?.updatedAt,
    checkedAt: new Date().toISOString(),
    currency: card.pricing?.currency,
    source: card.pricing?.source,
    variants,
    selectedVariant: variants.length === 1 ? variants[0].variant : undefined,
    targetPercent: 75,
  };
}

function abortError() {
  return new DOMException("Card search cancelled.", "AbortError");
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function readSession(key: string) {
  try {
    const value = JSON.parse(sessionStorage.getItem(`${sessionPrefix}${key}`) || "null") as {
      expiresAt: number;
      value: ManualCardSearchPage;
    } | null;
    if (value && value.expiresAt > Date.now()) return value.value;
    if (value) sessionStorage.removeItem(`${sessionPrefix}${key}`);
  } catch {
    // Storage may be unavailable in privacy mode. Memory caching still works.
  }
  return undefined;
}

function writeCache(key: string, value: ManualCardSearchPage) {
  const cached = { expiresAt: Date.now() + cacheTtlMs, value };
  if (memoryCache.size >= 75) memoryCache.delete(memoryCache.keys().next().value as string);
  memoryCache.set(key, cached);
  try {
    sessionStorage.setItem(`${sessionPrefix}${key}`, JSON.stringify(cached));
  } catch {
    // Ignore storage quota/privacy failures.
  }
}

function providerFor(input: ManualCardSearchInput) {
  const game = normalizeCardGame(input.game);
  const language = normalizeCardLanguage(input.language, game);
  return game === "one_piece" ? "OPTCG API" : language === "ja" ? "TCGdex" : "Pokémon TCG API";
}

function friendlyError(
  status: number,
  payload: { code?: string; message?: string },
  retryAfter: string | null,
  input: ManualCardSearchInput,
) {
  const retrySeconds = Math.max(0, Number(retryAfter || 0)) || undefined;
  const provider = providerFor(input);
  if (status === 429) {
    return new PokemonCardSearchError(
      retrySeconds ? `${provider} is busy. Retry in about ${retrySeconds} seconds.` : `${provider} rate limit was reached. Wait a moment, then retry.`,
      "RATE_LIMITED",
      retrySeconds,
    );
  }
  if (status === 400) return new PokemonCardSearchError(payload.message || "Check the card search and try again.", "INVALID_QUERY");
  if (status === 504) return new PokemonCardSearchError(payload.message || `${provider} took too long to respond.`, "UPSTREAM_TIMEOUT");
  if (status >= 500) return new PokemonCardSearchError(payload.message || `${provider} is temporarily unavailable.`, "UPSTREAM_UNAVAILABLE");
  return new PokemonCardSearchError(payload.message || `Card search failed (${status}).`, "NETWORK_ERROR");
}

async function invokeSearch(request: ManualCardSearchInput): Promise<UnifiedApiPayload> {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) {
    throw new PokemonCardSearchError(
      "Card search needs the app's Supabase connection. Manual transaction fields remain available.",
      "NOT_CONFIGURED",
    );
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 18_000);
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/pokemon-card-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as (UnifiedApiPayload & { code?: string; message?: string }) | null;
    if (!response.ok) throw friendlyError(response.status, payload || {}, response.headers.get("Retry-After"), request);
    if (!payload || (!Array.isArray(payload.data) && !(payload.data && typeof payload.data === "object"))) {
      throw new PokemonCardSearchError("The selected card provider returned an unreadable response.", "MALFORMED_RESPONSE");
    }
    return payload;
  } catch (error) {
    if (error instanceof PokemonCardSearchError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new PokemonCardSearchError(`${providerFor(request)} took too long to respond. Retry when ready.`, "UPSTREAM_TIMEOUT");
    }
    throw new PokemonCardSearchError(
      error instanceof Error ? `Could not reach ${providerFor(request)}: ${error.message}` : `Could not reach ${providerFor(request)}.`,
      "NETWORK_ERROR",
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

export function searchPokemonCardsManually(input: ManualCardSearchInput, signal?: AbortSignal) {
  const game = normalizeCardGame(input.game);
  const language = normalizeCardLanguage(input.language, game);
  if (game === "other") {
    const parsed = parseCardSearchQuery(input);
    return Promise.resolve({
      matches: [],
      page: 1,
      pageSize: input.pageSize || 20,
      totalCount: 0,
      hasMore: false,
      normalizedTerms: normalizeManualCardSearchTerms(input),
      parsed,
      warnings: ["Other / Manual items keep editable fields and do not call a card provider."],
      provider: "manual" as const,
    });
  }
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.min(24, Math.max(1, Math.floor(input.pageSize || 20)));
  const request: ManualCardSearchInput = {
    game,
    language,
    query: input.query || [input.name, input.collectorNumber].filter(Boolean).join(" "),
    name: input.name,
    collectorNumber: input.collectorNumber,
    set: input.set,
    finish: game === "pokemon" && language === "en" ? input.finish : undefined,
    cardType: input.cardType,
    disableCorrection: input.disableCorrection,
    providerCardId: input.providerCardId,
    page,
    pageSize,
  };
  const cacheKey = JSON.stringify({
    game,
    language,
    query: normalizeCardSearchText(request.query),
    name: normalizeCardSearchText(request.name),
    number: normalizeCardSearchText(request.collectorNumber),
    set: normalizeCardSearchText(request.set),
    finish: normalizeCardSearchText(request.finish),
    cardType: normalizeCardSearchText(request.cardType),
    disableCorrection: Boolean(request.disableCorrection),
    providerCardId: request.providerCardId || "",
    page,
    pageSize,
  });
  const memory = memoryCache.get(cacheKey);
  if (memory && memory.expiresAt > Date.now()) return waitForCaller(Promise.resolve(memory.value), signal);
  const session = readSession(cacheKey);
  if (session) {
    memoryCache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, value: session });
    return waitForCaller(Promise.resolve(session), signal);
  }
  const existing = inFlight.get(cacheKey);
  if (existing) return waitForCaller(existing, signal);

  const promise = invokeSearch(request).then((payload) => {
    const matches = (Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [])
      .filter((match) => match.searchConfidence !== "unreliable");
    const result: ManualCardSearchPage = {
      matches,
      page: Number(payload.page || page),
      pageSize,
      totalCount: Number(payload.totalCount ?? matches.length),
      hasMore: Boolean(payload.hasMore ?? (page * pageSize < Number(payload.totalCount || 0))),
      normalizedTerms: normalizeManualCardSearchTerms(input),
      parsed: payload.parsed || parseCardSearchQuery(input),
      warnings: payload.warnings || [],
      provider: payload.provider,
    };
    writeCache(cacheKey, result);
    return result;
  }).finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, promise);
  return waitForCaller(promise, signal);
}

export async function searchPokemonCards(
  cardName: string | null,
  collectorNumber: string | null,
  signal?: AbortSignal,
  options: { game?: CardGame; language?: CardLanguage } = {},
) {
  if (!cardName && !collectorNumber) return [];
  const response = await searchPokemonCardsManually({
    game: options.game || "pokemon",
    language: options.language || "en",
    query: [cardName, collectorNumber].filter(Boolean).join(" "),
    page: 1,
    pageSize: 12,
  }, signal);
  return response.matches
    .filter((match) => match.searchConfidence === "exact" || match.searchConfidence === "likely")
    .slice(0, 5);
}

export async function fetchPokemonCardById(
  providerCardId: string,
  signal?: AbortSignal,
  options: { game?: CardGame; language?: CardLanguage } = {},
) {
  const promise = invokeSearch({
    game: options.game || "pokemon",
    language: options.language || "en",
    providerCardId,
    page: 1,
    pageSize: 1,
  });
  const payload = await waitForCaller(promise, signal);
  const card = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  return card || undefined;
}
