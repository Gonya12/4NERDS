import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  POKEMON_CARD_IDENTIFY_MODEL,
  normalizePokemonCardIdentification,
  stripPokemonCardImagePrefix,
  supportedPokemonCardImageTypes,
  type PokemonCardImageMimeType,
} from "../_shared/pokemonCardIdentificationCore.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-request-id, retry-after",
};
const maxDecodedBytes = 6 * 1024 * 1024;
const prompt = `You are a visual trading-card identification assistant. Inspect the single Pokémon or One Piece card occupying most of the image, even when a sleeve, top loader, stand, background, glare, or slight tilt is visible. Read only visible evidence. Extract partial visible text and distinctive artwork characteristics when exact identification is uncertain so the app can search for candidates. Never provide prices, accounting values, inventory IDs, provider API IDs, or a final confirmation. Preserve collector-number leading zeros and distinguish EX, ex, GX, V, VMAX, VSTAR, promo, and older printings. Detect Japanese rather than forcing English. If text or a number is unreadable, return null and lower confidence instead of guessing. Notes should briefly describe image limitations that affect identification.`;

// Gemini 3.6 structured output supports nullable primitives through a JSON
// Schema type array. Using anyOf for primitive nullability can be rejected.
const nullableString = { type: ["string", "null"] };
const nullableInteger = { type: ["integer", "null"] };
const responseSchema = {
  type: "object",
  properties: {
    card_name: nullableString,
    pokemon_name: nullableString,
    collector_number: nullableString,
    printed_total_number: nullableString,
    set_name_hint: nullableString,
    set_code_hint: nullableString,
    card_game: { type: "string", enum: ["pokemon", "one_piece", "unknown"] },
    language: { type: "string", enum: ["en", "ja", "unknown"] },
    rarity_hint: nullableString,
    hp: nullableInteger,
    regulation_mark: nullableString,
    copyright_year: nullableInteger,
    visible_text: { type: "array", items: { type: "string" }, maxItems: 12 },
    artwork_characteristics: { type: "array", items: { type: "string" }, maxItems: 8 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    notes: { type: "array", items: { type: "string" }, maxItems: 8 },
  },
  required: [
    "card_name", "pokemon_name", "collector_number", "printed_total_number", "set_name_hint", "set_code_hint",
    "card_game", "language", "rarity_hint", "hp", "regulation_mark", "copyright_year",
    "visible_text", "artwork_characteristics", "confidence", "notes",
  ],
};

function json(body: unknown, status = 200, requestId?: string, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(requestId ? { "x-request-id": requestId } : {}),
      ...extraHeaders,
    },
  });
}

function errorResponse(requestId: string, code: string, message: string, status: number, retryAfter?: string) {
  return json({ success: false, code, message, requestId }, status, requestId, retryAfter ? { "Retry-After": retryAfter } : {});
}

