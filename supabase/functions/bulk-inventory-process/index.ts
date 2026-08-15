import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  assessPokemonIdentification,
  buildPokemonIdentificationSearchAttempts,
  isStrongVisualCatalogMatch,
  normalizePokemonCardIdentification,
  rankScannerCandidates,
  scannerCandidateEvidence,
  selectScannerCandidates,
  type PokemonCardIdentification,
} from "../_shared/pokemonCardIdentificationCore.ts";
import type { UnifiedCardMatch } from "../_shared/unifiedCardSearchCore.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const batchSize = 2;

type QueueItem = {
  id: string;
  job_id: string;
  attempt_count: number;
  max_attempts: number;
  source_image_path: string;
  mime_type: string;
  image_hash?: string | null;
  raw_recognition?: Record<string, unknown> | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  return btoa(binary);
}

function pricingFor(match?: UnifiedCardMatch) {
  if (!match?.pricing) return { market: null, variant: null, source: null, currency: null, checkedAt: null };
  const variants = match.pricing.variants || [];
  const priced = variants.length === 1 ? variants[0] : undefined;
  const market = variants.length > 1
    ? null
    : Number.isFinite(priced?.market) ? Number(priced?.market)
      : Number.isFinite(match.pricing.market) ? Number(match.pricing.market) : null;
  return {
    market,
    variant: priced?.name || null,
    source: match.pricing.source || (match.provider === "pokemontcg" ? "TCGplayer" : match.provider === "tcgdex" ? "TCGdex" : "OPTCG API"),
    currency: match.pricing.currency || null,
    checkedAt: new Date().toISOString(),
  };
}

async function edgePost(baseUrl: string, serviceKey: string, functionName: string, body: unknown, allowRetry = true) {
  let lastPayload: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    lastPayload = payload;
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    const retryableEmpty = response.ok && rows.length === 0 && Number(payload?.providerResponseStatus || 0) >= 500;
    if (response.ok && !retryableEmpty) return payload || {};
    if (allowRetry && attempt === 0 && (response.status === 429 || response.status >= 500 || retryableEmpty)) continue;
    const error = new Error(String(payload?.message || payload?.error || `${functionName} failed with HTTP ${response.status}.`)) as Error & { code?: string };
    error.code = String(payload?.code || `HTTP_${response.status}`);
    throw error;
  }
  return lastPayload || {};
}

