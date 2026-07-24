import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 6 * 1024 * 1024;
const rateWindowMs = 60_000;
const rateLimit = 10;
const requestsByClient = new Map<string, number[]>();

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function validateImage(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} image is required.`);
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match || !allowedImageTypes.has(match[1].toLowerCase())) {
    throw new Error(`${label} image must be JPEG, PNG, or WebP.`);
  }
  const bytes = Math.floor(match[2].replace(/\s/g, "").length * 3 / 4);
  if (bytes <= 0 || bytes > maxImageBytes) throw new Error(`${label} image must be smaller than 6 MB.`);
  return { dataUrl: value, type: match[1].toLowerCase(), bytes };
}

function enforceRateLimit(request: Request) {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const recent = (requestsByClient.get(client) || []).filter((time) => now - time < rateWindowMs);
  if (recent.length >= rateLimit) return false;
  recent.push(now);
  requestsByClient.set(client, recent);
  return true;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);
  console.info("card-scan: request received");

  try {
    if (!enforceRateLimit(request)) return json({ success: false, error: "Too many scan requests. Try again in one minute." }, 429);
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      console.error("card-scan: failure stage=configuration missing=OPENAI_API_KEY");
      return json({ success: false, error: "Card scanning is not configured. Missing server secret: OPENAI_API_KEY." }, 503);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: "Request body must be valid JSON." }, 400);
    }
    const requestedType = body.requestedType === "slab" ? "graded_card" : body.requestedType;
    if (requestedType !== "raw_card" && requestedType !== "graded_card") {
      return json({ success: false, error: "Card type must be raw_card or slab." }, 400);
    }
    const front = validateImage(body.frontImage, "Front");
    const back = body.backImage ? validateImage(body.backImage, "Back") : null;
    console.info("card-scan: image validated", { frontType: front.type, frontBytes: front.bytes, backType: back?.type, backBytes: back?.bytes || 0, requestedType });

    const content: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text: `Analyze this Pokémon card as a careful inventory assistant. Requested type: ${requestedType}.
Return suggestions only. Never infer actual purchase cost. Sticker/asking price is a separate field.
Inspect the top for card name, bottom for collector number/set, stickers for condition/asking price, and slab labels for company/grade/certificate.
Use null when unclear. Never assume condition. Only return stickerPrice when a visible price sticker or explicit dollar amount is present.
Do not estimate market value, bought price, or sold price. Confidence values must be high, medium, or low.`,
      },
      { type: "input_image", image_url: front.dataUrl, detail: "high" },
    ];
    if (back) content.push({ type: "input_image", image_url: back.dataUrl, detail: "high" });

    console.info("card-scan: analysis started");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: Deno.env.get("OPENAI_CARD_SCAN_MODEL") || "gpt-4.1-mini",
          input: [{ role: "user", content }],
          text: { format: {
            type: "json_schema", name: "pokemon_card_scan", strict: true,
            schema: {
              type: "object", additionalProperties: false,
              properties: {
                suggestedType: { type: ["string", "null"], enum: ["raw_card", "graded_card", null] },
                cardName: { type: ["string", "null"] }, collectorNumber: { type: ["string", "null"] },
                cardSet: { type: ["string", "null"] }, language: { type: ["string", "null"] },
                condition: { type: ["string", "null"], enum: ["Mint", "Near Mint / NM", "Lightly Played / LP", "Moderately Played / MP", "Heavily Played / HP", "Damaged", null] },
                stickerPrice: { type: ["number", "null"] }, gradingCompany: { type: ["string", "null"] },
                grade: { type: ["string", "null"] }, certificateNumber: { type: ["string", "null"] },
                labelInformation: { type: ["string", "null"] }, barcodeText: { type: ["string", "null"] },
                overallConfidence: { type: "string", enum: ["high", "medium", "low"] },
                fieldConfidence: {
                  type: "object", additionalProperties: false,
                  properties: Object.fromEntries(["cardName", "collectorNumber", "cardSet", "language", "condition", "stickerPrice", "gradingCompany", "grade", "certificateNumber"].map((key) => [key, { type: "string", enum: ["high", "medium", "low"] }])),
                  required: ["cardName", "collectorNumber", "cardSet", "language", "condition", "stickerPrice", "gradingCompany", "grade", "certificateNumber"],
                },
              },
              required: ["suggestedType", "cardName", "collectorNumber", "cardSet", "language", "condition", "stickerPrice", "gradingCompany", "grade", "certificateNumber", "labelInformation", "barcodeText", "overallConfidence", "fieldConfidence"],
            },
          } },
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
    console.info("card-scan: provider response", { status: response.status });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("card-scan: failure stage=provider", { status: response.status });
      return json({ success: false, error: response.status === 429 ? "The scanner provider is temporarily rate limited. Try again shortly." : "Provider rejected the image or analysis request." }, 502);
    }
    const outputText = payload.output_text || payload.output?.flatMap((item: { content?: unknown[] }) => item.content || []).find((item: { type?: string }) => item.type === "output_text")?.text;
    if (!outputText) return json({ success: false, error: "Card analysis returned no structured result." }, 502);
    const scan = JSON.parse(outputText);
    console.info("card-scan: structured parsing completed");
    return json({
      success: true, cardType: scan.suggestedType,
      suggestions: {
        cardName: scan.cardName, collectorNumber: scan.collectorNumber, setName: scan.cardSet,
        language: scan.language, condition: scan.condition, stickerPrice: scan.stickerPrice,
        gradingCompany: scan.gradingCompany, grade: scan.grade, certificateNumber: scan.certificateNumber,
        labelInformation: scan.labelInformation, barcodeText: scan.barcodeText,
      },
      confidence: scan.fieldConfidence, overallConfidence: scan.overallConfidence, warnings: [],
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    console.error("card-scan: failure stage=unexpected", { name: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : "unknown" });
    return json({ success: false, error: timedOut ? "Card analysis timed out. Please retry." : error instanceof Error ? error.message : "Card analysis failed." }, timedOut ? 504 : 400);
  }
});
