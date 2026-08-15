import {
  normalizeCardSearchText,
} from "../../../supabase/functions/_shared/pokemonCardSearchCore.ts";
import {
  filterBulkReviewCandidatesLocally,
  normalizeBulkReviewSearchIntent,
  rankBulkReviewCandidatesLocally,
  type BulkReviewSearchSource,
} from "../../utils/bulkReviewSearch.ts";
import type { CardMatch } from "./cardScanService";
import { searchPokemonCardsManually } from "./pokemonCardSearchService";
export { normalizeBulkReviewSearchIntent, rankBulkReviewCandidatesLocally } from "../../utils/bulkReviewSearch.ts";
export type { BulkReviewSearchSource } from "../../utils/bulkReviewSearch.ts";

export type BulkReviewSearchStage = "cached" | "finding" | "found" | "ranking" | "ready";
export type BulkReviewSearchProgress = {
  stage: BulkReviewSearchStage;
  label: string;
  matches: CardMatch[];
  queryCount: number;
  cacheHit: boolean;
};

export type BulkReviewSearchResult = {
  matches: CardMatch[];
  cacheHit: boolean;
  normalizedName: string;
  baseName: string;
  cardClass: string;
  queriesAttempted: Array<{ label: string; query: string; resultCount: number }>;
  timings: {
    searchStartedMs: number;
    firstResponseMs?: number;
    firstCandidateMs?: number;
    rankingCompletedMs: number;
  };
};

type SearchOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: BulkReviewSearchProgress) => void;
};

type CacheValue = { expiresAt: number; result: BulkReviewSearchResult };
const reviewCache = new Map<string, CacheValue>();
const reviewInFlight = new Map<string, Promise<BulkReviewSearchResult>>();
const persistentPrefix = "4nerds_bulk_review_search_v1:";
const cacheTtlMs = 3 * 60_000;
const maxCachedSearches = 60;
const prefetchQueue: BulkReviewSearchSource[] = [];
const queuedPrefetchKeys = new Set<string>();
const debugSearchStartedAt = new Map<string, number>();
let activePrefetches = 0;
const maxPrefetchConcurrency = 2;

const elapsed = (startedAt: number) => Math.round((performance.now() - startedAt) * 10) / 10;

function readPersistentCache(key: string) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(`${persistentPrefix}${key}`) || "null") as CacheValue | null;
    if (cached && cached.expiresAt > Date.now()) return cached;
    if (cached) sessionStorage.removeItem(`${persistentPrefix}${key}`);
  } catch {
    // Memory cache remains available when browser storage is unavailable.
  }
  return undefined;
}

function writeCache(key: string, result: BulkReviewSearchResult) {
  const value = { expiresAt: Date.now() + cacheTtlMs, result };
  if (reviewCache.size >= maxCachedSearches) reviewCache.delete(reviewCache.keys().next().value as string);
  reviewCache.set(key, value);
  try { sessionStorage.setItem(`${persistentPrefix}${key}`, JSON.stringify(value)); } catch { /* Ignore quota/privacy failures. */ }
}

function currentCache(key: string) {
  const memory = reviewCache.get(key);
  if (memory && memory.expiresAt > Date.now()) return memory;
  if (memory) reviewCache.delete(key);
  const persistent = readPersistentCache(key);
  if (persistent) reviewCache.set(key, persistent);
  return persistent;
}

function dedupe(matches: CardMatch[]) {
  const unique = new Map<string, CardMatch>();
  for (const match of matches) unique.set(`${match.provider}:${match.providerCardId}`, match);
  return [...unique.values()];
}