async function findCandidates(baseUrl: string, serviceKey: string, identification: PokemonCardIdentification) {
  const evidence = scannerCandidateEvidence(identification);
  const game = identification.card_game === "one_piece" ? "one_piece" : "pokemon";
  const groups: UnifiedCardMatch[][] = [];
  const queryHistory: string[] = [];
  for (const attempt of buildPokemonIdentificationSearchAttempts(identification)) {
    const query = [attempt.name, attempt.collectorNumber, attempt.set, attempt.abilityName, attempt.attackName].filter(Boolean).join(" ");
    queryHistory.push(query);
    const payload = await edgePost(baseUrl, serviceKey, "pokemon-card-search", {
      game,
      language: game === "pokemon" && identification.language === "ja" ? "ja" : "en",
      name: attempt.name || null,
      collectorNumber: attempt.collectorNumber || null,
      set: attempt.set || null,
      abilityName: attempt.abilityName || null,
      attackName: attempt.attackName || null,
      query,
      page: 1,
      pageSize: 20,
      disableCorrection: true,
    });
    const raw = Array.isArray(payload.results) ? payload.results as UnifiedCardMatch[] : [];
    groups.push(rankScannerCandidates(raw, evidence));
    const merged = selectScannerCandidates(groups.flat());
    if (merged.length >= 5 || merged[0]?.matchScore >= 92) return { matches: merged, queryHistory };
  }
  return { matches: selectScannerCandidates(groups.flat()), queryHistory };
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function downloadBase64(supabase: ReturnType<typeof createClient>, path: string) {
  const downloaded = await supabase.storage.from("bulk-inventory-imports").download(path);
  if (downloaded.error || !downloaded.data) throw new Error(downloaded.error?.message || "Prepared recognition image could not be downloaded.");
  return bytesToBase64(new Uint8Array(await downloaded.data.arrayBuffer()));
}

async function reuseCachedRecognition(item: QueueItem, supabase: ReturnType<typeof createClient>) {
  if (!item.image_hash) return null;
  const cached = await supabase.from("bulk_inventory_import_items")
    .select("id,status,recognized_name,recognized_collector_number,recognized_set,recognized_card_game,recognized_language,field_confidence,raw_recognition,selected_candidate,alternative_candidates,candidate_score,overall_confidence,condition,base_market,adjusted_market,market_source,market_variant,market_currency,market_checked_at,error_code,error_message")
    .eq("image_hash", item.image_hash)
    .neq("id", item.id)
    .in("status", ["identified", "needs_review", "failed"])
    .order("created_at", { ascending: true })
    .limit(10);
  if (cached.error) throw new Error(cached.error.message);
  const source = (cached.data || []).find((row) => {
    const raw = objectValue(row.raw_recognition);
    return objectValue(raw.costPolicy).model === "gpt-5.6-luna";
  });
  if (!source) return null;
  const sourceRaw = objectValue(source.raw_recognition);
  const targetRaw = objectValue(item.raw_recognition);
  const updated = await supabase.from("bulk_inventory_import_items").update({
    status: source.status,
    locked_at: null,
    recognized_name: source.recognized_name,
    recognized_collector_number: source.recognized_collector_number,
    recognized_set: source.recognized_set,
    recognized_card_game: source.recognized_card_game,
    recognized_language: source.recognized_language,
    field_confidence: source.field_confidence,
    raw_recognition: {
      ...sourceRaw,
      preprocessing: objectValue(targetRaw.preprocessing),
      cache: { hit: true, sourceItemId: source.id, imageHash: item.image_hash },
      costPolicy: { ...objectValue(sourceRaw.costPolicy), callsMade: 0, cacheHit: true },
    },
    selected_candidate: source.selected_candidate,
    alternative_candidates: source.alternative_candidates,
    candidate_score: source.candidate_score,
    overall_confidence: source.overall_confidence,
    condition: source.condition,
    base_market: source.base_market,
    adjusted_market: source.adjusted_market,
    market_source: source.market_source,
    market_variant: source.market_variant,
    market_currency: source.market_currency,
    market_checked_at: source.market_checked_at,
    possible_duplicate: true,
    duplicate_of_item_id: source.id,
    error_code: source.error_code,
    error_message: source.error_message,
    updated_at: new Date().toISOString(),
  }).eq("id", item.id);
  if (updated.error) throw new Error(updated.error.message);
  return { id: item.id, status: source.status, cached: true };
}

async function processItem(
  item: QueueItem,
  supabase: ReturnType<typeof createClient>,
  baseUrl: string,
  serviceKey: string,
) {
  try {
    const rawBefore = objectValue(item.raw_recognition);
    const explicitRetry = typeof rawBefore.retryRequestedAt === "string";
    if (!explicitRetry) {
      const cached = await reuseCachedRecognition(item, supabase);
      if (cached) return cached;
    }
    const preprocessing = objectValue(rawBefore.preprocessing);
    const recognitionImagePath = typeof preprocessing.recognitionImagePath === "string" ? preprocessing.recognitionImagePath : "";
    if (!recognitionImagePath) {
      throw Object.assign(new Error("A reliable physical-card crop is required before OpenAI recognition."), { code: "CARD_CROP_REQUIRED" });
    }

    const imageBase64 = await downloadBase64(supabase, recognitionImagePath);
    const recognition = await edgePost(baseUrl, serviceKey, "pokemon-card-identify", {
      imageBase64,
      mimeType: item.mime_type,
      recognitionStrategy: "standard",
      recognitionMode: "details",
    }, false);
    const rawIdentification = normalizePokemonCardIdentification(recognition.identification);
    const usefulness = assessPokemonIdentification(rawIdentification);
    const recognitionAttempts: Array<Record<string, unknown>> = [{
      strategy: "details",
      identification: rawIdentification,
      useful: usefulness.useful,
      rejectedFields: usefulness.rejectedFields,
      telemetry: recognition.telemetry,
    }];
    const identification = usefulness.searchIdentification;
    const candidateResult = usefulness.useful
      ? await findCandidates(baseUrl, serviceKey, identification)
      : { matches: [] as UnifiedCardMatch[], queryHistory: [] as string[] };
    if (!usefulness.useful) {
      const noDetails = await supabase.from("bulk_inventory_import_items").update({
        status: "failed",
        locked_at: null,
        recognized_name: null,
        recognized_collector_number: usefulness.recognizedCollectorNumber,
        recognized_set: null,
        recognized_card_game: rawIdentification.card_game,
        recognized_language: rawIdentification.language,
        field_confidence: rawIdentification.field_confidence,
        raw_recognition: {
          preprocessing,
          recognitionAttempts,
          usefulness,
          costPolicy: { model: "gpt-5.6-luna", callsMade: 1, maximumCalls: 1, retryCount: 0, cacheHit: false },
        },
        overall_confidence: "low",
        error_code: "NO_USEFUL_DETAILS",
        error_message: "The single bounded visual pass found no safe card name or content fingerprint. Use manual card search, adjust the crop, or explicitly retry AI recognition.",
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      if (noDetails.error) throw new Error(noDetails.error.message);
      return { id: item.id, status: "failed" };
    }
    const { matches, queryHistory } = candidateResult;
    const selected = matches[0];
    const strong = isStrongVisualCatalogMatch(identification, matches);
    const pricing = pricingFor(selected);
    const [duplicate, inventoryDuplicate] = item.image_hash
      ? await Promise.all([
          supabase.from("bulk_inventory_import_items").select("id").eq("image_hash", item.image_hash).neq("id", item.id).order("created_at").limit(1).maybeSingle(),
          supabase.from("inventory_purchases").select("id").eq("image_hash", item.image_hash).limit(1).maybeSingle(),
        ])
      : [{ data: null, error: null }, { data: null, error: null }];
    const nextStatus = strong && (selected?.pricing?.variants?.length || 0) <= 1 ? "identified" : "needs_review";
    const update = await supabase.from("bulk_inventory_import_items").update({
      status: nextStatus,
      locked_at: null,
      recognized_name: identification.card_name || identification.pokemon_name,
      recognized_collector_number: identification.collector_number,
      recognized_set: identification.set_name_hint || identification.set_code_hint,
      recognized_card_game: identification.card_game,
      recognized_language: identification.language,
      field_confidence: identification.field_confidence,
      raw_recognition: {
        ...identification,
        preprocessing,
        queryHistory,
        recognitionAttempts,
        usefulness,
        costPolicy: { model: "gpt-5.6-luna", callsMade: 1, maximumCalls: 1, retryCount: 0, cacheHit: false },
      },
      selected_candidate: selected || null,
      alternative_candidates: matches.slice(1, 5),
      candidate_score: selected?.matchScore ?? null,
      overall_confidence: strong ? "high" : identification.confidence >= 0.4 ? "medium" : "low",
      condition: null,
      base_market: pricing.market,
      adjusted_market: null,
      market_source: pricing.source,
      market_variant: pricing.variant,
      market_currency: pricing.currency,
      market_checked_at: pricing.checkedAt,
      possible_duplicate: Boolean(duplicate.data || inventoryDuplicate.data),
      duplicate_of_item_id: duplicate.data?.id || null,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    if (update.error) throw new Error(update.error.message);
    return { id: item.id, status: nextStatus };
  } catch (unknownError) {
    const error = unknownError as Error & { code?: string };
    const code = error.code || "PROCESSING_FAILED";
    await supabase.from("bulk_inventory_import_items").update({
      status: "failed",
      locked_at: null,
      next_retry_at: null,
      error_code: code,
      error_message: `${String(error.message || "Bulk recognition failed.").slice(0, 430)} Automatic retries are disabled to prevent duplicate OpenAI charges; use Retry AI Recognition explicitly.`,
      raw_recognition: {
        ...objectValue(item.raw_recognition),
        costPolicy: { model: "gpt-5.6-luna", maximumCalls: 1, automaticRetry: false, cacheHit: false, failed: true },
      },
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    return { id: item.id, status: "failed", error: error.message };
  }
}

async function runWorker(baseUrl: string, serviceKey: string) {
  const supabase = createClient(baseUrl, serviceKey, { auth: { persistSession: false } });
  const claimed = await supabase.rpc("claim_bulk_inventory_import_items", { p_limit: batchSize });
  if (claimed.error) throw new Error(claimed.error.message);
  const items = (claimed.data || []) as QueueItem[];
  const results = [];
  for (const item of items) results.push(await processItem(item, supabase, baseUrl, serviceKey));
  const remaining = await supabase.from("bulk_inventory_import_items").select("id", { count: "exact", head: true }).in("status", ["waiting", "processing"]);
  return { processed: results, hasMore: Number(remaining.count || 0) > 0 };
}

async function continueWorker(baseUrl: string, serviceKey: string) {
  await new Promise((resolve) => setTimeout(resolve, 750));
  await fetch(`${baseUrl}/functions/v1/bulk-inventory-process`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    body: "{}",
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, code: "METHOD_NOT_ALLOWED" }, 405);
  const baseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const suppliedKey = request.headers.get("apikey") || "";
  if (!baseUrl || !serviceKey) return json({ success: false, code: "WORKER_NOT_CONFIGURED" }, 503);
  if (!suppliedKey || (suppliedKey !== anonKey && suppliedKey !== serviceKey)) return json({ success: false, code: "UNAUTHORIZED" }, 401);
  try {
    const result = await runWorker(baseUrl, serviceKey);
    if (result.hasMore) EdgeRuntime.waitUntil(continueWorker(baseUrl, serviceKey));
    return json({ success: true, ...result }, 202);
  } catch (error) {
    console.error("[bulk-inventory-process] worker failed", { message: error instanceof Error ? error.message : "Unknown worker failure" });
    return json({ success: false, code: "WORKER_FAILED", message: error instanceof Error ? error.message : "Worker failed." }, 500);
  }
});
