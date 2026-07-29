import {
  buildPokemonApiQueries,
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
import { CARD_SEARCH_FUNCTION_NAME } from "./cardSearchContract";
export { CARD_SEARCH_FUNCTION_NAME } from "./cardSearchContract";

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
export type CanonicalCardSearchRequest = {
  game: Exclude<CardGame, "other">;
  language: Exclude<CardLanguage, "unknown">;
  query: string;
  name: string | null;
  collectorNumber: string | null;
  set: string | null;
  page: number;
  pageSize: number;
  finish?: string;
  cardType?: string;
  disableCorrection?: boolean;
  providerCardId?: string;
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
  query?: string;
};

type UnifiedApiPayload = {
  success?: boolean;
  results?: UnifiedCardMatch[];
  data?: UnifiedCardMatch[] | UnifiedCardMatch;
  page?: number;
  pageSize?: number;
  count?: number;
  totalCount?: number;
  hasMore?: boolean;
  warnings?: string[];
  parsed?: ParsedCardSearchQuery;
  provider?: CardDataProvider;
  query?: string;
  code?: string;
  message?: string;
  error?: string;
  requestId?: string;
  edgeFunctionReached?: boolean;
  upstreamReached?: boolean;
  providerResponseStatus?: number;
};

export type PokemonCardSearchErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_QUERY"
  | "AUTH_CONFIGURATION"
  | "FUNCTION_NOT_DEPLOYED"
  | "RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "MALFORMED_RESPONSE";

export type CardSearchDiagnostics = {
  provider: CardDataProvider;
  httpStatus?: number;
  providerResponseStatus?: number;
  edgeFunctionName: string;
  edgeFunctionReached: boolean;
  upstreamReached: boolean;
  timeout: boolean;
  cancelled: boolean;
  requestId?: string;
  errorCode: PokemonCardSearchErrorCode | string;
  providerErrorCode?: string;
  providerMessage?: string;
};

export class PokemonCardSearchError extends Error {
  code: PokemonCardSearchErrorCode;
  retryAfterSeconds?: number;
  diagnostics: CardSearchDiagnostics;

  constructor(
    message: string,
    code: PokemonCardSearchErrorCode,
    diagnostics: Omit<CardSearchDiagnostics, "errorCode">,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "PokemonCardSearchError";
    this.code = code;
    this.diagnostics = { ...diagnostics, errorCode: code };
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function cardSearchDeveloperDebug(error: unknown) {
  if (!(error instanceof PokemonCardSearchError)) return undefined;
  return JSON.stringify({
    provider: error.diagnostics.provider,
    httpStatus: error.diagnostics.httpStatus ?? null,
    providerResponseStatus: error.diagnostics.providerResponseStatus ?? null,
    errorCode: error.code,
    providerErrorCode: error.diagnostics.providerErrorCode ?? null,
    edgeFunctionName: error.diagnostics.edgeFunctionName,
    edgeFunctionReached: error.diagnostics.edgeFunctionReached,
    upstreamReached: error.diagnostics.upstreamReached,
    timeout: error.diagnostics.timeout,
    cancelled: error.diagnostics.cancelled,
    retryAfterSeconds: error.retryAfterSeconds ?? null,
    requestId: error.diagnostics.requestId ?? null,
    providerMessage: error.diagnostics.providerMessage ?? null,
  }, null, 2);
}

const memoryCache = new Map<string, { expiresAt: number; value: ManualCardSearchPage }>();
const inFlight = new Map<string, Promise<ManualCardSearchPage>>();
const sessionPrefix = "4nerds_unified_card_search_v2:";
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

function devSearchLog(event: string, details: Record<string, unknown>) {
  if (import.meta.env.DEV) console.info("[smart-card-search]", { event, ...details });
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) {
    devSearchLog("request cancellation", { cancelled: true });
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      devSearchLog("request cancellation", { cancelled: true });
      reject(abortError());
    };
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

export function buildCanonicalCardSearchRequest(input: ManualCardSearchInput): CanonicalCardSearchRequest {
  const game = normalizeCardGame(input.game);
  const canonicalGame = game === "one_piece" ? "one_piece" : "pokemon";
  const language = normalizeCardLanguage(input.language, canonicalGame);
  const canonicalLanguage = language === "ja" ? "ja" : "en";
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.min(30, Math.max(1, Math.floor(input.pageSize || 30)));
  const query = String(input.query || [input.name, input.collectorNumber].filter(Boolean).join(" ")).trim();
  const parsed = parseCardSearchQuery({ ...input, query });
  return {
    game: canonicalGame,
    language: canonicalLanguage,
    query,
    name: input.name || parsed.originalName || null,
    collectorNumber: input.collectorNumber || parsed.collector?.normalized || null,
    set: input.set || null,
    page,
    pageSize,
    ...(canonicalGame === "pokemon" && canonicalLanguage === "en" && input.finish ? { finish: input.finish } : {}),
    ...(input.cardType ? { cardType: input.cardType } : {}),
    ...(input.disableCorrection ? { disableCorrection: true } : {}),
    ...(input.providerCardId ? { providerCardId: input.providerCardId } : {}),
  };
}

function providerCodeFor(input: ManualCardSearchInput): CardDataProvider {
  const game = normalizeCardGame(input.game);
  const language = normalizeCardLanguage(input.language, game);
  return game === "one_piece" ? "optcgapi" : language === "ja" ? "tcgdex" : "pokemontcg";
}

function providerFor(input: ManualCardSearchInput) {
  return cardProviderLabel(providerCodeFor(input));
}

function baseDiagnostics(input: ManualCardSearchInput): Omit<CardSearchDiagnostics, "errorCode"> {
  return {
    provider: providerCodeFor(input),
    edgeFunctionName: CARD_SEARCH_FUNCTION_NAME,
    edgeFunctionReached: false,
    upstreamReached: false,
    timeout: false,
    cancelled: false,
  };
}

function friendlyError(
  status: number,
  payload: UnifiedApiPayload,
  retryAfter: string | null,
  input: ManualCardSearchInput,
) {
  const retrySeconds = Math.max(0, Number(retryAfter || 0)) || undefined;
  const provider = providerFor(input);
  const providerMessage = payload.message || payload.error;
  const diagnostics = {
    ...baseDiagnostics(input),
    httpStatus: status,
    providerResponseStatus: payload.providerResponseStatus,
    edgeFunctionReached: payload.edgeFunctionReached ?? status !== 404,
    upstreamReached: payload.upstreamReached ?? false,
    requestId: payload.requestId,
    providerMessage,
    providerErrorCode: payload.code,
  };
  if (status === 429) {
    return new PokemonCardSearchError(
      retrySeconds ? `${provider} is busy. Retry in about ${retrySeconds} seconds.` : `${provider} rate limit was reached. Wait a moment, then retry.`,
      "RATE_LIMITED",
      diagnostics,
      retrySeconds,
    );
  }
  if (status === 400) return new PokemonCardSearchError(
    providerMessage || "Search request was rejected because the generated query was invalid.",
    "INVALID_QUERY",
    diagnostics,
  );
  if (status === 401 || status === 403) return new PokemonCardSearchError(
    providerMessage || `${provider} authentication or server configuration is unavailable.`,
    "AUTH_CONFIGURATION",
    diagnostics,
  );
  if (status === 404) return new PokemonCardSearchError(
    `${provider} search function is not deployed.`,
    "FUNCTION_NOT_DEPLOYED",
    diagnostics,
  );
  if (status === 504) return new PokemonCardSearchError(
    providerMessage || `${provider} took too long to respond.`,
    "UPSTREAM_TIMEOUT",
    { ...diagnostics, timeout: true },
  );
  if (status >= 500) return new PokemonCardSearchError(
    providerMessage || `${provider} search temporarily failed. HTTP ${status}.`,
    "UPSTREAM_UNAVAILABLE",
    diagnostics,
  );
  return new PokemonCardSearchError(
    providerMessage || `Card search failed (HTTP ${status}).`,
    "NETWORK_ERROR",
    diagnostics,
  );
}

async function invokeSearch(request: ManualCardSearchInput): Promise<UnifiedApiPayload> {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) {
    throw new PokemonCardSearchError(
      "Card search needs the app's Supabase connection. Manual transaction fields remain available.",
      "NOT_CONFIGURED",
      baseDiagnostics(request),
    );
  }
  const parsed = parseCardSearchQuery(request);
  devSearchLog("request", {
    selectedGame: normalizeCardGame(request.game),
    selectedLanguage: normalizeCardLanguage(request.language, normalizeCardGame(request.game)),
    rawInput: request.query,
    normalizedInput: parsed.normalizedQuery,
    parsedCardName: parsed.name || null,
    parsedCollectorNumber: parsed.collector?.normalized || null,
    generatedApiQueries: providerCodeFor(request) === "pokemontcg"
      ? buildPokemonApiQueries(parsed).map((candidate) => candidate.query)
      : [],
    selectedProvider: providerCodeFor(request),
    edgeFunctionName: CARD_SEARCH_FUNCTION_NAME,
  });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 18_000);
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${CARD_SEARCH_FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as UnifiedApiPayload | null;
    devSearchLog("response", {
      selectedProvider: providerCodeFor(request),
      edgeFunctionName: CARD_SEARCH_FUNCTION_NAME,
      httpStatus: response.status,
      providerResponseStatus: payload?.providerResponseStatus,
      resultCount: payload?.count ?? payload?.results?.length ?? 0,
      normalizationFailure: response.ok && !Array.isArray(payload?.results) && !Array.isArray(payload?.data),
      requestId: payload?.requestId || response.headers.get("x-request-id"),
    });
    if (!response.ok) throw friendlyError(
      response.status,
      {
        ...(payload || {}),
        requestId: payload?.requestId || response.headers.get("x-request-id") || undefined,
      },
      response.headers.get("Retry-After"),
      request,
    );
    if (!payload || (!Array.isArray(payload.results) && !Array.isArray(payload.data) && !(payload.data && typeof payload.data === "object"))) {
      throw new PokemonCardSearchError(
        "The selected card provider returned an unreadable response.",
        "MALFORMED_RESPONSE",
        {
          ...baseDiagnostics(request),
          httpStatus: response.status,
          edgeFunctionReached: true,
          upstreamReached: Boolean(payload?.upstreamReached),
          providerResponseStatus: payload?.providerResponseStatus,
          requestId: payload?.requestId || response.headers.get("x-request-id") || undefined,
        },
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof PokemonCardSearchError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      devSearchLog("timeout", { selectedProvider: providerCodeFor(request), timeout: true });
      throw new PokemonCardSearchError(
        `${providerFor(request)} took too long to respond. Retry when ready.`,
        "UPSTREAM_TIMEOUT",
        { ...baseDiagnostics(request), timeout: true },
      );
    }
    throw new PokemonCardSearchError(
      error instanceof Error ? `Could not reach ${providerFor(request)}: ${error.message}` : `Could not reach ${providerFor(request)}.`,
      "NETWORK_ERROR",
      baseDiagnostics(request),
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
  const request = buildCanonicalCardSearchRequest(input);
  const page = request.page;
  const pageSize = request.pageSize;
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
    const canonicalResults = payload.results
      || (Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : []);
    const matches = canonicalResults
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
      query: payload.query,
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
  const card = payload.results?.[0] || (Array.isArray(payload.data) ? payload.data[0] : payload.data);
  return card || undefined;
}
