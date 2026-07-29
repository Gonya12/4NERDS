import type { CardScanSuggestion, TcgplayerPricing, TcgplayerPriceVariant } from "../services/sales/cardScanService";
import type { InventoryPurchase, TradeItem } from "../types/models";

export const targetPricePercentages = [70, 75, 80] as const;

export function calculateTargetPrice(marketValue: number, percentage: number) {
  const value = Math.max(0, Number(marketValue || 0)) * Math.max(0, Math.min(100, Number(percentage || 0))) / 100;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function selectedTcgplayerPrice(pricing?: TcgplayerPricing): TcgplayerPriceVariant | undefined {
  return pricing?.variants.find((variant) => variant.variant === pricing.selectedVariant);
}

export function pricingFromInventory(purchase: InventoryPurchase): TcgplayerPricing | undefined {
  const scanPricing = purchase.scanResult?.tcgplayerPricing as TcgplayerPricing | undefined;
  if (scanPricing?.variants) return scanPricing;
  if (!purchase.marketPriceSource && !purchase.marketPriceVariant && !purchase.tcgplayerUrl) return undefined;
  return {
    url: purchase.tcgplayerUrl,
    updatedAt: purchase.marketPriceUpdatedAt,
    checkedAt: purchase.marketPriceCheckedAt || purchase.updatedAt,
    selectedVariant: purchase.marketPriceVariant,
    variants: purchase.marketPriceVariant ? [{ variant: purchase.marketPriceVariant, market: purchase.marketValue }] : [],
    targetPercent: purchase.buyPercentage,
  };
}

export function applyIncomingPercentage(items: TradeItem[], percentage: number, mode: "purchase" | "trade") {
  return items.map((item) => {
    if (item.direction !== "incoming") return item;
    const target = calculateTargetPrice(item.marketValue, percentage);
    return mode === "trade"
      ? { ...item, targetBuyPercentage: percentage, targetBuyPrice: target, tradePercentage: percentage, agreedTradeValue: target }
      : { ...item, targetBuyPercentage: percentage, targetBuyPrice: target };
  });
}

export function applyCardSuggestionToItem(item: TradeItem, suggestion: CardScanSuggestion, source: "manual" | "scanner" = "manual"): TradeItem {
  if (source === "scanner" && item.cardSelectionSource === "manual") return item;
  const selected = selectedTcgplayerPrice(suggestion.tcgplayerPricing);
  const percentage = item.targetBuyPercentage ?? suggestion.tcgplayerPricing?.targetPercent ?? 75;
  return {
    ...item,
    itemName: suggestion.cardName || item.itemName,
    collectorNumber: suggestion.collectorNumber || item.collectorNumber,
    cardSet: suggestion.cardSet || item.cardSet,
    cardSetId: suggestion.cardSetId || item.cardSetId,
    cardSetCode: suggestion.cardSetCode || item.cardSetCode,
    cardRarity: suggestion.cardRarity || item.cardRarity,
    cardLanguage: suggestion.language || item.cardLanguage,
    pokemonTcgCardId: suggestion.pokemonTcgCardId || item.pokemonTcgCardId,
    officialCardImageUrl: suggestion.officialImageUrl || item.officialCardImageUrl,
    tcgplayerUrl: suggestion.tcgplayerUrl || suggestion.tcgplayerPricing?.url || item.tcgplayerUrl,
    cardCondition: suggestion.condition || item.cardCondition,
    stickerPrice: suggestion.stickerPrice ?? item.stickerPrice,
    gradingCompany: suggestion.gradingCompany || item.gradingCompany,
    grade: suggestion.grade || item.grade,
    certificateNumber: suggestion.certificateNumber || item.certificateNumber,
    marketValue: selected?.market ?? item.marketValue,
    marketPriceSource: suggestion.tcgplayerPricing ? "TCGplayer" : item.marketPriceSource,
    marketPriceVariant: suggestion.tcgplayerPricing?.selectedVariant || item.marketPriceVariant,
    marketPriceUpdatedAt: suggestion.tcgplayerPricing?.updatedAt || item.marketPriceUpdatedAt,
    marketPriceCheckedAt: suggestion.tcgplayerPricing?.checkedAt || item.marketPriceCheckedAt,
    tcgplayerPricing: suggestion.tcgplayerPricing || item.tcgplayerPricing,
    targetBuyPercentage: percentage,
    targetBuyPrice: selected?.market == null ? item.targetBuyPrice : calculateTargetPrice(selected.market, percentage),
    cardSelectionSource: source,
  };
}
