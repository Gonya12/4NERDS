import {
  POKEMON_CARD_IDENTIFY_FUNCTION,
  buildPokemonIdentificationSearchAttempts,
  normalizePokemonCardIdentification,
  rankScannerCandidates,
  scannerCandidateEvidence,
  scannerCardNameSimilarity,
  selectScannerCandidates,
  type IdentificationFieldConfidence,
  type IdentificationSearchAttempt,
  type PokemonCardIdentification,
  type ScannerCandidateEvidence,
} from "../../../supabase/functions/_shared/pokemonCardIdentificationCore.ts";
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from "../../utils/supabase";
import { fileToDataUrl } from "../images/saleImageService";
import { searchPokemonCardsManually, type CardMatch } from "./pokemonCardSearchService";

type IdentifyPayload = {
  success?: boolean;
  code?: string;
  message?: string;
  identification?: unknown;
  requestId?: string;
  providerStatus?: number;
  upstreamErrorCode?: string;
};

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

export async function identifyPokemonCardVisually(file: File, signal?: AbortSignal) {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) {
    throw new PokemonCardIdentificationError("Visual identification needs the app's Supabase connection.", "NOT_CONFIGURED");
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new PokemonCardIdentificationError("Use a JPEG, PNG, or WebP card image.", "UNSUPPORTED_IMAGE_TYPE");
  }
  const dataUrl = await fileToDataUrl(file);
  const imageBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const request = combinedAbortSignal(signal, 26_000);
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${POKEMON_CARD_IDENTIFY_FUNCTION}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
      body: JSON.stringify({ imageBase64, mimeType: file.type }),
      signal: request.signal,
    });
    const payload = await response.json().catch(() => null) as IdentifyPayload | null;
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
    const identification = normalizePokemonCardIdentification(payload.identification);
    if (import.meta.env.DEV) console.info("[Visual card scanner] recognition response parsed", {
      visionProcessingSucceeded: true,
      extractedName: identification.card_name || identification.pokemon_name,
      extractedCollectorNumber: identification.collector_number,
      extractedSetHint: identification.set_name_hint || identification.set_code_hint,
      confidence: identification.confidence,
    });
    return identification;
  } catch (error) {
    if (error instanceof PokemonCardIdentificationError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      if (signal?.aborted) throw error;
      throw new PokemonCardIdentificationError("Visual identification timed out. Try again or search manually.", "GEMINI_TIMEOUT");
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
  const threshold = evidence.nameConfidence === "high" ? 0.58 : evidence.nameConfidence === "medium" ? 0.42 : 0;
  return matches.map((match) => {
    const nameSimilarity = evidence.name ? scannerCardNameSimilarity(evidence.name, match.name) : 0;
    return {
      candidateName: match.name,
      collectorNumber: match.collectorNumber || null,
      nameSimilarity: Math.round(nameSimilarity * 100) / 100,
      rejected: Boolean(evidence.name && threshold && nameSimilarity < threshold),
      rejectionReason: evidence.name && threshold && nameSimilarity < threshold
        ? `name similarity below ${threshold}`
        : null,
    };
  });
}

async function runSearchAttempts(
  identification: PokemonCardIdentification,
  indexes: number[],
  signal?: AbortSignal,
) {
  const language = identification.language === "ja" ? "ja" : "en";
  const attempts = buildPokemonIdentificationSearchAttempts(identification);
  const evidence = scannerCandidateEvidence(identification);
  return Promise.all(indexes.map(async (index) => {
    const attempt = attempts[index];
    if (!attempt) return [] as CardMatch[];
    try {
      const result = await searchPokemonCardsManually({
        game: "pokemon",
        language,
        name: attempt.name,
        collectorNumber: attempt.collectorNumber,
        set: attempt.set,
        query: [attempt.name, attempt.collectorNumber, attempt.set].filter(Boolean).join(" "),
        page: 1,
        pageSize: 12,
        disableCorrection: true,
      }, signal);
      // "possible" is a useful scanner candidate when the image supplied a
      // readable name but not enough evidence for an exact printing.
      const candidates = selectScannerCandidates(rankScannerCandidates(result.matches, evidence));
      if (import.meta.env.DEV) console.info("[Visual card scanner] candidate ranking", {
        recognizedFields: {
          name: evidence.name || null,
          collectorNumber: evidence.collectorNumber || null,
          set: evidence.set || null,
          language: evidence.language,
        },
        fieldConfidence: {
          name: evidence.nameConfidence,
          collectorNumber: evidence.collectorNumberConfidence,
          set: evidence.setConfidence,
        },
        query: [attempt.name, attempt.collectorNumber, attempt.set].filter(Boolean).join(" "),
        reason: attempt.reason,
        providerCandidateCount: result.matches.length,
        candidates: scannerMatchDiagnostics(result.matches, evidence),
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
    language: input.language,
    nameConfidence,
    collectorNumberConfidence,
    setConfidence: "low",
  };
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
    providerCandidateCount += result.matches.length;
    diagnostics.push(...scannerMatchDiagnostics(result.matches, evidence));
    const ranked = selectScannerCandidates(rankScannerCandidates(result.matches, evidence));
    groups.push(ranked);
    const merged = mergeMatches(groups);
    if (merged.length >= 5 || (merged.length && !attempt.collectorNumber)) break;
    if (index === 0 && attempts.length > 1) fallbackTriggered = true;
  }
  const candidates = mergeMatches(groups);
  if (import.meta.env.DEV) console.info("[Visual card scanner] recognized-text search", {
    recognizedFields: { name: name || null, collectorNumber: collectorNumber || null, language: input.language },
    fieldConfidence: { name: nameConfidence, collectorNumber: collectorNumberConfidence },
    queries: queryHistory,
    providerCandidateCount,
    candidateCount: candidates.length,
    candidates: diagnostics,
    fallbackTriggered,
    confidenceThreshold: nameConfidence === "high" ? 0.58 : nameConfidence === "medium" ? 0.42 : 0,
  });
  return candidates;
}

export async function matchPokemonIdentification(identification: PokemonCardIdentification, signal?: AbortSignal) {
  const attempts = buildPokemonIdentificationSearchAttempts(identification);
  if (!attempts.length) return [];
  const groups: CardMatch[][] = [];
  for (let index = 0; index < attempts.length; index++) {
    groups.push(...await runSearchAttempts(identification, [index], signal));
    const matches = mergeMatches(groups);
    if (matches.length >= 5 || matches[0]?.matchScore >= 92) return matches;
  }
  return mergeMatches(groups);
}
