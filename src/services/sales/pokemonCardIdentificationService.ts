import {
  POKEMON_CARD_IDENTIFY_FUNCTION,
  buildPokemonIdentificationSearchAttempts,
  normalizePokemonCardIdentification,
  normalizePokemonTopRegionIdentification,
  rankScannerCandidates,
  scannerCandidateEvidence,
  scoreScannerCandidate,
  selectScannerCandidates,
  type IdentificationFieldConfidence,
  type IdentificationSearchAttempt,
  type PokemonCardIdentification,
  type PokemonTopRegionIdentification,
  type ScannerCandidateEvidence,
} from "../../../supabase/functions/_shared/pokemonCardIdentificationCore.ts";
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from "../../utils/supabase";
import { searchPokemonCardsManually, type CardMatch } from "./pokemonCardSearchService";

type IdentifyPayload = {
  success?: boolean;
  code?: string;
  message?: string;
  identification?: unknown;
  topIdentification?: unknown;
  rawProviderResponse?: unknown;
  requestId?: string;
  providerStatus?: number;
  upstreamErrorCode?: string;
  telemetry?: OpenAiRecognitionTelemetry;
};

export type OpenAiRecognitionTelemetry = {
  model: string;
  recognitionMode: "top_name" | "details" | "name_fingerprint";
  success: boolean;
  retryCount: number;
  cacheHit: boolean;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens: number };
};

export type VisualRecognitionDebug = {
  strategy: "standard" | "alternate";
  recognitionMode: "details" | "name_fingerprint";
  httpStatus: number;
  responseBodyKeys: string[];
  requestId?: string;
  providerStatus?: number;
  elapsedMs: number;
  timeout: boolean;
  rawIdentification?: unknown;
  rawProviderResponse?: unknown;
  telemetry?: OpenAiRecognitionTelemetry;
};

export type TopRegionRecognitionDebug = {
  strategy: "standard" | "alternate";
  recognitionMode: "top_name";
  httpStatus: number;
  responseBodyKeys: string[];
  requestId?: string;
  providerStatus?: number;
  elapsedMs: number;
  rawProviderResponse?: unknown;
  parsed: PokemonTopRegionIdentification;
  telemetry?: OpenAiRecognitionTelemetry;
};

export type ScannerSearchDebug = {
  recognizedFields: {
    name: string | null;
    collectorNumber: string | null;
    set: string | null;
    hp: number | null;
    stageOrSubtype: string | null;
    abilityNames: string[];
    attackNames: string[];
    attackDamage: string[];
    language: string;
  };
  fieldConfidence: {
    name: IdentificationFieldConfidence;
    collectorNumber: IdentificationFieldConfidence;
    set: IdentificationFieldConfidence;
    hp: IdentificationFieldConfidence;
    stage: IdentificationFieldConfidence;
    ability: IdentificationFieldConfidence;
    attack: IdentificationFieldConfidence;
    attackDamage: IdentificationFieldConfidence;
  };
  queries: Array<{
    query: string;
    reason: string;
    httpStatus?: number;
    providerStatus?: number;
    responseBodyKeys?: string[];
    requestId?: string;
    resultCount?: number;
    emptyResultRetried?: boolean;
  }>;
  firstTwentyReturned: Array<{ name: string; collectorNumber: string | null; set: string | null; language: string; providerId: string }>;
  rankings: ReturnType<typeof scoreScannerCandidate>[];
  providerCandidateCount: number;
  fallbackUsed: boolean;
  selectedCandidate: string | null;
  candidateListShown: string[];
  confidenceThreshold: number;
  finalReason: string;
};

const visualDebug = new WeakMap<PokemonCardIdentification, VisualRecognitionDebug>();
const topRegionDebug = new WeakMap<PokemonTopRegionIdentification, TopRegionRecognitionDebug>();
let latestSearchDebug: ScannerSearchDebug | undefined;

export function visualRecognitionDebugFor(identification: PokemonCardIdentification) {
  return visualDebug.get(identification);
}

