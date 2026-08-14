import type { CardCondition, InventoryPurchase, OwnershipShare } from "../../types/models";
import type { CardMatch } from "../sales/cardScanService";
import { conditionAdjustedMarket } from "../../utils/dealBuilder";
import { isSupabaseConfigured, supabase, supabasePublishableKey, supabaseUrl } from "../../utils/supabase";
import { compressSaleImage } from "../images/saleImageService";
import { normalizeImageOrientation } from "../images/imageOrientation";
import { saveInventoryPurchase } from "./inventoryPurchaseRepository";
import { saveInventoryOwnership } from "./ownershipRepository";

export type BulkImportJobStatus = "uploading" | "queued" | "processing" | "review" | "completed" | "cancelled";
export type BulkImportItemStatus = "waiting" | "processing" | "identified" | "needs_review" | "failed" | "confirmed";

export type BulkImportJob = {
  id: string;
  status: BulkImportJobStatus;
  expectedCardGame: "pokemon" | "one_piece";
  expectedLanguage: "en" | "ja";
  originalCount: number;
  uploadedCount: number;
  processedCount: number;
  readyCount: number;
  needsReviewCount: number;
  failedCount: number;
  confirmedCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type BulkImportItem = {
  id: string;
  jobId: string;
  uploadOrder: number;
  status: BulkImportItemStatus;
  attemptCount: number;
  maxAttempts: number;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sourceImagePath: string;
  sourceImageUrl: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  imageHash?: string;
  possibleDuplicate: boolean;
  duplicateOfItemId?: string;
  recognizedName?: string;
  recognizedCollectorNumber?: string;
  recognizedSet?: string;
  recognizedCardGame?: string;
  recognizedLanguage?: string;
  fieldConfidence: Record<string, "high" | "medium" | "low">;
  rawRecognition?: Record<string, unknown>;
  selectedCandidate?: CardMatch;
  alternativeCandidates: CardMatch[];
  candidateScore?: number;
  overallConfidence?: "high" | "medium" | "low";
  condition?: CardCondition;
  baseMarket?: number;
  adjustedMarket?: number;
  marketSource?: string;
  marketVariant?: string;
  marketCurrency?: string;
  marketCheckedAt?: string;
  quantity: number;
  costBasis?: number;
  zeroCostBasisConfirmed: boolean;
  ownershipShares: OwnershipShare[];
  inventoryPurchaseId?: string;
  errorCode?: string;
  errorMessage?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type JobRow = Record<string, unknown>;
type ItemRow = Record<string, unknown>;

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is required for durable bulk import.");
  return supabase;
}

function jobFromRow(row: JobRow): BulkImportJob {
  return {
    id: String(row.id),
    status: row.status as BulkImportJobStatus,
    expectedCardGame: row.expected_card_game as BulkImportJob["expectedCardGame"],
    expectedLanguage: row.expected_language as BulkImportJob["expectedLanguage"],
    originalCount: Number(row.original_count || 0),
    uploadedCount: Number(row.uploaded_count || 0),
    processedCount: Number(row.processed_count || 0),
    readyCount: Number(row.ready_count || 0),
    needsReviewCount: Number(row.needs_review_count || 0),
    failedCount: Number(row.failed_count || 0),
    confirmedCount: Number(row.confirmed_count || 0),
    lastError: row.last_error ? String(row.last_error) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function itemFromRow(row: ItemRow): BulkImportItem {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    uploadOrder: Number(row.upload_order || 0),
    status: row.status as BulkImportItemStatus,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 3),
    originalFilename: String(row.original_filename || "image"),
    mimeType: String(row.mime_type || "image/jpeg"),
    byteSize: Number(row.byte_size || 0),
    sourceImagePath: String(row.source_image_path || ""),
    sourceImageUrl: String(row.source_image_url || ""),
    thumbnailPath: row.thumbnail_path ? String(row.thumbnail_path) : undefined,
    thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : undefined,
    imageHash: row.image_hash ? String(row.image_hash) : undefined,
    possibleDuplicate: Boolean(row.possible_duplicate),
    duplicateOfItemId: row.duplicate_of_item_id ? String(row.duplicate_of_item_id) : undefined,
    recognizedName: row.recognized_name ? String(row.recognized_name) : undefined,
    recognizedCollectorNumber: row.recognized_collector_number ? String(row.recognized_collector_number) : undefined,
    recognizedSet: row.recognized_set ? String(row.recognized_set) : undefined,
    recognizedCardGame: row.recognized_card_game ? String(row.recognized_card_game) : undefined,
    recognizedLanguage: row.recognized_language ? String(row.recognized_language) : undefined,
    fieldConfidence: (row.field_confidence || {}) as BulkImportItem["fieldConfidence"],
    rawRecognition: row.raw_recognition as Record<string, unknown> | undefined,
    selectedCandidate: row.selected_candidate as CardMatch | undefined,
    alternativeCandidates: Array.isArray(row.alternative_candidates) ? row.alternative_candidates as CardMatch[] : [],
    candidateScore: row.candidate_score == null ? undefined : Number(row.candidate_score),
    overallConfidence: row.overall_confidence as BulkImportItem["overallConfidence"],
    condition: row.condition as CardCondition | undefined,
    baseMarket: row.base_market == null ? undefined : Number(row.base_market),
    adjustedMarket: row.adjusted_market == null ? undefined : Number(row.adjusted_market),
    marketSource: row.market_source ? String(row.market_source) : undefined,
    marketVariant: row.market_variant ? String(row.market_variant) : undefined,
    marketCurrency: row.market_currency ? String(row.market_currency) : undefined,
    marketCheckedAt: row.market_checked_at ? String(row.market_checked_at) : undefined,
    quantity: Number(row.quantity || 1),
    costBasis: row.cost_basis == null ? undefined : Number(row.cost_basis),
    zeroCostBasisConfirmed: Boolean(row.zero_cost_basis_confirmed),
    ownershipShares: Array.isArray(row.ownership_shares) ? row.ownership_shares as OwnershipShare[] : [],
    inventoryPurchaseId: row.inventory_purchase_id ? String(row.inventory_purchase_id) : undefined,
    errorCode: row.error_code ? String(row.error_code) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function fileHash(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function thumbnailFile(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "none" });
  try {
    const scale = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create a thumbnail.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not encode thumbnail.")), "image/jpeg", 0.72));
    return new File([blob], "thumbnail.jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

export async function createBulkImportJob(input: { count: number; game: "pokemon" | "one_piece"; language: "en" | "ja"; workerId?: string }) {
  const client = requireSupabase();
  const result = await client.from("bulk_inventory_import_jobs").insert({
    status: "uploading",
    original_count: input.count,
    expected_card_game: input.game,
    expected_language: input.language,
    created_by_worker_id: input.workerId || null,
  }).select("*").single();
  if (result.error) throw new Error(result.error.message);
  return jobFromRow(result.data as JobRow);
}

export async function uploadBulkImportFile(job: BulkImportJob, file: File, uploadOrder: number) {
  const client = requireSupabase();
  if (![/^image\/jpeg$/i, /^image\/png$/i, /^image\/webp$/i].some((pattern) => pattern.test(file.type))) {
    throw new Error(`${file.name}: use JPEG, PNG, or WebP.`);
  }
  const normalized = await normalizeImageOrientation(file);
  const itemId = crypto.randomUUID();
  const [hash, compressed, thumbnail] = await Promise.all([fileHash(normalized), compressSaleImage(normalized), thumbnailFile(normalized)]);
  const sourcePath = `${job.id}/source/${itemId}.jpg`;
  const thumbnailPath = `${job.id}/thumbnails/${itemId}.jpg`;
  const sourceUpload = await client.storage.from("bulk-inventory-imports").upload(sourcePath, compressed, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  if (sourceUpload.error) throw new Error(sourceUpload.error.message);
  const thumbnailUpload = await client.storage.from("bulk-inventory-imports").upload(thumbnailPath, thumbnail, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  if (thumbnailUpload.error) {
    await client.storage.from("bulk-inventory-imports").remove([sourcePath]);
    throw new Error(thumbnailUpload.error.message);
  }
  const sourceUrl = client.storage.from("bulk-inventory-imports").getPublicUrl(sourcePath).data.publicUrl;
  const thumbnailUrl = client.storage.from("bulk-inventory-imports").getPublicUrl(thumbnailPath).data.publicUrl;
  const [duplicate, inventoryDuplicate] = await Promise.all([
    client.from("bulk_inventory_import_items").select("id").eq("image_hash", hash).order("created_at").limit(1).maybeSingle(),
    client.from("inventory_purchases").select("id").eq("image_hash", hash).limit(1).maybeSingle(),
  ]);
  const inserted = await client.from("bulk_inventory_import_items").insert({
    id: itemId,
    job_id: job.id,
    upload_order: uploadOrder,
    status: "waiting",
    original_filename: file.name || `image-${uploadOrder + 1}`,
    mime_type: "image/jpeg",
    byte_size: compressed.size,
    source_image_path: sourcePath,
    source_image_url: sourceUrl,
    thumbnail_path: thumbnailPath,
    thumbnail_url: thumbnailUrl,
    image_hash: hash,
    possible_duplicate: Boolean(duplicate.data || inventoryDuplicate.data),
    duplicate_of_item_id: duplicate.data?.id || null,
  }).select("*").single();
  if (inserted.error) {
    await client.storage.from("bulk-inventory-imports").remove([sourcePath, thumbnailPath]);
    throw new Error(inserted.error.message);
  }
  return itemFromRow(inserted.data as ItemRow);
}

export async function finishBulkImportUpload(jobId: string) {
  const client = requireSupabase();
  const result = await client.from("bulk_inventory_import_jobs").update({ status: "queued", started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId);
  if (result.error) throw new Error(result.error.message);
  await kickBulkImportWorker();
}

export async function kickBulkImportWorker() {
  if (!supabaseUrl || !supabasePublishableKey) throw new Error("Bulk processing is not configured.");
  const response = await fetch(`${supabaseUrl}/functions/v1/bulk-inventory-process`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabasePublishableKey, Authorization: `Bearer ${supabasePublishableKey}` },
    body: "{}",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || "Bulk processing could not start.");
  }
}

export async function listBulkImportJobs(limit = 20) {
  const client = requireSupabase();
  const result = await client.from("bulk_inventory_import_jobs").select("*").order("created_at", { ascending: false }).limit(limit);
  if (result.error) throw new Error(result.error.message);
  return (result.data as JobRow[]).map(jobFromRow);
}

export async function getBulkImportJob(jobId: string) {
  const client = requireSupabase();
  const result = await client.from("bulk_inventory_import_jobs").select("*").eq("id", jobId).single();
  if (result.error) throw new Error(result.error.message);
  return jobFromRow(result.data as JobRow);
}

export async function listBulkImportItems(jobId: string) {
  const client = requireSupabase();
  const result = await client.from("bulk_inventory_import_items").select("*").eq("job_id", jobId).order("upload_order").limit(1000);
  if (result.error) throw new Error(result.error.message);
  return (result.data as ItemRow[]).map(itemFromRow);
}

export async function updateBulkImportItem(itemId: string, patch: Partial<{
  status: BulkImportItemStatus;
  selectedCandidate: CardMatch | null;
  alternativeCandidates: CardMatch[];
  candidateScore: number | null;
  condition: CardCondition | null;
  baseMarket: number | null;
  adjustedMarket: number | null;
  marketSource: string | null;
  marketVariant: string | null;
  marketCurrency: string | null;
  marketCheckedAt: string | null;
  quantity: number;
  costBasis: number | null;
  zeroCostBasisConfirmed: boolean;
  ownershipShares: OwnershipShare[];
  recognizedName: string | null;
  recognizedCollectorNumber: string | null;
  recognizedSet: string | null;
  recognizedCardGame: string | null;
  recognizedLanguage: string | null;
}>) {
  const client = requireSupabase();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.selectedCandidate !== undefined) row.selected_candidate = patch.selectedCandidate;
  if (patch.alternativeCandidates !== undefined) row.alternative_candidates = patch.alternativeCandidates;
  if (patch.candidateScore !== undefined) row.candidate_score = patch.candidateScore;
  if (patch.condition !== undefined) row.condition = patch.condition;
  if (patch.baseMarket !== undefined) row.base_market = patch.baseMarket;
  if (patch.adjustedMarket !== undefined) row.adjusted_market = patch.adjustedMarket;
  if (patch.marketSource !== undefined) row.market_source = patch.marketSource;
  if (patch.marketVariant !== undefined) row.market_variant = patch.marketVariant;
  if (patch.marketCurrency !== undefined) row.market_currency = patch.marketCurrency;
  if (patch.marketCheckedAt !== undefined) row.market_checked_at = patch.marketCheckedAt;
  if (patch.quantity !== undefined) row.quantity = Math.max(1, Math.floor(patch.quantity));
  if (patch.costBasis !== undefined) row.cost_basis = patch.costBasis;
  if (patch.zeroCostBasisConfirmed !== undefined) row.zero_cost_basis_confirmed = patch.zeroCostBasisConfirmed;
  if (patch.ownershipShares !== undefined) row.ownership_shares = patch.ownershipShares;
  if (patch.recognizedName !== undefined) row.recognized_name = patch.recognizedName;
  if (patch.recognizedCollectorNumber !== undefined) row.recognized_collector_number = patch.recognizedCollectorNumber;
  if (patch.recognizedSet !== undefined) row.recognized_set = patch.recognizedSet;
  if (patch.recognizedCardGame !== undefined) row.recognized_card_game = patch.recognizedCardGame;
  if (patch.recognizedLanguage !== undefined) row.recognized_language = patch.recognizedLanguage;
  const result = await client.from("bulk_inventory_import_items").update(row).eq("id", itemId).select("*").single();
  if (result.error) throw new Error(result.error.message);
  return itemFromRow(result.data as ItemRow);
}

export function bulkItemPatchFromMatch(match: CardMatch) {
  const priced = match.pricing?.variants?.find((variant) => Number.isFinite(variant.market)) || match.pricing?.variants?.[0];
  const market = Number.isFinite(match.pricing?.market) ? Number(match.pricing?.market) : Number.isFinite(priced?.market) ? Number(priced?.market) : null;
  return {
    selectedCandidate: match,
    candidateScore: match.matchScore,
    baseMarket: market,
    adjustedMarket: market,
    marketSource: match.pricing?.source || (match.provider === "pokemontcg" ? "TCGplayer" : match.provider === "tcgdex" ? "TCGdex" : "OPTCG API"),
    marketVariant: priced?.name || null,
    marketCurrency: match.pricing?.currency || null,
    marketCheckedAt: new Date().toISOString(),
    status: "identified" as const,
  };
}

export async function retryBulkImportItems(itemIds: string[]) {
  if (!itemIds.length) return;
  const client = requireSupabase();
  const result = await client.from("bulk_inventory_import_items").update({ status: "waiting", attempt_count: 0, next_retry_at: null, locked_at: null, error_code: null, error_message: null, updated_at: new Date().toISOString() }).in("id", itemIds);
  if (result.error) throw new Error(result.error.message);
  await kickBulkImportWorker();
}

export async function deleteBulkImportItems(items: BulkImportItem[]) {
  if (!items.length) return;
  const client = requireSupabase();
  const paths = items.flatMap((item) => [item.sourceImagePath, item.thumbnailPath].filter((path): path is string => Boolean(path)));
  if (paths.length) await client.storage.from("bulk-inventory-imports").remove(paths);
  const result = await client.from("bulk_inventory_import_items").delete().in("id", items.map((item) => item.id));
  if (result.error) throw new Error(result.error.message);
}

export async function confirmBulkImportItem(item: BulkImportItem) {
  if (!item.selectedCandidate) throw new Error("Choose the exact card before confirming it.");
  const candidate = item.selectedCandidate;
  const stableInventoryId = item.inventoryPurchaseId || item.id;
  const costKnown = item.costBasis != null || item.zeroCostBasisConfirmed;
  const marketValue = item.adjustedMarket ?? item.baseMarket;
  const purchase: Partial<InventoryPurchase> = {
    id: stableInventoryId,
    imageUrl: item.sourceImageUrl,
    imagePath: item.sourceImagePath,
    frontImageUrl: item.sourceImageUrl,
    frontImagePath: item.sourceImagePath,
    itemName: candidate.name,
    cardName: candidate.name,
    collectorNumber: candidate.collectorNumber,
    cardSet: candidate.setName,
    cardSetId: candidate.setId,
    cardSetCode: candidate.setCode,
    cardRarity: candidate.rarity,
    cardGame: candidate.game,
    cardLanguage: candidate.language,
    dataProvider: candidate.provider,
    providerCardId: candidate.providerCardId,
    cardCode: candidate.cardCode,
    pokemonTcgCardId: candidate.provider === "pokemontcg" ? candidate.providerCardId : undefined,
    officialCardImageUrl: candidate.imageLarge || candidate.imageSmall,
    tcgplayerUrl: candidate.productUrl,
    category: "raw_card",
    isRawCard: true,
    cardCondition: item.condition,
    quantity: item.quantity,
    quantitySold: 0,
    totalCost: item.costBasis ?? 0,
    costBasisKnown: costKnown,
    zeroCostBasisConfirmed: item.zeroCostBasisConfirmed,
    providerBaseMarket: item.baseMarket,
    marketValue,
    marketPriceSource: item.marketSource,
    marketPriceVariant: item.marketVariant,
    marketPriceCurrency: item.marketCurrency,
    marketPriceCheckedAt: item.marketCheckedAt,
    purchaseDate: new Date().toISOString(),
    purchaseSource: "personal_inventory",
    acquisitionMethod: "existing_inventory_import",
    status: "in_stock",
    scanConfidence: item.overallConfidence,
    scanStatus: "imported",
    imageHash: item.imageHash,
    scanResult: { recognition: item.rawRecognition || {}, alternatives: item.alternativeCandidates },
    ownershipShares: item.ownershipShares,
  };
  const saved = await saveInventoryPurchase(purchase);
  await saveInventoryOwnership(saved.id, item.ownershipShares);
  const client = requireSupabase();
  const updated = await client.from("bulk_inventory_import_items").update({ status: "confirmed", inventory_purchase_id: saved.id, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", item.id);
  if (updated.error) throw new Error(updated.error.message);
  return saved;
}

export function adjustedMarketForCondition(baseMarket: number | undefined, condition: CardCondition | undefined) {
  if (baseMarket == null) return undefined;
  return condition ? conditionAdjustedMarket(baseMarket, condition) : baseMarket;
}
