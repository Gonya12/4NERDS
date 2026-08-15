import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  POKEMON_CARD_IDENTIFY_MODEL,
  assessPokemonIdentification,
  normalizePokemonCardIdentification,
  normalizePokemonTopRegionIdentification,
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
const fieldConfidenceInstruction = "Grade card name, HP, stage, ability, attack, attack damage, collector number, set, language, and artwork independently as high, medium, or low. A readable name and uncertain collector number must be high name confidence and low collector-number confidence.";
const topRegionPrompt = "This image contains only the TOP band of one physical trading card. Read the prominent printed card title and HP value only. Preserve suffixes such as ex, EX, GX, V, VMAX, and VSTAR. Ignore evolution labels, stage text, attack text, sleeve text, glare, and background. Do not infer an exact printing, set, collector number, price, or provider ID. Return cardName as null when the title itself is not readable. Return hp as null when unreadable.";
const detailsPrompt = "This is the one permitted details pass for an ambiguous trading-card match. The image is already cropped to the physical card. Read visible evidence from TOP (name including ex/EX/V/VMAX/VSTAR/GX suffix, HP, stage/subtype), MIDDLE (ability), LOWER-MIDDLE (attacks and damage), and BOTTOM (collector number, set/code, regulation mark). The title is primary; ability and attack names are content fingerprints; tiny bottom text is secondary. Never guess unreadable text. Never provide prices, accounting values, inventory IDs, provider IDs, or a final database-card decision. Preserve leading zeros and detect Japanese rather than forcing English. Return null or empty lists for unreadable fields.";

const nullableString = { type: ["string", "null"] };
const nullableInteger = { type: ["integer", "null"] };
const confidenceSchema = { type: "string", enum: ["high", "medium", "low"] };
const responseSchema = {
  type: "object",
  additionalProperties: false,
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
    stage_or_subtype: nullableString,
    ability_names: { type: "array", items: { type: "string" }, maxItems: 3 },
    ability_text_fragments: { type: "array", items: { type: "string" }, maxItems: 4 },
    attack_names: { type: "array", items: { type: "string" }, maxItems: 4 },
    attack_damage: { type: "array", items: { type: "string" }, maxItems: 4 },
    attack_text_fragments: { type: "array", items: { type: "string" }, maxItems: 6 },
    regulation_mark: nullableString,
    copyright_year: nullableInteger,
    visible_text: { type: "array", items: { type: "string" }, maxItems: 12 },
    artwork_characteristics: { type: "array", items: { type: "string" }, maxItems: 8 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    field_confidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        card_name: confidenceSchema,
        collector_number: confidenceSchema,
        set: confidenceSchema,
        hp: confidenceSchema,
        stage: confidenceSchema,
        ability: confidenceSchema,
        attack: confidenceSchema,
        attack_damage: confidenceSchema,
        language: confidenceSchema,
        artwork: confidenceSchema,
      },
      required: ["card_name", "collector_number", "set", "hp", "stage", "ability", "attack", "attack_damage", "language", "artwork"],
    },
    notes: { type: "array", items: { type: "string" }, maxItems: 8 },
  },
  required: [
    "card_name", "pokemon_name", "collector_number", "printed_total_number", "set_name_hint", "set_code_hint",
    "card_game", "language", "rarity_hint", "hp", "stage_or_subtype", "ability_names", "ability_text_fragments",
    "attack_names", "attack_damage", "attack_text_fragments", "regulation_mark", "copyright_year",
    "visible_text", "artwork_characteristics", "confidence", "field_confidence", "notes",
  ],
};
const topRegionResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cardName: nullableString,
    hp: nullableInteger,
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["cardName", "hp", "confidence"],
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
  if (typeof root.output_text === "string") return root.output_text.trim();
  const output = Array.isArray(root.output) ? root.output : [];
  return output.flatMap((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const content = Array.isArray(row.content) ? row.content : [];
    return content.map((part) => {
      const block = part && typeof part === "object" ? part as Record<string, unknown> : {};
      return block.type === "output_text" && typeof block.text === "string" ? block.text : "";
    });
  }).join("").trim();
}

function openAiError(value: unknown) {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const error = root.error && typeof root.error === "object" ? root.error as Record<string, unknown> : {};
  return {
    code: typeof error.code === "string" ? error.code : typeof error.type === "string" ? error.type : undefined,
    message: typeof error.message === "string" ? error.message.slice(0, 300) : undefined,
  };
}