export function topRegionRecognitionDebugFor(identification: PokemonTopRegionIdentification) {
  return topRegionDebug.get(identification);
}

export function latestScannerSearchDebug() {
  return latestSearchDebug;
}

export class PokemonCardIdentificationError extends Error {
  code: string;
  requestId?: string;

  constructor(message: string, code: string, requestId?: string) {
    super(message);
    this.name = "PokemonCardIdentificationError";
    this.code = code;
    this.requestId = requestId;
  }
}

/** Reads the exact File bytes; recognition inputs have already been orientation-normalized. */
export function recognitionFileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the recognition image."));
    reader.readAsDataURL(file);
  });
}

function combinedAbortSignal(callerSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", onAbort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onAbort);
    },
  };
}

export async function identifyPokemonCardVisually(
  file: File,
  signal?: AbortSignal,
  strategy: "standard" | "alternate" = "standard",
  recognitionMode: "details" | "name_fingerprint" = "details",
) {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) {
    throw new PokemonCardIdentificationError("Visual identification needs the app's Supabase connection.", "NOT_CONFIGURED");
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new PokemonCardIdentificationError("Use a JPEG, PNG, or WebP card image.", "UNSUPPORTED_IMAGE_TYPE");
  }
  const dataUrl = await recognitionFileDataUrl(file);
  const imageBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const request = combinedAbortSignal(signal, 26_000);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${POKEMON_CARD_IDENTIFY_FUNCTION}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
      body: JSON.stringify({ imageBase64, mimeType: file.type, recognitionStrategy: strategy, recognitionMode, debug: import.meta.env.DEV }),
      signal: request.signal,
    });
    const payload = await response.json().catch(() => null) as IdentifyPayload | null;
    if (import.meta.env.DEV) console.info("[Visual card scanner] recognition HTTP response", {
      httpStatus: response.status,
      responseBodyKeys: payload ? Object.keys(payload) : [],
      requestId: payload?.requestId || response.headers.get("x-request-id"),
      providerStatus: payload?.providerStatus,
      strategy,
      elapsedMs: Math.round(performance.now() - startedAt),
      rawProviderResponse: payload?.rawProviderResponse,
      normalizedIdentification: payload?.identification,
    });
    if (!response.ok || !payload?.success || !payload.identification) {
      if (import.meta.env.DEV) console.error("[Visual card scanner] recognition request failed", {
        httpStatus: response.status,
        upstreamErrorCode: payload?.upstreamErrorCode || payload?.code,
        providerStatus: payload?.providerStatus,
        requestId: payload?.requestId || response.headers.get("x-request-id"),
        fileSize: file.size,
        mimeType: file.type,
      });
      const fallbackMessage = response.status === 429
        ? "Card recognition is busy. Try again shortly."
        : response.status === 400 || response.status === 413 || response.status === 415
          ? "Card recognition rejected the processed image. Adjust the crop and try again."
          : response.status === 401 || response.status === 403
            ? "Card recognition is not configured correctly."
            : "Couldn't connect to card recognition. Try again.";
      throw new PokemonCardIdentificationError(
        payload?.message || fallbackMessage,
        payload?.code || `HTTP_${response.status}`,
        payload?.requestId || response.headers.get("x-request-id") || undefined,
      );
    }
    if (import.meta.env.DEV) console.info("[Visual card scanner] raw full-region response before parsing", {
      strategy,
      rawProviderResponse: payload.rawProviderResponse ?? payload.identification,
    });
    const identification = normalizePokemonCardIdentification(payload.identification);
    if (import.meta.env.DEV) visualDebug.set(identification, {
      strategy,
      recognitionMode,
      httpStatus: response.status,
      responseBodyKeys: Object.keys(payload),
      requestId: payload.requestId || response.headers.get("x-request-id") || undefined,
      providerStatus: payload.providerStatus,
      elapsedMs: Math.round(performance.now() - startedAt),
      timeout: false,
      rawIdentification: payload.identification,
      rawProviderResponse: payload.rawProviderResponse,
      telemetry: payload.telemetry,
    });
    if (import.meta.env.DEV) console.info("[Visual card scanner] recognition response parsed", {
      visionProcessingSucceeded: true,
      extractedName: identification.card_name || identification.pokemon_name,
      extractedCollectorNumber: identification.collector_number,
      extractedSetHint: identification.set_name_hint || identification.set_code_hint,
      hp: identification.hp,
      language: identification.language,
      cardGame: identification.card_game,
      confidence: identification.confidence,
      fieldConfidence: identification.field_confidence,
      abilityNames: identification.ability_names,
      abilityTextFragments: identification.ability_text_fragments,
      attackNames: identification.attack_names,
      attackTextFragments: identification.attack_text_fragments,
      strategy,
    });
    return identification;
  } catch (error) {
    if (error instanceof PokemonCardIdentificationError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      if (import.meta.env.DEV) console.error("[Visual card scanner] recognition timeout", {
        timeout: true,
        elapsedMs: Math.round(performance.now() - startedAt),
        fileSize: file.size,
        mimeType: file.type,
      });
      if (signal?.aborted) throw error;
      throw new PokemonCardIdentificationError("Visual identification timed out. Try again or search manually.", "OPENAI_TIMEOUT");
    }
    throw new PokemonCardIdentificationError("Couldn't connect to card recognition. Try again.", "NETWORK_ERROR");
  } finally {
    request.cleanup();
  }
}