function abortError() {
  return new DOMException("Bulk review search cancelled.", "AbortError");
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

export function getCachedBulkReviewCandidates(source: BulkReviewSearchSource) {
  const intent = normalizeBulkReviewSearchIntent(source);
  const cached = currentCache(intent.cacheKey)?.result.matches || [];
  return rankBulkReviewCandidatesLocally(cached, source);
}

export function searchBulkReviewCandidates(source: BulkReviewSearchSource, options: SearchOptions = {}) {
  const intent = normalizeBulkReviewSearchIntent(source);
  if (import.meta.env.DEV && !debugSearchStartedAt.has(source.id)) debugSearchStartedAt.set(source.id, performance.now());
  if (!intent.normalizedName) return Promise.resolve<BulkReviewSearchResult>({
    matches: [], cacheHit: false, normalizedName: "", baseName: "", cardClass: "", queriesAttempted: [],
    timings: { searchStartedMs: 0, rankingCompletedMs: 0 },
  });
  const cached = currentCache(intent.cacheKey);
  if (cached) {
    const reranked = rankBulkReviewCandidatesLocally(cached.result.matches, source);
    const result = { ...cached.result, matches: reranked, cacheHit: true };
    options.onProgress?.({ stage: "cached", label: `${reranked.length} cached matches ready`, matches: reranked, queryCount: cached.result.queriesAttempted.length, cacheHit: true });
    return waitForCaller(Promise.resolve(result), options.signal);
  }
  const active = reviewInFlight.get(intent.cacheKey);
  if (active) return waitForCaller(active, options.signal);

  const promise = (async () => {
    const startedAt = performance.now();
    const queriesAttempted: BulkReviewSearchResult["queriesAttempted"] = [];
    const seeded = dedupe([source.selectedCandidate, ...(source.alternativeCandidates || [])].filter((match): match is CardMatch => Boolean(match)));
    if (seeded.length) options.onProgress?.({ stage: "cached", label: `${seeded.length} stored matches ready`, matches: seeded, queryCount: 0, cacheHit: true });
    options.onProgress?.({ stage: "finding", label: `Finding ${intent.normalizedName} cards…`, matches: seeded, queryCount: 0, cacheHit: false });
    const accumulated = new Map(seeded.map((match) => [`${match.provider}:${match.providerCardId}`, match]));
    let firstResponseMs: number | undefined;
    let firstCandidateMs: number | undefined = seeded.length ? 0 : undefined;

    const attempt = async (label: string, name: string, pageSize: number) => {
      if (options.signal?.aborted) throw abortError();
      const response = await searchPokemonCardsManually({
        game: intent.game,
        language: intent.language,
        name,
        query: name,
        page: 1,
        pageSize,
        disableCorrection: false,
      }, options.signal);
      firstResponseMs ??= elapsed(startedAt);
      queriesAttempted.push({ label, query: name, resultCount: response.matches.length });
      for (const match of filterBulkReviewCandidatesLocally(response.matches, source)) accumulated.set(`${match.provider}:${match.providerCardId}`, match);
      const preliminary = [...accumulated.values()];
      if (preliminary.length) firstCandidateMs ??= elapsed(startedAt);
      options.onProgress?.({ stage: "found", label: `${preliminary.length} matches found`, matches: preliminary, queryCount: queriesAttempted.length, cacheHit: false });
      return preliminary;
    };

    let preliminary = await attempt("normalized exact/card-class", intent.correction || intent.normalizedName, 10);
    if (preliminary.length < 5 && normalizeCardSearchText(intent.baseName) !== normalizeCardSearchText(intent.normalizedName)) {
      preliminary = await attempt("base-name fallback", intent.baseName, 20);
    }
    if (!preliminary.length && normalizeCardSearchText(intent.baseName).length >= 5) {
      const prefix = intent.baseName.slice(0, Math.max(4, intent.baseName.length - 2));
      preliminary = await attempt("bounded fuzzy prefix", prefix, 20);
    }

    options.onProgress?.({ stage: "ranking", label: "Checking attacks, abilities, HP, set, and number…", matches: preliminary, queryCount: queriesAttempted.length, cacheHit: false });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    const ranked = rankBulkReviewCandidatesLocally(preliminary, source).slice(0, 20);
    const result: BulkReviewSearchResult = {
      matches: ranked,
      cacheHit: false,
      normalizedName: intent.normalizedName,
      baseName: intent.baseName,
      cardClass: intent.cardClass,
      queriesAttempted,
      timings: {
        searchStartedMs: 0,
        firstResponseMs,
        firstCandidateMs,
        rankingCompletedMs: elapsed(startedAt),
      },
    };
    if (ranked.length) writeCache(intent.cacheKey, result);
    options.onProgress?.({ stage: "ready", label: ranked.length ? "Best matches ready" : "No strong same-name matches found", matches: ranked, queryCount: queriesAttempted.length, cacheHit: false });
    if (import.meta.env.DEV) console.info("[Bulk Import Review] provider timing", {
      bulkImportItemId: source.id,
      recognizedRawName: intent.rawName,
      normalizedName: intent.normalizedName,
      basePokemonName: intent.baseName,
      detectedCardClass: intent.cardClass || null,
      queriesAttempted,
      recognitionFinishedMs: 0,
      providerSearchStartedMs: 0,
      firstApiResponseMs: firstResponseMs ?? null,
      firstCandidateRenderedMs: firstCandidateMs ?? null,
      attackRankingCompletedMs: result.timings.rankingCompletedMs,
      marketPriceRenderedMs: ranked.some((match) => match.pricing?.market != null || match.pricing?.variants?.some((variant) => variant.market != null)) ? result.timings.rankingCompletedMs : null,
    });
    return result;
  })().finally(() => reviewInFlight.delete(intent.cacheKey));
  reviewInFlight.set(intent.cacheKey, promise);
  return waitForCaller(promise, options.signal);
}

export function recordBulkReviewImageLoaded(sourceId: string, providerCardId?: string) {
  if (!import.meta.env.DEV) return;
  const startedAt = debugSearchStartedAt.get(sourceId);
  console.info("[Bulk Import Review] provider image loaded", {
    bulkImportItemId: sourceId,
    providerCardId: providerCardId || null,
    imagesLoadedMs: startedAt == null ? null : Math.round((performance.now() - startedAt) * 10) / 10,
  });
}

function pumpPrefetchQueue() {
  while (activePrefetches < maxPrefetchConcurrency && prefetchQueue.length) {
    const source = prefetchQueue.shift()!;
    const key = normalizeBulkReviewSearchIntent(source).cacheKey;
    activePrefetches += 1;
    void searchBulkReviewCandidates(source).catch(() => undefined).finally(() => {
      activePrefetches -= 1;
      queuedPrefetchKeys.delete(key);
      pumpPrefetchQueue();
    });
  }
}

export function prefetchBulkReviewCandidates(sources: BulkReviewSearchSource[]) {
  for (const source of sources) {
    const intent = normalizeBulkReviewSearchIntent(source);
    if (!intent.cacheKey || currentCache(intent.cacheKey) || reviewInFlight.has(intent.cacheKey) || queuedPrefetchKeys.has(intent.cacheKey)) continue;
    queuedPrefetchKeys.add(intent.cacheKey);
    prefetchQueue.push(source);
  }
  pumpPrefetchQueue();
}

export function bulkReviewSearchCacheInfo() {
  return { cachedSearches: reviewCache.size, inFlightSearches: reviewInFlight.size, queuedPrefetches: prefetchQueue.length, activePrefetches };
}