function responseUsage(value: unknown) {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const usage = root.usage && typeof root.usage === "object" ? root.usage as Record<string, unknown> : {};
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === "object"
    ? usage.input_tokens_details as Record<string, unknown>
    : {};
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
    cachedInputTokens: Number(inputDetails.cached_tokens || 0),
  };
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return errorResponse(requestId, "METHOD_NOT_ALLOWED", "Method not allowed.", 405);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return errorResponse(requestId, "OPENAI_NOT_CONFIGURED", "Visual card identification is not configured.", 503);

  let imageBase64 = "";
  let mimeType: PokemonCardImageMimeType;
  let recognitionStrategy: "standard" | "alternate" = "standard";
  let recognitionMode: "details" | "top_name" = "details";
  let debug = false;
  try {
    const body = await request.json() as { imageBase64?: unknown; mimeType?: unknown; recognitionStrategy?: unknown; recognitionMode?: unknown; debug?: unknown };
    if (typeof body.imageBase64 !== "string" || !body.imageBase64.trim()) {
      return errorResponse(requestId, "IMAGE_REQUIRED", "A card image is required.", 400);
    }
    if (!supportedPokemonCardImageTypes.includes(body.mimeType as PokemonCardImageMimeType)) {
      return errorResponse(requestId, "UNSUPPORTED_IMAGE_TYPE", "Use a JPEG, PNG, or WebP image.", 415);
    }
    mimeType = body.mimeType as PokemonCardImageMimeType;
    recognitionStrategy = body.recognitionStrategy === "alternate" ? "alternate" : "standard";
    recognitionMode = body.recognitionMode === "top_name" ? "top_name" : "details";
    debug = body.debug === true;
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
    const schema = recognitionMode === "top_name" ? topRegionResponseSchema : responseSchema;
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: POKEMON_CARD_IDENTIFY_MODEL,
        store: false,
        reasoning: { effort: "none" },
        max_output_tokens: recognitionMode === "top_name" ? 180 : 900,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: recognitionMode === "top_name" ? topRegionPrompt : `${detailsPrompt} ${fieldConfidenceInstruction}` },
            { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}`, detail: "high" },
          ],
        }],
        text: {
          verbosity: "low",
          format: { type: "json_schema", name: recognitionMode === "top_name" ? "card_name_hp" : "card_identification", strict: true, schema },
        },
      }),
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const providerError = openAiError(payload);
      const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : upstream.status === 401 || upstream.status === 403 ? 503 : 400;
      const code = upstream.status === 429
        ? "OPENAI_RATE_LIMITED"
        : upstream.status === 401 || upstream.status === 403
          ? "OPENAI_AUTH_CONFIGURATION"
          : upstream.status === 400
            ? "OPENAI_INVALID_REQUEST"
            : "OPENAI_UNAVAILABLE";
      console.warn("[pokemon-card-identify] OpenAI request failed", {
        requestId,
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
    if (!text) throw new Error("OpenAI returned no structured identification.");
    const rawResponse = JSON.parse(text) as unknown;
    const telemetry = {
      model: POKEMON_CARD_IDENTIFY_MODEL,
      recognitionMode,
      success: true,
      retryCount: 0,
      cacheHit: false,
      usage: responseUsage(payload),
    };
    if (recognitionMode === "top_name") {
      const topIdentification = normalizePokemonTopRegionIdentification(rawResponse);
      console.info("[pokemon-card-identify] top-region response parsed", { requestId, model: POKEMON_CARD_IDENTIFY_MODEL, parsed: topIdentification, telemetry, latencyMs: Date.now() - startedAt });
      return json({
        success: true,
        model: POKEMON_CARD_IDENTIFY_MODEL,
        topIdentification,
        recognitionMode,
        recognitionStrategy,
        telemetry,
        ...(debug ? { rawProviderResponse: rawResponse } : {}),
        latencyMs: Date.now() - startedAt,
        requestId,
      }, 200, requestId);
    }
    const identification = normalizePokemonCardIdentification(rawResponse);
    const validation = assessPokemonIdentification(identification);
    console.info("[pokemon-card-identify] OpenAI request succeeded", {
      requestId,
      model: POKEMON_CARD_IDENTIFY_MODEL,
      recognitionStrategy,
      recognitionMode,
      telemetry,
      latencyMs: Date.now() - startedAt,
      useful: validation.useful,
      rejectedFieldCount: validation.rejectedFields.length,
    });
    return json({
      success: true,
      model: POKEMON_CARD_IDENTIFY_MODEL,
      identification,
      recognitionStrategy,
      validation: { useful: validation.useful, rejectedFields: validation.rejectedFields },
      telemetry,
      latencyMs: Date.now() - startedAt,
      requestId,
      ...(debug ? { rawProviderResponse: rawResponse } : {}),
    }, 200, requestId);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    console.warn("[pokemon-card-identify] OpenAI response failed", { requestId, model: POKEMON_CARD_IDENTIFY_MODEL, timedOut, latencyMs: Date.now() - startedAt });
    return errorResponse(requestId, timedOut ? "OPENAI_TIMEOUT" : "MALFORMED_OPENAI_RESPONSE", timedOut ? "Visual identification timed out. Try again or search manually." : "Visual identification returned an unreadable result.", timedOut ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
});
