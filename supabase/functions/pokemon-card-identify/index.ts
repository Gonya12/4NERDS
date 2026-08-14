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
const alternatePrompt = "This is a single automatic alternate pass after an unusable first result. Re-evaluate the image independently. Prioritize the prominent printed card title, character artwork, HP area, and bottom collector-number line. Ignore attack names, ability names, rules, sleeve text, labels, and background text. Return null instead of inventing a card name from fragments.";
const topRegionPrompt = `This image contains only the TOP band of one physical trading card. Read the prominent printed card title and HP value only. Preserve suffixes such as ex, EX, GX, V, VMAX, and VSTAR. Ignore evolution labels, stage text, attack text, sleeve text, glare, and background. Do not infer an exact printing, set, or collector number. Return cardName as null when the title itself is not readable; never substitute an example or placeholder. Return hp as null when unreadable.`;
const prompt = `You are a region-aware visual trading-card identification assistant. First estimate the physical Pokémon or One Piece card boundary and ignore the stand, sleeve outside the printed card, table, monitor, hands, and background. Analyze regions relative to that printed card: TOP (name including ex/EX/V/VMAX/VSTAR/GX suffix, HP, stage/subtype), MIDDLE (ability name and one distinctive ability-text fragment), LOWER-MIDDLE (attack names, damage, and distinctive attack-text fragments), and BOTTOM (collector number, set/code, regulation mark). The top printed name is the primary identity signal. Ability and attack names are secondary content fingerprints. A tiny collector number is secondary and must be null/low-confidence when unclear. Do not treat arbitrary body text as a card name. Read only visible evidence; tolerate sleeves, top loaders, glare, slight perspective, rotation, and background clutter. Never provide prices, accounting values, inventory IDs, provider API IDs, or final confirmation. Preserve collector-number leading zeros and distinguish EX, ex, GX, V, VMAX, VSTAR, promo, and older printings. Detect Japanese rather than forcing English. Stop trying to read tiny bottom text when the name, HP, and distinctive ability/attack fingerprint are already clear. If any field is unreadable, return null or an empty list and lower only that field's confidence instead of guessing.`;

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
      properties: {
        card_name: { type: "string", enum: ["high", "medium", "low"] },
        collector_number: { type: "string", enum: ["high", "medium", "low"] },
        set: { type: "string", enum: ["high", "medium", "low"] },
        hp: { type: "string", enum: ["high", "medium", "low"] },
        stage: { type: "string", enum: ["high", "medium", "low"] },
        ability: { type: "string", enum: ["high", "medium", "low"] },
        attack: { type: "string", enum: ["high", "medium", "low"] },
        attack_damage: { type: "string", enum: ["high", "medium", "low"] },
        language: { type: "string", enum: ["high", "medium", "low"] },
        artwork: { type: "string", enum: ["high", "medium", "low"] },
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
  let recognitionStrategy: "standard" | "alternate" = "standard";
  let recognitionMode: "full" | "top_name" = "full";
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
    recognitionMode = body.recognitionMode === "top_name" ? "top_name" : "full";
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
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${POKEMON_CARD_IDENTIFY_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: mimeType, data: imageBase64 } }, { text: recognitionMode === "top_name" ? topRegionPrompt : `${prompt} ${fieldConfidenceInstruction}${recognitionStrategy === "alternate" ? ` ${alternatePrompt}` : ""}` }] }],
        generationConfig: {
          thinkingConfig: { thinkingLevel: "low" },
          responseFormat: { text: { mimeType: "application/json", schema: recognitionMode === "top_name" ? topRegionResponseSchema : responseSchema } },
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
    console.info("[pokemon-card-identify] raw visual response before parsing", {
      requestId,
      recognitionMode,
      recognitionStrategy,
      rawResponse: text,
    });
    const rawResponse = JSON.parse(text) as unknown;
    if (recognitionMode === "top_name") {
      const topIdentification = normalizePokemonTopRegionIdentification(rawResponse);
      console.info("[pokemon-card-identify] top-region response parsed", {
        requestId,
        recognitionStrategy,
        parsed: topIdentification,
        latencyMs: Date.now() - startedAt,
      });
      return json({
        success: true,
        model: POKEMON_CARD_IDENTIFY_MODEL,
        topIdentification,
        recognitionMode,
        recognitionStrategy,
        ...(debug ? { rawProviderResponse: rawResponse } : {}),
        latencyMs: Date.now() - startedAt,
        requestId,
      }, 200, requestId);
    }
    const identification = normalizePokemonCardIdentification(rawResponse);
    const validation = assessPokemonIdentification(identification);
    console.info("[pokemon-card-identify] Gemini request succeeded", {
      requestId,
      model: POKEMON_CARD_IDENTIFY_MODEL,
      recognitionStrategy,
      recognitionMode,
      latencyMs: Date.now() - startedAt,
      parsed: {
        card_name: identification.card_name,
        pokemon_name: identification.pokemon_name,
        collector_number: identification.collector_number,
        printed_total_number: identification.printed_total_number,
        set_name_hint: identification.set_name_hint,
        set_code_hint: identification.set_code_hint,
        hp: identification.hp,
        stage_or_subtype: identification.stage_or_subtype,
        ability_names: identification.ability_names,
        ability_text_fragments: identification.ability_text_fragments,
        attack_names: identification.attack_names,
        attack_damage: identification.attack_damage,
        attack_text_fragments: identification.attack_text_fragments,
        card_game: identification.card_game,
        language: identification.language,
        confidence: identification.confidence,
        field_confidence: identification.field_confidence,
        visible_text: identification.visible_text,
        artwork_characteristics: identification.artwork_characteristics,
      },
      usefulness: {
        useful: validation.useful,
        rejectedFields: validation.rejectedFields.map((field) => ({ field: field.field, reason: field.reason })),
      },
    });
    return json({
      success: true,
      model: POKEMON_CARD_IDENTIFY_MODEL,
      identification,
      recognitionStrategy,
      validation: { useful: validation.useful, rejectedFields: validation.rejectedFields },
      latencyMs: Date.now() - startedAt,
      requestId,
      ...(debug ? { rawProviderResponse: rawResponse } : {}),
    }, 200, requestId);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    console.warn("[pokemon-card-identify] Gemini response failed", { model: POKEMON_CARD_IDENTIFY_MODEL, timedOut, latencyMs: Date.now() - startedAt });
    return errorResponse(requestId, timedOut ? "GEMINI_TIMEOUT" : "MALFORMED_GEMINI_RESPONSE", timedOut ? "Visual identification timed out. Try again or search manually." : "Visual identification returned an unreadable result.", timedOut ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
});