export async function identifyPokemonCardTopRegion(
  file: File,
  signal?: AbortSignal,
  strategy: "standard" | "alternate" = "standard",
) {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) {
    throw new PokemonCardIdentificationError("Visual identification needs the app's Supabase connection.", "NOT_CONFIGURED");
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new PokemonCardIdentificationError("Use a JPEG, PNG, or WebP card image.", "UNSUPPORTED_IMAGE_TYPE");
  }
  const dataUrl = await recognitionFileDataUrl(file);
  const imageBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const request = combinedAbortSignal(signal, 26_000);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${POKEMON_CARD_IDENTIFY_FUNCTION}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
      body: JSON.stringify({ imageBase64, mimeType: file.type, recognitionStrategy: strategy, recognitionMode: "top_name", debug: import.meta.env.DEV }),
      signal: request.signal,
    });
    const payload = await response.json().catch(() => null) as IdentifyPayload | null;
    if (import.meta.env.DEV) console.info("[Visual card scanner] raw top-region response before parsing", {
      httpStatus: response.status,
      responseBodyKeys: payload ? Object.keys(payload) : [],
      requestId: payload?.requestId || response.headers.get("x-request-id"),
      strategy,
      rawProviderResponse: payload?.rawProviderResponse ?? payload?.topIdentification,
    });
    if (!response.ok || !payload?.success || !payload.topIdentification) {
      throw new PokemonCardIdentificationError(
        payload?.message || "The card-name region could not be read.",
        payload?.code || `HTTP_${response.status}`,
        payload?.requestId || response.headers.get("x-request-id") || undefined,
      );
    }
    const identification = normalizePokemonTopRegionIdentification(payload.topIdentification);
    const debug: TopRegionRecognitionDebug = {
      strategy,
      recognitionMode: "top_name",
      httpStatus: response.status,
      responseBodyKeys: Object.keys(payload),
      requestId: payload.requestId || response.headers.get("x-request-id") || undefined,
      providerStatus: payload.providerStatus,
      elapsedMs: Math.round(performance.now() - startedAt),
      rawProviderResponse: payload.rawProviderResponse,
      parsed: identification,
      telemetry: payload.telemetry,
    };
    if (import.meta.env.DEV) {
      topRegionDebug.set(identification, debug);
      console.info("[Visual card scanner] top-region response parsed", debug);
    }
    return identification;
  } catch (error) {
    if (error instanceof PokemonCardIdentificationError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      if (signal?.aborted) throw error;
      throw new PokemonCardIdentificationError("The card-name region timed out. Try again or adjust the crop.", "OPENAI_TIMEOUT");
    }
    throw new PokemonCardIdentificationError("Couldn't connect to card recognition. Try again.", "NETWORK_ERROR");
  } finally {
    request.cleanup();
  }
}

