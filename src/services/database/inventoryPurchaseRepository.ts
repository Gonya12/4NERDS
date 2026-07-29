import type { InventoryPurchase, InventoryStatus, PokemonProductCategory, PurchaseSource } from "../../types/models";
import { id, nowIso } from "../../utils/normalize";
import { isSupabaseConfigured, recordSupabaseRequest, setSupabaseStatus, startSupabaseQueryTrace, supabase } from "../../utils/supabase";
import { fileToDataUrl, uploadFinancialImage } from "../images/saleImageService";

const localKey = "4nerds_inventory_purchases_local_v1";
const cacheKey = "4nerds_inventory_purchases_cache_v1";

function canonicalCardLanguage(value: string | undefined, cardGame: InventoryPurchase["cardGame"]) {
  if (value === "ja" || /japanese/i.test(value || "")) return "ja";
  if (value === "unknown" || cardGame === "other") return "unknown";
  return "en";
}

type PurchaseRow = {
  id: string;
  image_url?: string | null;
  image_path?: string | null;
  item_name: string;
  category: PokemonProductCategory;
  quantity: number;
  quantity_sold?: number | null;
  purchase_date: string;
  total_cost: number;
  market_value?: number | null;
  market_price_source?: string | null;
  market_price_variant?: string | null;
  market_price_updated_at?: string | null;
  market_price_checked_at?: string | null;
  is_raw_card: boolean;
  buy_percentage?: number | null;
  target_buy_price?: number | null;
  purchase_source?: PurchaseSource | null;
  seller?: string | null;
  event_id?: string | null;
  purchased_by_worker_id?: string | null;
  notes?: string | null;
  status: InventoryStatus;
  sold_price?: number | null;
  sold_date?: string | null;
  sold_by_worker_id?: string | null;
  sold_event_id?: string | null;
  sold_payment_method?: InventoryPurchase["soldPaymentMethod"] | null;
  buyer_note?: string | null;
  card_name?: string | null;
  collector_number?: string | null;
  card_set?: string | null;
  card_set_id?: string | null;
  card_set_code?: string | null;
  card_rarity?: string | null;
  card_game?: InventoryPurchase["cardGame"] | null;
  card_language?: string | null;
  data_provider?: InventoryPurchase["dataProvider"] | null;
  provider_card_id?: string | null;
  card_code?: string | null;
  market_price_currency?: string | null;
  pokemon_tcg_card_id?: string | null;
  official_card_image_url?: string | null;
  tcgplayer_url?: string | null;
  card_condition?: InventoryPurchase["cardCondition"] | null;
  sticker_price?: number | null;
  grading_company?: string | null;
  grade?: string | null;
  certificate_number?: string | null;
  front_image_url?: string | null;
  front_image_path?: string | null;
  back_image_url?: string | null;
  back_image_path?: string | null;
  scan_confidence?: InventoryPurchase["scanConfidence"] | null;
  scan_status?: InventoryPurchase["scanStatus"] | null;
  image_hash?: string | null;
  scan_result?: Record<string, unknown> | null;
  acquisition_method?: InventoryPurchase["acquisitionMethod"] | null;
  acquired_financial_transaction_id?: string | null;
  disposed_financial_transaction_id?: string | null;
  traded_at?: string | null;
  agreed_trade_value?: number | null;
  prior_inventory_purchase_id?: string | null;
  financial_transaction_id?: string | null;
  financial_transaction_item_id?: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: PurchaseRow): InventoryPurchase {
  return {
    id: row.id,
    imageUrl: row.image_url || undefined,
    imagePath: row.image_path || undefined,
    itemName: row.item_name,
    category: row.category || "other_pokemon_product",
    quantity: Number(row.quantity || 1),
    quantitySold: Math.max(0, Number(row.quantity_sold || 0)),
    purchaseDate: row.purchase_date,
    totalCost: Number(row.total_cost || 0),
    marketValue: row.market_value === null || row.market_value === undefined ? undefined : Number(row.market_value),
    marketPriceSource: row.market_price_source || undefined,
    marketPriceVariant: row.market_price_variant || undefined,
    marketPriceUpdatedAt: row.market_price_updated_at || undefined,
    marketPriceCheckedAt: row.market_price_checked_at || undefined,
    isRawCard: Boolean(row.is_raw_card),
    buyPercentage: row.buy_percentage === null || row.buy_percentage === undefined ? undefined : Number(row.buy_percentage),
    targetBuyPrice: row.target_buy_price === null || row.target_buy_price === undefined ? undefined : Number(row.target_buy_price),
    purchaseSource: row.purchase_source || undefined,
    seller: row.seller || undefined,
    eventId: row.event_id || undefined,
    purchasedByWorkerId: row.purchased_by_worker_id || undefined,
    notes: row.notes || undefined,
    status: row.status || "in_stock",
    soldPrice: row.sold_price === null || row.sold_price === undefined ? undefined : Number(row.sold_price),
    soldDate: row.sold_date || undefined,
    soldByWorkerId: row.sold_by_worker_id || undefined,
    soldEventId: row.sold_event_id || undefined,
    soldPaymentMethod: row.sold_payment_method || undefined,
    buyerNote: row.buyer_note || undefined,
    cardName: row.card_name || undefined,
    collectorNumber: row.collector_number || undefined,
    cardSet: row.card_set || undefined,
    cardSetId: row.card_set_id || undefined,
    cardSetCode: row.card_set_code || undefined,
    cardRarity: row.card_rarity || undefined,
    cardGame: row.card_game || undefined,
    cardLanguage: row.card_language || undefined,
    dataProvider: row.data_provider || undefined,
    providerCardId: row.provider_card_id || undefined,
    cardCode: row.card_code || undefined,
    marketPriceCurrency: row.market_price_currency || undefined,
    pokemonTcgCardId: row.pokemon_tcg_card_id || undefined,
    officialCardImageUrl: row.official_card_image_url || undefined,
    tcgplayerUrl: row.tcgplayer_url || undefined,
    cardCondition: row.card_condition || undefined,
    stickerPrice: row.sticker_price == null ? undefined : Number(row.sticker_price),
    gradingCompany: row.grading_company || undefined,
    grade: row.grade || undefined,
    certificateNumber: row.certificate_number || undefined,
    frontImageUrl: row.front_image_url || undefined,
    frontImagePath: row.front_image_path || undefined,
    backImageUrl: row.back_image_url || undefined,
    backImagePath: row.back_image_path || undefined,
    scanConfidence: row.scan_confidence || undefined,
    scanStatus: row.scan_status || "not_scanned",
    imageHash: row.image_hash || undefined,
    scanResult: row.scan_result || undefined,
    acquisitionMethod: row.acquisition_method || "purchased",
    acquiredFinancialTransactionId: row.acquired_financial_transaction_id || undefined,
    disposedFinancialTransactionId: row.disposed_financial_transaction_id || undefined,
    tradedAt: row.traded_at || undefined,
    agreedTradeValue: row.agreed_trade_value == null ? undefined : Number(row.agreed_trade_value),
    priorInventoryPurchaseId: row.prior_inventory_purchase_id || undefined,
    financialTransactionId: row.financial_transaction_id || undefined,
    financialTransactionItemId: row.financial_transaction_item_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function buildInventoryPurchasePayload(value: InventoryPurchase): PurchaseRow {
  const cardGame = value.cardGame || (value.pokemonTcgCardId ? "pokemon" : "other");
  const dataProvider = value.dataProvider || (value.pokemonTcgCardId ? "pokemontcg" : "manual");
  return {
    id: value.id,
    image_url: value.imageUrl || null,
    image_path: value.imagePath || null,
    item_name: value.itemName,
    category: value.category,
    quantity: Number(value.quantity || 1),
    quantity_sold: Math.max(0, Number(value.quantitySold || 0)),
    purchase_date: value.purchaseDate,
    total_cost: Number(value.totalCost || 0),
    market_value: value.marketValue ?? null,
    market_price_source: value.marketPriceSource || null,
    market_price_variant: value.marketPriceVariant || null,
    market_price_updated_at: value.marketPriceUpdatedAt || null,
    market_price_checked_at: value.marketPriceCheckedAt || null,
    is_raw_card: Boolean(value.isRawCard),
    buy_percentage: value.buyPercentage ?? null,
    target_buy_price: value.targetBuyPrice ?? null,
    purchase_source: value.purchaseSource || null,
    seller: value.seller || null,
    event_id: value.eventId || null,
    purchased_by_worker_id: value.purchasedByWorkerId || null,
    notes: value.notes || null,
    status: value.status,
    sold_price: value.soldPrice ?? null,
    sold_date: value.soldDate || null,
    sold_by_worker_id: value.soldByWorkerId || null,
    sold_event_id: value.soldEventId || null,
    sold_payment_method: value.soldPaymentMethod || null,
    buyer_note: value.buyerNote || null,
    card_name: value.cardName || null,
    collector_number: value.collectorNumber || null,
    card_set: value.cardSet || null,
    card_set_id: value.cardSetId || null,
    card_set_code: value.cardSetCode || null,
    card_rarity: value.cardRarity || null,
    card_game: cardGame,
    card_language: canonicalCardLanguage(value.cardLanguage, cardGame),
    data_provider: dataProvider,
    provider_card_id: dataProvider === "manual" ? null : value.providerCardId || value.pokemonTcgCardId || null,
    card_code: value.cardCode || null,
    market_price_currency: value.marketPriceCurrency || null,
    pokemon_tcg_card_id: dataProvider === "pokemontcg" ? value.pokemonTcgCardId || value.providerCardId || null : null,
    official_card_image_url: value.officialCardImageUrl || null,
    tcgplayer_url: value.tcgplayerUrl || null,
    card_condition: value.cardCondition || null,
    sticker_price: value.stickerPrice ?? null,
    grading_company: value.gradingCompany || null,
    grade: value.grade || null,
    certificate_number: value.certificateNumber || null,
    front_image_url: value.frontImageUrl || value.imageUrl || null,
    front_image_path: value.frontImagePath || value.imagePath || null,
    back_image_url: value.backImageUrl || null,
    back_image_path: value.backImagePath || null,
    scan_confidence: value.scanConfidence || null,
    scan_status: value.scanStatus || "not_scanned",
    image_hash: value.imageHash || null,
    scan_result: value.scanResult || null,
    acquisition_method: value.acquisitionMethod || "purchased",
    acquired_financial_transaction_id: value.acquiredFinancialTransactionId || null,
    disposed_financial_transaction_id: value.disposedFinancialTransactionId || null,
    traded_at: value.tradedAt || null,
    agreed_trade_value: value.agreedTradeValue ?? null,
    prior_inventory_purchase_id: value.priorInventoryPurchaseId || null,
    financial_transaction_id: value.financialTransactionId || null,
    financial_transaction_item_id: value.financialTransactionItemId || null,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}

function withoutManualSearchColumns(row: PurchaseRow) {
  const {
    card_set_id: _cardSetId,
    card_set_code: _cardSetCode,
    card_rarity: _cardRarity,
    card_game: _cardGame,
    card_language: _cardLanguage,
    data_provider: _dataProvider,
    provider_card_id: _providerCardId,
    card_code: _cardCode,
    market_price_currency: _marketPriceCurrency,
    pokemon_tcg_card_id: _pokemonTcgCardId,
    official_card_image_url: _officialCardImageUrl,
    tcgplayer_url: _tcgplayerUrl,
    ...legacy
  } = row;
  return legacy;
}

function withoutTradeColumns(row: PurchaseRow) {
  const {
    acquisition_method: _acquisitionMethod,
    acquired_financial_transaction_id: _acquiredFinancialTransactionId,
    disposed_financial_transaction_id: _disposedFinancialTransactionId,
    traded_at: _tradedAt,
    agreed_trade_value: _agreedTradeValue,
    prior_inventory_purchase_id: _priorInventoryPurchaseId,
    financial_transaction_id: _financialTransactionId,
    financial_transaction_item_id: _financialTransactionItemId,
    ...legacy
  } = row;
  return legacy;
}

function isMissingColumnError(error?: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42703" || error.code === "PGRST204" || /column .* does not exist|schema cache/i.test(error.message || "")));
}

function read(key: string) {
  try { return JSON.parse(localStorage.getItem(key) || "[]") as InventoryPurchase[]; } catch { return []; }
}

function write(key: string, values: InventoryPurchase[]) {
  try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* Cache is optional. */ }
}

export function getCachedInventoryPurchases() {
  return read(cacheKey);
}

export async function listInventoryPurchases(limit = 100) {
  if (!isSupabaseConfigured || !supabase) return read(localKey);
  const columns = "id,image_url,image_path,item_name,category,quantity,quantity_sold,purchase_date,total_cost,market_value,market_price_source,market_price_variant,market_price_updated_at,market_price_checked_at,market_price_currency,is_raw_card,buy_percentage,target_buy_price,purchase_source,seller,event_id,purchased_by_worker_id,notes,status,sold_price,sold_date,sold_by_worker_id,sold_event_id,sold_payment_method,buyer_note,card_name,collector_number,card_set,card_set_id,card_set_code,card_rarity,card_game,card_language,data_provider,provider_card_id,card_code,pokemon_tcg_card_id,official_card_image_url,tcgplayer_url,card_condition,sticker_price,grading_company,grade,certificate_number,front_image_url,front_image_path,back_image_url,back_image_path,scan_confidence,scan_status,image_hash,scan_result,acquisition_method,acquired_financial_transaction_id,disposed_financial_transaction_id,traded_at,agreed_trade_value,prior_inventory_purchase_id,financial_transaction_id,financial_transaction_item_id,created_at,updated_at";
  const completeTrace = startSupabaseQueryTrace("inventory_purchases", "listInventoryPurchases", columns);
  const enhanced = await supabase.from("inventory_purchases")
    .select(columns)
    .order("purchase_date", { ascending: false }).limit(limit);
  let data = enhanced.data as unknown as PurchaseRow[] | null;
  let error = enhanced.error;
  if (isMissingColumnError(error)) {
    const legacyColumns = columns
      .replace(",market_price_currency", "")
      .replace(",card_set_id,card_set_code,card_rarity", "")
      .replace(",card_game,card_language,data_provider,provider_card_id,card_code", ",card_language")
      .replace(",pokemon_tcg_card_id,official_card_image_url,tcgplayer_url", "")
      .replace(",acquisition_method,acquired_financial_transaction_id,disposed_financial_transaction_id,traded_at,agreed_trade_value,prior_inventory_purchase_id,financial_transaction_id,financial_transaction_item_id", "");
    const legacy = await supabase.from("inventory_purchases")
      .select(legacyColumns)
      .order("purchase_date", { ascending: false }).limit(limit);
    data = legacy.data as unknown as PurchaseRow[] | null;
    error = legacy.error;
  }
  completeTrace(data?.length || 0, error);
  recordSupabaseRequest("inventory_purchases", "listInventoryPurchases", data?.length || 0);
  if (error) throw new Error(error.message);
  const values = (data || []).map((row) => fromRow(row as PurchaseRow));
  write(cacheKey, values);
  setSupabaseStatus({ connected: true, error: "", synced: true });
  return values;
}

export async function saveInventoryPurchase(input: Partial<InventoryPurchase>, imageFile?: File, backImageFile?: File) {
  const timestamp = nowIso();
  const recordId = input.id || id("purchase");
  let imageUrl = input.imageUrl;
  let imagePath = input.imagePath;
  let backImageUrl = input.backImageUrl;
  let backImagePath = input.backImagePath;
  if (imageFile) {
    if (isSupabaseConfigured && supabase) {
      const uploaded = await uploadFinancialImage(imageFile, "purchases", recordId);
      imageUrl = uploaded.imageUrl;
      imagePath = uploaded.imagePath;
    } else {
      imageUrl = await fileToDataUrl(imageFile);
      imagePath = undefined;
    }
  }
  if (backImageFile) {
    if (isSupabaseConfigured && supabase) {
      const uploaded = await uploadFinancialImage(backImageFile, "purchases", `${recordId}-back`);
      backImageUrl = uploaded.imageUrl;
      backImagePath = uploaded.imagePath;
    } else {
      backImageUrl = await fileToDataUrl(backImageFile);
      backImagePath = undefined;
    }
  }
  const value: InventoryPurchase = {
    id: recordId,
    imageUrl,
    imagePath,
    itemName: input.itemName?.trim() || "Untitled card item",
    category: input.category || "other_pokemon_product",
    quantity: Math.max(1, Number(input.quantity || 1)),
    quantitySold: Math.min(Math.max(0, Number(input.quantitySold || 0)), Math.max(1, Number(input.quantity || 1))),
    purchaseDate: input.purchaseDate || timestamp,
    totalCost: Number(input.totalCost || 0),
    marketValue: input.marketValue,
    marketPriceSource: input.marketPriceSource,
    marketPriceVariant: input.marketPriceVariant,
    marketPriceUpdatedAt: input.marketPriceUpdatedAt,
    marketPriceCheckedAt: input.marketPriceCheckedAt,
    isRawCard: Boolean(input.isRawCard),
    buyPercentage: input.buyPercentage,
    targetBuyPrice: input.targetBuyPrice,
    purchaseSource: input.purchaseSource,
    seller: input.seller?.trim() || undefined,
    eventId: input.eventId,
    purchasedByWorkerId: input.purchasedByWorkerId,
    notes: input.notes?.trim() || undefined,
    status: input.status || "in_stock",
    soldPrice: input.soldPrice,
    soldDate: input.soldDate,
    soldByWorkerId: input.soldByWorkerId,
    soldEventId: input.soldEventId,
    soldPaymentMethod: input.soldPaymentMethod,
    buyerNote: input.buyerNote?.trim() || undefined,
    cardName: input.cardName?.trim() || undefined,
    collectorNumber: input.collectorNumber?.trim() || undefined,
    cardSet: input.cardSet?.trim() || undefined,
    cardSetId: input.cardSetId?.trim() || undefined,
    cardSetCode: input.cardSetCode?.trim() || undefined,
    cardRarity: input.cardRarity?.trim() || undefined,
    cardGame: input.cardGame,
    cardLanguage: input.cardLanguage?.trim() || undefined,
    dataProvider: input.dataProvider,
    providerCardId: input.providerCardId?.trim() || undefined,
    cardCode: input.cardCode?.trim() || undefined,
    marketPriceCurrency: input.marketPriceCurrency?.trim() || undefined,
    pokemonTcgCardId: input.pokemonTcgCardId?.trim() || undefined,
    officialCardImageUrl: input.officialCardImageUrl,
    tcgplayerUrl: input.tcgplayerUrl,
    cardCondition: input.cardCondition,
    stickerPrice: input.stickerPrice,
    gradingCompany: input.gradingCompany?.trim() || undefined,
    grade: input.grade?.trim() || undefined,
    certificateNumber: input.certificateNumber?.trim() || undefined,
    frontImageUrl: input.frontImageUrl || imageUrl,
    frontImagePath: input.frontImagePath || imagePath,
    backImageUrl,
    backImagePath,
    scanConfidence: input.scanConfidence,
    scanStatus: input.scanStatus || "not_scanned",
    imageHash: input.imageHash,
    scanResult: input.scanResult,
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp
  };
  if (!isSupabaseConfigured || !supabase) {
    const values = [value, ...read(localKey).filter((item) => item.id !== value.id)];
    write(localKey, values);
    write(cacheKey, values);
    return value;
  }
  const row = buildInventoryPurchasePayload(value);
  let result = await supabase.from("inventory_purchases").upsert(row).select("*").single();
  if (isMissingColumnError(result.error)) {
    result = await supabase.from("inventory_purchases").upsert(withoutTradeColumns(withoutManualSearchColumns(row) as PurchaseRow)).select("*").single();
  }
  const { data, error } = result;
  recordSupabaseRequest("inventory_purchases", "saveInventoryPurchase", data ? 1 : 0);
  if (error) throw new Error(error.message);
  return fromRow(data as PurchaseRow);
}

export async function deleteInventoryPurchase(recordId: string) {
  write(localKey, read(localKey).filter((item) => item.id !== recordId));
  write(cacheKey, read(cacheKey).filter((item) => item.id !== recordId));
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from("inventory_purchases").delete().eq("id", recordId);
  recordSupabaseRequest("inventory_purchases", "deleteInventoryPurchase");
  if (error) throw new Error(error.message);
}
