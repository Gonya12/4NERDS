import {
  POKEMON_CARD_IDENTIFY_FUNCTION,
  buildPokemonIdentificationSearchAttempts,
  normalizePokemonCardIdentification,
  selectScannerCandidates,
  type PokemonCardIdentification,
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

async function runSearchAttempts(
  identification: PokemonCardIdentification,
  indexes: number[],
  signal?: AbortSignal,
) {
  const language = identification.language === "ja" ? "ja" : "en";
  const attempts = buildPokemonIdentificationSearchAttempts(identification);
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
      return selectScannerCandidates(result.matches);
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
}, signal?: AbortSignal) {
  const query = [input.name.trim(), input.collectorNumber.trim()].filter(Boolean).join(" ");
  if (!query) return [];
  const result = await searchPokemonCardsManually({
    game: input.game,
    language: input.language,
    name: input.name.trim(),
    collectorNumber: input.collectorNumber.trim(),
    query,
    page: 1,
    pageSize: 30,
    disableCorrection: false,
  }, signal);
  const candidates = selectScannerCandidates(result.matches);
  if (import.meta.env.DEV) console.info("[Visual card scanner] recognized-text search", {
    detectedCardName: input.name.trim() || null,
    detectedCollectorNumber: input.collectorNumber.trim() || null,
    query,
    providerCandidateCount: result.matches.length,
    candidateCount: candidates.length,
    rejectedCandidates: result.matches.length - candidates.length,
    rejectionReason: result.matches.length > candidates.length ? "unreliable confidence or duplicate provider record" : "none",
  });
  return candidates;
}

export async function matchPokemonIdentification(identification: PokemonCardIdentification, signal?: AbortSignal) {
  const attempts = buildPokemonIdentificationSearchAttempts(identification);
  if (!attempts.length) return [];
  const collectorIndexes = attempts
    .map((attempt, index) => attempt.collectorNumber ? index : -1)
    .filter((index) => index >= 0);
  const collectorMatches = mergeMatches(await runSearchAttempts(identification, collectorIndexes, signal));
  if (collectorMatches.length >= 5 || collectorMatches[0]?.matchScore >= 92) return collectorMatches;
  const fallbackIndexes = attempts
    .map((attempt, index) => !attempt.collectorNumber ? index : -1)
    .filter((index) => index >= 0);
  return mergeMatches([collectorMatches, ...await runSearchAttempts(identification, fallbackIndexes, signal)]);
}
