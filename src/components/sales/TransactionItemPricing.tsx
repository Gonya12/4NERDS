import { useState } from "react";
import type { CardScanSuggestion, TcgplayerPricing } from "../../services/sales/cardScanService";
import type { TradeItem } from "../../types/models";
import { calculateTargetPrice, selectedTcgplayerPrice } from "../../utils/cardPricing";
import { formatMoney } from "../../utils/paymentMath";
import { hasKnownHistoricalCostBasis } from "../../utils/transactionMath";
import { TargetPriceCalculator } from "./TargetPriceCalculator";
import { TcgplayerPricingPanel } from "./TcgplayerPricingPanel";

type Context = "purchase" | "sale" | "trade-incoming" | "trade-outgoing";
type Props = { item: TradeItem; context: Context; onChange: (item: TradeItem) => void };

function suggestionForItem(item: TradeItem): CardScanSuggestion {
  return {
    suggestedType: item.itemType === "graded_card" ? "graded_card" : "raw_card",
    cardName: item.itemName || null, collectorNumber: item.collectorNumber || null, cardSet: item.cardSet || null,
    language: item.cardLanguage || null, condition: item.cardCondition || null, stickerPrice: item.stickerPrice ?? null,
    cardGame: item.cardGame, cardLanguage: item.cardLanguage === "ja" ? "ja" : item.cardLanguage === "unknown" ? "unknown" : "en",
    dataProvider: item.dataProvider, providerCardId: item.providerCardId, cardCode: item.cardCode,
    marketPriceCurrency: item.marketPriceCurrency,
    gradingCompany: item.gradingCompany || null, grade: item.grade || null, certificateNumber: item.certificateNumber || null,
    labelInformation: null, barcodeText: null, overallConfidence: "high", fieldConfidence: {},
    officialImageUrl: item.officialCardImageUrl, cardSetId: item.cardSetId, cardSetCode: item.cardSetCode,
    cardRarity: item.cardRarity, pokemonTcgCardId: item.pokemonTcgCardId, tcgplayerUrl: item.tcgplayerUrl,
    warnings: [], tcgplayerPricing: item.tcgplayerPricing,
  };
}

export function TransactionItemPricing({ item, context, onChange }: Props) {
  const [confirmEstimate, setConfirmEstimate] = useState(false);
  const percentage = item.targetBuyPercentage ?? item.tradePercentage ?? 75;
  const updatePricing = (pricing: TcgplayerPricing) => {
    const selected = selectedTcgplayerPrice(pricing);
    onChange({
      ...item, tcgplayerPricing: pricing, marketValue: selected?.market ?? item.marketValue,
      marketPriceSource: pricing.source || item.marketPriceSource || "TCGplayer", marketPriceCurrency: pricing.currency || item.marketPriceCurrency, marketPriceVariant: pricing.selectedVariant,
      marketPriceUpdatedAt: pricing.updatedAt, marketPriceCheckedAt: pricing.checkedAt,
      tcgplayerUrl: pricing.url || item.tcgplayerUrl,
      targetBuyPrice: selected?.market == null ? item.targetBuyPrice : calculateTargetPrice(selected.market, percentage),
    });
  };
  const choosePercentage = (next: number) => {
    const target = calculateTargetPrice(item.marketValue, next);
    onChange(context === "trade-incoming"
      ? { ...item, targetBuyPercentage: next, targetBuyPrice: target, tradePercentage: next, agreedTradeValue: target }
      : { ...item, targetBuyPercentage: next, targetBuyPrice: target });
  };
  const linkedInventory = Boolean(item.inventoryPurchaseId);
  const basisKnown = hasKnownHistoricalCostBasis(item);
  const grossProfit = basisKnown ? Number(item.soldPrice || 0) - item.historicalCostBasis : undefined;

  return <div className="space-y-3">
    {item.providerCardId || item.pokemonTcgCardId ? <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900">{item.officialCardImageUrl ? <img src={item.officialCardImageUrl} alt="" className="h-20 w-14 rounded-lg object-contain" /> : null}<div className="min-w-0"><b>{item.itemName}</b>{item.cardCode || item.collectorNumber ? ` #${item.cardCode || item.collectorNumber}` : ""} · {item.cardSet || "Set unavailable"}<span className="block text-slate-500">{item.dataProvider || "pokemontcg"} ID {item.providerCardId || item.pokemonTcgCardId}{item.cardRarity ? ` · ${item.cardRarity}` : ""}</span></div></div> : null}
    {item.tcgplayerPricing ? <TcgplayerPricingPanel suggestion={suggestionForItem(item)} isSlab={item.itemType === "graded_card"} onChange={(suggestion) => suggestion.tcgplayerPricing && updatePricing(suggestion.tcgplayerPricing)} showTargetCalculator={false} /> : item.providerCardId || item.pokemonTcgCardId ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">No provider market price is available for this printing. Market Value remains editable and was not set to $0.</p> : null}
    {item.itemType === "raw_card" && context === "purchase" ? <TargetPriceCalculator marketValue={item.marketValue} percentage={percentage} onPercentage={choosePercentage} actionLabel="Use as Bought Price" onApply={(amount) => onChange({ ...item, targetBuyPercentage: percentage, targetBuyPrice: amount, boughtPrice: amount, costBasis: amount })} note="Choose a target first. Actual Bought Price changes only when you tap Use as Bought Price." /> : null}
    {item.itemType === "raw_card" && context === "trade-incoming" ? <TargetPriceCalculator marketValue={item.marketValue} percentage={percentage} onPercentage={choosePercentage} note="Trade Percentage directly sets Accepted Trade Value. It does not create cash revenue." /> : null}
    {item.itemType === "raw_card" && context === "sale" && linkedInventory ? <TargetPriceCalculator marketValue={item.marketValue} percentage={percentage} onPercentage={choosePercentage} note="Reference only. Historical cost basis loaded from inventory and will never be replaced." /> : null}
    {item.itemType === "raw_card" && context === "sale" && !linkedInventory ? <>
      <TargetPriceCalculator marketValue={item.marketValue} percentage={percentage} onPercentage={choosePercentage} actionLabel="Use target amount as estimated cost basis" onApply={() => setConfirmEstimate(true)} note="Manual sale item only. Applying this creates an estimate, never a historical purchase cost." />
      {confirmEstimate ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p className="font-black">Confirm estimated cost basis</p><p>This will set Original Cost Basis to the estimate {formatMoney(calculateTargetPrice(item.marketValue, percentage))}.</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => setConfirmEstimate(false)} className="min-h-10 flex-1 rounded-xl bg-white font-black">Cancel</button><button type="button" onClick={() => { onChange({ ...item, historicalCostBasis: calculateTargetPrice(item.marketValue, percentage), costBasisIsEstimate: true }); setConfirmEstimate(false); }} className="min-h-10 flex-1 rounded-xl bg-amber-600 font-black text-white">Confirm Estimate</button></div></div> : null}
    </> : null}
    {context === "sale" ? <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-3 text-xs dark:bg-slate-900"><span>Original Cost Basis<br /><b>{basisKnown ? formatMoney(item.historicalCostBasis) : "Cost basis required"}</b></span><span>Gross Profit<br /><b className={grossProfit == null ? "text-amber-700" : grossProfit >= 0 ? "text-emerald-600" : "text-rose-600"}>{grossProfit == null ? "Pending cost basis" : formatMoney(grossProfit)}</b></span>{item.costBasisIsEstimate ? <span className="col-span-2 font-bold text-amber-700">Estimated cost basis — not linked to inventory history.</span> : null}</div> : null}
  </div>;
}