function mergeMatches(groups: CardMatch[][]) {
  return selectScannerCandidates(groups.flat());
}

function scannerMatchDiagnostics(matches: CardMatch[], evidence: ScannerCandidateEvidence) {
  return matches.map((match) => scoreScannerCandidate(match, evidence));
}

function newSearchDebug(evidence: ScannerCandidateEvidence): ScannerSearchDebug {
  return {
    recognizedFields: {
      name: evidence.name || null,
      collectorNumber: evidence.collectorNumber || null,
      set: evidence.set || null,
      hp: evidence.hp,
      stageOrSubtype: evidence.stageOrSubtype || null,
      abilityNames: evidence.abilityNames,
      attackNames: evidence.attackNames,
      attackDamage: evidence.attackDamage,
      language: evidence.language,
    },
    fieldConfidence: {
      name: evidence.nameConfidence,
      collectorNumber: evidence.collectorNumberConfidence,
      set: evidence.setConfidence,
      hp: evidence.hpConfidence,
      stage: evidence.stageConfidence,
      ability: evidence.abilityConfidence,
      attack: evidence.attackConfidence,
      attackDamage: evidence.attackDamageConfidence,
    },
    queries: [],
    firstTwentyReturned: [],
    rankings: [],
    providerCandidateCount: 0,
    fallbackUsed: false,
    selectedCandidate: null,
    candidateListShown: [],
    confidenceThreshold: evidence.nameConfidence === "high" ? 0.62 : evidence.nameConfidence === "medium" ? 0.46 : 0,
    finalReason: "Search has not completed.",
  };
}

async function runSearchAttempts(
  identification: PokemonCardIdentification,
  indexes: number[],
  debug: ScannerSearchDebug,
  signal?: AbortSignal,
) {
  const language = identification.language === "ja" ? "ja" : "en";
  const attempts = buildPokemonIdentificationSearchAttempts(identification);
  const evidence = scannerCandidateEvidence(identification);
  return Promise.all(indexes.map(async (index) => {
    const attempt = attempts[index];
    if (!attempt) return [] as CardMatch[];
    try {
      const query = [attempt.name, attempt.collectorNumber, attempt.set, attempt.abilityName, attempt.attackName].filter(Boolean).join(" ");
      debug.queries.push({ query, reason: attempt.reason });
      const result = await searchPokemonCardsManually({
        game: "pokemon",
        language,
        name: attempt.name,
        collectorNumber: attempt.collectorNumber,
        set: attempt.set,
        abilityName: attempt.abilityName,
        attackName: attempt.attackName,
        query,
        page: 1,
        pageSize: 12,
        disableCorrection: true,
      }, signal);
      Object.assign(debug.queries[debug.queries.length - 1], {
        httpStatus: result.debug?.httpStatus,
        providerStatus: result.debug?.providerResponseStatus,
        responseBodyKeys: result.debug?.responseBodyKeys,
        requestId: result.debug?.requestId,
        resultCount: result.matches.length,
        emptyResultRetried: result.debug?.emptyResultRetried,
      });
      // "possible" is a useful scanner candidate when the image supplied a
      // readable name but not enough evidence for an exact printing.
      const candidates = selectScannerCandidates(rankScannerCandidates(result.matches, evidence));
      const rankings = scannerMatchDiagnostics(result.matches, evidence);
      debug.providerCandidateCount += result.matches.length;
      debug.firstTwentyReturned.push(...result.matches.map((match) => ({
        name: match.name,
        collectorNumber: match.collectorNumber || null,
        set: match.setName || null,
        language: match.language,
        providerId: match.providerCardId,
      })));
      debug.firstTwentyReturned = debug.firstTwentyReturned.slice(0, 20);
      debug.rankings.push(...rankings);
      if (import.meta.env.DEV) console.info("[Visual card scanner] candidate ranking", {
        recognizedFields: {
          name: evidence.name || null,
          collectorNumber: evidence.collectorNumber || null,
          set: evidence.set || null,
          hp: evidence.hp,
          stageOrSubtype: evidence.stageOrSubtype || null,
          abilityNames: evidence.abilityNames,
          attackNames: evidence.attackNames,
          attackDamage: evidence.attackDamage,
          language: evidence.language,
        },
        fieldConfidence: {
          name: evidence.nameConfidence,
          collectorNumber: evidence.collectorNumberConfidence,
          set: evidence.setConfidence,
          hp: evidence.hpConfidence,
          stage: evidence.stageConfidence,
          ability: evidence.abilityConfidence,
          attack: evidence.attackConfidence,
          attackDamage: evidence.attackDamageConfidence,
        },
        query,
        reason: attempt.reason,
        providerCandidateCount: result.matches.length,
        firstTwentyReturned: debug.firstTwentyReturned,
        candidates: rankings,
        acceptedCandidateCount: candidates.length,
      });
      return candidates;
    } catch (error) {
      if (signal?.aborted) throw error;
      return [] as CardMatch[];
    }
  }));
}