function responseText(value: unknown) {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const candidate = candidates[0] && typeof candidates[0] === "object" ? candidates[0] as Record<string, unknown> : {};
  const content = candidate.content && typeof candidate.content === "object" ? candidate.content as Record<string, unknown> : {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return parts.map((part) => part && typeof part === "object" ? String((part as Record<string, unknown>).text || "") : "").join("").trim();
}

function geminiError(value: unknown) {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const error = root.error && typeof root.error === "object" ? root.error as Record<string, unknown> : {};
  return {
    code: typeof error.status === "string" ? error.status : undefined,
    message: typeof error.message === "string" ? error.message.slice(0, 300) : undefined,
  };
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return errorResponse(requestId, "METHOD_NOT_ALLOWED", "Method not allowed.", 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return errorResponse(requestId, "GEMINI_NOT_CONFIGURED", "Visual card identification is not configured.", 503);

  let imageBase64 = "";
  let mimeType: PokemonCardImageMimeType;
  try {
    const body = await request.json() as { imageBase64?: unknown; mimeType?: unknown };
    if (typeof body.imageBase64 !== "string" || !body.imageBase64.trim()) {
      return errorResponse(requestId, "IMAGE_REQUIRED", "A card image is required.", 400);
    }
    if (!supportedPokemonCardImageTypes.includes(body.mimeType as PokemonCardImageMimeType)) {
      return errorResponse(requestId, "UNSUPPORTED_IMAGE_TYPE", "Use a JPEG, PNG, or WebP image.", 415);
    }
    mimeType = body.mimeType as PokemonCardImageMimeType;
    imageBase64 = stripPokemonCardImagePrefix(body.imageBase64);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(imageBase64)) {
      return errorResponse(requestId, "INVALID_IMAGE", "The card image is not valid base64 data.", 400);
    }
    const decodedBytes = Math.floor(imageBase64.length * 3 / 4) - (imageBase64.endsWith("==") ? 2 : imageBase64.endsWith("=") ? 1 : 0);
    if (decodedBytes <= 0 || decodedBytes > maxDecodedBytes) {
      return errorResponse(requestId, "IMAGE_TOO_LARGE", "The optimized card image must be 6 MB or smaller.", 413);
    }
  } catch {
    return errorResponse(requestId, "INVALID_JSON", "A valid JSON request body is required.", 400);
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22_000);
  try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${POKEMON_CARD_IDENTIFY_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: mimeType, data: imageBase64 } }, { text: prompt }] }],
        generationConfig: {
          thinkingConfig: { thinkingLevel: "low" },
          responseFormat: { text: { mimeType: "application/json", schema: responseSchema } },
        },
      }),
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const providerError = geminiError(payload);
      const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : upstream.status === 401 || upstream.status === 403 ? 503 : 400;
      const code = upstream.status === 429
        ? "GEMINI_RATE_LIMITED"
        : upstream.status === 401 || upstream.status === 403
          ? "GEMINI_AUTH_CONFIGURATION"
          : upstream.status === 400
            ? "GEMINI_INVALID_REQUEST"
            : "GEMINI_UNAVAILABLE";
      console.warn("[pokemon-card-identify] Gemini request failed", {
        model: POKEMON_CARD_IDENTIFY_MODEL,
        providerStatus: upstream.status,
        upstreamErrorCode: providerError.code,
        upstreamMessage: providerError.message,
        latencyMs: Date.now() - startedAt,
      });
      const message = upstream.status === 429
        ? "Card recognition is busy. Try again shortly."
        : upstream.status === 401 || upstream.status === 403
          ? "Card recognition is not configured correctly."
          : upstream.status === 400
            ? "Card recognition rejected the processed image. Adjust the crop and try again."
            : "Couldn't connect to card recognition. Try again.";
      return json({ success: false, code, message, requestId, providerStatus: upstream.status, upstreamErrorCode: providerError.code }, status, requestId, upstream.headers.get("Retry-After") ? { "Retry-After": upstream.headers.get("Retry-After") as string } : {});
    }
    const text = responseText(payload);
    if (!text) throw new Error("Gemini returned no structured identification.");
    const identification = normalizePokemonCardIdentification(JSON.parse(text));
    console.info("[pokemon-card-identify] Gemini request succeeded", {
      model: POKEMON_CARD_IDENTIFY_MODEL,
      latencyMs: Date.now() - startedAt,
      parsed: {
        card_name: identification.card_name,
        collector_number: identification.collector_number,
        set_name_hint: identification.set_name_hint,
        language: identification.language,
        confidence: identification.confidence,
      },
    });
    return json({ success: true, model: POKEMON_CARD_IDENTIFY_MODEL, identification, latencyMs: Date.now() - startedAt, requestId }, 200, requestId);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    console.warn("[pokemon-card-identify] Gemini response failed", { model: POKEMON_CARD_IDENTIFY_MODEL, timedOut, latencyMs: Date.now() - startedAt });
    return errorResponse(requestId, timedOut ? "GEMINI_TIMEOUT" : "MALFORMED_GEMINI_RESPONSE", timedOut ? "Visual identification timed out. Try again or search manually." : "Visual identification returned an unreadable result.", timedOut ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
});
