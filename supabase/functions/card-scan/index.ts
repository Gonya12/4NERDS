import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for the card-scan function.");
    const { frontImage, backImage, requestedType } = await request.json();
    if (!frontImage) throw new Error("A front image is required.");

    const content: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text: `Analyze this Pokémon product image as a careful inventory assistant. Requested type: ${requestedType || "unknown"}.
Return suggestions only. Do not infer actual purchase cost. Sticker/asking price is a separate field.
Inspect the top for card name, bottom for collector number/set, stickers for condition/asking price, and slab labels for company/grade/certificate.
Use null when unclear. Never assume condition. Only return stickerPrice when a visible price sticker or explicit dollar amount is present.
Do not estimate market value, bought price, or sold price. Confidence values must be high, medium, or low.`,
      },
      { type: "input_image", image_url: frontImage, detail: "high" },
    ];
    if (backImage) content.push({ type: "input_image", image_url: backImage, detail: "high" });

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_CARD_SCAN_MODEL") || "gpt-4.1-mini",
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: "pokemon_card_scan",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                suggestedType: { type: ["string", "null"], enum: ["raw_card", "graded_card", "sealed_product", "other_pokemon_product", null] },
                cardName: { type: ["string", "null"] },
                collectorNumber: { type: ["string", "null"] },
                cardSet: { type: ["string", "null"] },
                language: { type: ["string", "null"] },
                condition: { type: ["string", "null"], enum: ["Mint", "Near Mint / NM", "Lightly Played / LP", "Moderately Played / MP", "Heavily Played / HP", "Damaged", null] },
                stickerPrice: { type: ["number", "null"] },
                gradingCompany: { type: ["string", "null"] },
                grade: { type: ["string", "null"] },
                certificateNumber: { type: ["string", "null"] },
                labelInformation: { type: ["string", "null"] },
                barcodeText: { type: ["string", "null"] },
                overallConfidence: { type: "string", enum: ["high", "medium", "low"] },
                fieldConfidence: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    cardName: { type: "string", enum: ["high", "medium", "low"] },
                    collectorNumber: { type: "string", enum: ["high", "medium", "low"] },
                    cardSet: { type: "string", enum: ["high", "medium", "low"] },
                    language: { type: "string", enum: ["high", "medium", "low"] },
                    condition: { type: "string", enum: ["high", "medium", "low"] },
                    stickerPrice: { type: "string", enum: ["high", "medium", "low"] },
                    gradingCompany: { type: "string", enum: ["high", "medium", "low"] },
                    grade: { type: "string", enum: ["high", "medium", "low"] },
                    certificateNumber: { type: "string", enum: ["high", "medium", "low"] },
                  },
                  required: ["cardName", "collectorNumber", "cardSet", "language", "condition", "stickerPrice", "gradingCompany", "grade", "certificateNumber"],
                },
              },
              required: ["suggestedType", "cardName", "collectorNumber", "cardSet", "language", "condition", "stickerPrice", "gradingCompany", "grade", "certificateNumber", "labelInformation", "barcodeText", "overallConfidence", "fieldConfidence"],
            },
          },
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || "Card analysis failed.");
    const outputText = payload.output_text || payload.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("Card analysis returned no result.");
    const scan = JSON.parse(outputText);
    return new Response(JSON.stringify({
      success: true,
      cardType: scan.suggestedType,
      suggestions: {
        cardName: scan.cardName,
        collectorNumber: scan.collectorNumber,
        setName: scan.cardSet,
        language: scan.language,
        condition: scan.condition,
        stickerPrice: scan.stickerPrice,
        gradingCompany: scan.gradingCompany,
        grade: scan.grade,
        certificateNumber: scan.certificateNumber,
        labelInformation: scan.labelInformation,
        barcodeText: scan.barcodeText,
      },
      confidence: scan.fieldConfidence,
      overallConfidence: scan.overallConfidence,
      warnings: [],
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Card analysis failed." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