export async function searchRecognizedCardText(input: {
  name: string;
  collectorNumber: string;
  game: "pokemon" | "one_piece";
  language: "en" | "ja";
  nameConfidence?: IdentificationFieldConfidence;
  collectorNumberConfidence?: IdentificationFieldConfidence;
}, signal?: AbortSignal) {
  const name = input.name.trim();
  const collectorNumber = input.collectorNumber.trim();
  if (!name && !collectorNumber) return [];
  const nameConfidence = input.nameConfidence || (name ? "high" : "low");
  const collectorNumberConfidence = input.collectorNumberConfidence || (collectorNumber ? "high" : "low");
  const evidence: ScannerCandidateEvidence = {
    name,
    collectorNumber,
    set: "",
    hp: null,
    stageOrSubtype: "",
    abilityNames: [],
    abilityTextFragments: [],
    attackNames: [],
    attackDamage: [],
    attackTextFragments: [],
    language: input.language,
    nameConfidence,
    collectorNumberConfidence,
    setConfidence: "low",
    hpConfidence: "low",
    stageConfidence: "low",
    abilityConfidence: "low",
    attackConfidence: "low",
    attackDamageConfidence: "low",
  };
  const debug = newSearchDebug(evidence);
  let attempts: IdentificationSearchAttempt[];
  if (name && (nameConfidence === "high" || nameConfidence === "medium") && collectorNumberConfidence !== "high") {
    attempts = [
      { name, collectorNumber: "", set: "", reason: "name-first because collector number is not high confidence" },
      ...(collectorNumberConfidence === "medium" && collectorNumber ? [{ name, collectorNumber, set: "", reason: "medium-confidence collector-number refinement" }] : []),
    ];
  } else if (collectorNumber && collectorNumberConfidence === "high" && nameConfidence === "low") {
    attempts = [
      { name: "", collectorNumber, set: "", reason: "high-confidence collector number primary" },
      ...(name ? [{ name, collectorNumber: "", set: "", reason: "name fallback" }] : []),
    ];
  } else {
    attempts = [
      { name, collectorNumber, set: "", reason: "high-confidence recognized fields" },
      ...(name && collectorNumber ? [{ name, collectorNumber: "", set: "", reason: "automatic name-only fallback" }] : []),
    ];
  }
  const queryHistory: string[] = [];
  const groups: CardMatch[][] = [];
  const diagnostics: ReturnType<typeof scannerMatchDiagnostics> = [];
  let providerCandidateCount = 0;
  let fallbackTriggered = false;
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    const query = [attempt.name, attempt.collectorNumber].filter(Boolean).join(" ");
    queryHistory.push(query);
    debug.queries.push({ query, reason: attempt.reason });
    const result = await searchPokemonCardsManually({
      game: input.game,
      language: input.language,
      name: attempt.name,
      collectorNumber: attempt.collectorNumber,
      query,
      page: 1,
      pageSize: 30,
      disableCorrection: false,
    }, signal);
    Object.assign(debug.queries[debug.queries.length - 1], {
      httpStatus: result.debug?.httpStatus,
      providerStatus: result.debug?.providerResponseStatus,
      responseBodyKeys: result.debug?.responseBodyKeys,
      requestId: result.debug?.requestId,
      resultCount: result.matches.length,
      emptyResultRetried: result.debug?.emptyResultRetried,
    });
    providerCandidateCount += result.matches.length;
    const attemptDiagnostics = scannerMatchDiagnostics(result.matches, evidence);
    diagnostics.push(...attemptDiagnostics);
    debug.providerCandidateCount += result.matches.length;
    debug.firstTwentyReturned.push(...result.matches.map((match) => ({
      name: match.name,
      collectorNumber: match.collectorNumber || null,
      set: match.setName || null,
      language: match.language,
      providerId: match.providerCardId,
    })));
    debug.firstTwentyReturned = debug.firstTwentyReturned.slice(0, 20);
    debug.rankings.push(...attemptDiagnostics);
    const ranked = selectScannerCandidates(rankScannerCandidates(result.matches, evidence));
    groups.push(ranked);
    const merged = mergeMatches(groups);
    if (merged.length >= 5 || (merged.length && !attempt.collectorNumber)) break;
    if (index === 0 && attempts.length > 1) fallbackTriggered = true;
  }
  const candidates = mergeMatches(groups);
  debug.fallbackUsed = fallbackTriggered;
  debug.selectedCandidate = candidates[0]?.providerCardId || null;
  debug.candidateListShown = candidates.map((candidate) => candidate.providerCardId);
  debug.finalReason = candidates.length
    ? `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} passed the confidence and name-sanity checks.`
    : "No provider candidate passed the confidence and name-sanity checks.";
  latestSearchDebug = debug;
  if (import.meta.env.DEV) console.info("[Visual card scanner] recognized-text search", {
    recognizedFields: { name: name || null, collectorNumber: collectorNumber || null, language: input.language },
    fieldConfidence: { name: nameConfidence, collectorNumber: collectorNumberConfidence },
    queries: queryHistory,
    providerCandidateCount,
    candidateCount: candidates.length,
    candidates: diagnostics,
    fallbackTriggered,
    confidenceThreshold: nameConfidence === "high" ? 0.62 : nameConfidence === "medium" ? 0.46 : 0,
  });
  return candidates;
}

export async function matchPokemonIdentification(identification: PokemonCardIdentification, signal?: AbortSignal) {
  const attempts = buildPokemonIdentificationSearchAttempts(identification);
  if (!attempts.length) return [];
  const debug = newSearchDebug(scannerCandidateEvidence(identification));
  const groups: CardMatch[][] = [];
  for (let index = 0; index < attempts.length; index++) {
    groups.push(...await runSearchAttempts(identification, [index], debug, signal));
    const matches = mergeMatches(groups);
    if (matches.length >= 5 || matches[0]?.matchScore >= 92) {
      debug.fallbackUsed = index > 0;
      debug.selectedCandidate = matches[0]?.providerCardId || null;
      debug.candidateListShown = matches.map((match) => match.providerCardId);
      debug.finalReason = `${matches.length} candidate${matches.length === 1 ? "" : "s"} passed the confidence and name-sanity checks.`;
      latestSearchDebug = debug;
      return matches;
    }
  }
  const matches = mergeMatches(groups);
  debug.fallbackUsed = attempts.length > 1;
  debug.selectedCandidate = matches[0]?.providerCardId || null;
  debug.candidateListShown = matches.map((match) => match.providerCardId);
  debug.finalReason = matches.length
    ? `${matches.length} candidate${matches.length === 1 ? "" : "s"} passed the confidence and name-sanity checks.`
    : "No provider candidate passed the confidence and name-sanity checks.";
  latestSearchDebug = debug;
  return matches;
}
