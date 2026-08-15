import { AlertTriangle, Check, ChevronLeft, ChevronRight, Image as ImageIcon, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CardMatch, CardScanSuggestion } from "../../services/sales/cardScanService";
import { searchPokemonCardsManually } from "../../services/sales/pokemonCardSearchService";
import type { CardCondition, OwnershipShare, TradeItem, Worker } from "../../types/models";
import { bulkReviewProviderImage, bulkReviewSourceImage } from "../../utils/bulkImportReview";
import { formatMoney } from "../../utils/paymentMath";
import { OwnershipEditor } from "./OwnershipEditor";

export type BulkImportReviewRecord = {
  id: string;
  itemId: string;
  file?: File;
  previewUrl?: string;
  filename: string;
  uploadOrder: number;
  direction: "incoming" | "outgoing";
  signature: string;
  imageHash?: string;
  possibleDuplicate: boolean;
  status: "waiting" | "processing" | "ready" | "needs_review" | "failed";
  forceRecognition?: boolean;
  stage?: string;
  suggestion?: CardScanSuggestion;
  error?: string;
};

type Props = {
  record: BulkImportReviewRecord;
  item: TradeItem;
  workers: Worker[];
  itemNumber: number;
  itemCount: number;
  busy?: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onPatchItem: (patch: Partial<TradeItem>) => void;
  onConfirmMatch: (match: CardMatch) => Promise<void>;
  onManualSearch: () => void;
  onSaveNext: () => void;
};

const conditions: CardCondition[] = ["Near Mint / NM", "Lightly Played / LP", "Moderately Played / MP", "Heavily Played / HP", "Damaged"];

function selectedCandidate(record: BulkImportReviewRecord, item: TradeItem): CardMatch | undefined {
  const matches = record.suggestion?.possibleMatches || [];
  const selected = matches.find((match) => match.providerCardId === item.providerCardId) || matches[0];
  if (selected) return selected;
  if (!item.providerCardId) return undefined;
  return {
    game: item.cardGame === "one_piece" ? "one_piece" : "pokemon",
    language: item.cardLanguage === "ja" ? "ja" : "en",
    provider: item.dataProvider === "tcgdex" || item.dataProvider === "optcgapi" ? item.dataProvider : "pokemontcg",
    providerCardId: item.providerCardId,
    name: item.itemName,
    cardCode: item.cardCode,
    collectorNumber: item.collectorNumber,
    setId: item.cardSetId,
    setName: item.cardSet,
    rarity: item.cardRarity,
    imageSmall: item.officialCardImageUrl,
    imageLarge: item.officialCardImageUrl,
    productUrl: item.tcgplayerUrl,
    pricing: item.tcgplayerPricing ? {
      currency: item.tcgplayerPricing.currency,
      market: item.marketValue,
      updatedAt: item.tcgplayerPricing.updatedAt,
      source: item.tcgplayerPricing.source,
      variants: item.tcgplayerPricing.variants.map((variant) => ({ name: variant.variant, ...variant })),
    } : item.marketValue > 0 ? { market: item.marketValue, currency: item.marketPriceCurrency, source: item.marketPriceSource } : undefined,
    matchConfidence: "high",
    searchConfidence: "exact",
    matchScore: 100,
    reasons: ["Previously confirmed provider record"],
  };
}

function candidateMarket(candidate: CardMatch | undefined, item: TradeItem) {
  if (!candidate) return item.marketValue > 0 ? item.marketValue : undefined;
  const selectedVariant = item.marketPriceVariant;
  const variant = candidate.pricing?.variants?.find((entry) => entry.name === selectedVariant)
    || candidate.pricing?.variants?.find((entry) => entry.market != null);
  return variant?.market ?? candidate.pricing?.market ?? (item.marketValue > 0 ? item.marketValue : undefined);
}

function sameNameCandidates(record: BulkImportReviewRecord, item: TradeItem) {
  const recognized = (record.suggestion?.cardName || item.itemName || "").trim().toLocaleLowerCase();
  return (record.suggestion?.possibleMatches || [])
    .filter((match) => !recognized || match.name.trim().toLocaleLowerCase() === recognized)
    .sort((left, right) => Number(right.matchScore || 0) - Number(left.matchScore || 0));
}

export function BulkImportCardReview({ record, item, workers, itemNumber, itemCount, busy, onClose, onPrevious, onNext, onPatchItem, onConfirmMatch, onManualSearch, onSaveNext }: Props) {
  const [screen, setScreen] = useState<"match" | "alternatives" | "inventory">("match");
  const [searched, setSearched] = useState<CardMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const candidate = useMemo(() => selectedCandidate(record, item), [item, record]);
  const sourceImageUrl = bulkReviewSourceImage(item, record);
  const providerImageUrl = bulkReviewProviderImage(item, { ...record, providerImageUrl: record.suggestion?.officialImageUrl || candidate?.imageLarge || candidate?.imageSmall });
  const market = candidateMarket(candidate, item);
  const storedAlternatives = useMemo(() => sameNameCandidates(record, item), [item, record]);
  const alternatives = [...storedAlternatives, ...searched].filter((match, index, all) => all.findIndex((entry) => entry.providerCardId === match.providerCardId && entry.provider === match.provider) === index);

  useEffect(() => {
    setScreen("match");
    setSearched([]);
    setSearchError("");
    setActionError("");
  }, [record.id]);

  useEffect(() => {
    if (screen !== "alternatives" || searching || searched.length || !item.itemName.trim()) return;
    const controller = new AbortController();
    setSearching(true);
    void searchPokemonCardsManually({
      game: item.cardGame === "one_piece" ? "one_piece" : "pokemon",
      language: item.cardLanguage === "ja" ? "ja" : "en",
      name: item.itemName,
      query: item.itemName,
      page: 1,
      pageSize: 10,
      disableCorrection: true,
    }, controller.signal).then((result) => setSearched(result.matches)).catch((error) => {
      if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : "Provider alternatives could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setSearching(false); });
    return () => controller.abort();
  }, [item.cardGame, item.cardLanguage, item.itemName, screen, searched.length, searching]);

  async function confirm(match: CardMatch, goToInventory: boolean) {
    setConfirming(true);
    setActionError("");
    try {
      await onConfirmMatch(match);
      setScreen(goToInventory ? "inventory" : "match");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The provider match could not be confirmed.");
    } finally {
      setConfirming(false);
    }
  }

  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/75 sm:items-center sm:p-4">
    <section className="max-h-[96dvh] w-full max-w-5xl overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:p-5 dark:bg-slate-900">
      <header className="sticky top-0 z-10 -mx-1 flex items-center gap-2 border-b border-slate-100 bg-white/95 p-1 pb-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <button type="button" onClick={onPrevious} aria-label="Previous card" className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><ChevronLeft size={18} /></button>
        <div className="min-w-0 flex-1"><p className="eyebrow">Reviewing {itemNumber} of {itemCount}</p><h3 className="truncate text-lg font-black">{screen === "match" ? "Review Card Match" : screen === "alternatives" ? "Choose the Correct Card" : "Inventory Details"}</h3></div>
        <button type="button" onClick={onNext} aria-label="Next card" className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><ChevronRight size={18} /></button>
        <button type="button" onClick={onClose} aria-label="Close review" className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
      </header>

      {record.possibleDuplicate ? <p className="mt-3 rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-900">Possible duplicate photo. This record is still preserved separately.</p> : null}
      {actionError ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-800 dark:bg-rose-950/30 dark:text-rose-100">{actionError}</p> : null}

      {screen === "match" ? <>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-4">
          <PhotoPanel label="Original Upload" url={sourceImageUrl} alt={`Original upload ${record.filename}`} unavailable="Original photo unavailable" />
          <PhotoPanel label="TCG Database Match" url={providerImageUrl} alt={candidate?.name || item.itemName} unavailable="No provider image selected" />
        </div>
        {candidate ? <section className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-xl font-black">{candidate.name}</h4><p className="font-bold text-slate-600 dark:text-slate-300">{candidate.setName || item.cardSet || "Set unavailable"} · #{candidate.collectorNumber || candidate.cardCode || item.collectorNumber || "—"}</p><p className="mt-1 text-xs text-slate-500">{candidate.provider} · ID {candidate.providerCardId} · {candidate.matchConfidence} confidence</p></div><div className="rounded-2xl bg-slate-950 px-4 py-3 text-white"><small className="block font-black uppercase tracking-wide text-slate-400">TCGplayer Market</small><b className="text-2xl">{market == null ? "Unavailable" : formatMoney(market)}</b></div></div>
          <p className="mt-5 text-center text-lg font-black">Is this the correct card and printing?</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" disabled={busy || confirming} onClick={() => void confirm(candidate, true)} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-black text-white disabled:opacity-50">{confirming ? <LoaderCircle className="animate-spin" size={19} /> : <Check size={19} />} Correct</button><button type="button" onClick={() => setScreen("alternatives")} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-rose-100 px-4 font-black text-rose-800 dark:bg-rose-950 dark:text-rose-100"><X size={19} /> Wrong Card</button></div>
        </section> : <section className="mt-4 rounded-2xl bg-amber-50 p-5 text-center dark:bg-amber-950/30"><AlertTriangle className="mx-auto text-amber-600" /><h4 className="mt-2 font-black">No exact provider card selected</h4><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">The recognized details and original upload are preserved.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => setScreen("alternatives")} className="min-h-12 rounded-xl bg-slate-950 px-4 font-black text-white">Find Possible Matches</button><button type="button" onClick={onManualSearch} className="min-h-12 rounded-xl bg-violet-600 px-4 font-black text-white">Search Manually</button></div></section>}
      </> : null}

      {screen === "alternatives" ? <>
        <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-3 sm:grid-cols-[10rem_minmax(0,1fr)] dark:bg-slate-950"><PhotoPanel compact label="Original Upload" url={sourceImageUrl} alt={`Original upload ${record.filename}`} unavailable="Original photo unavailable" /><div className="self-center"><p className="text-xs font-black uppercase tracking-wide text-slate-500">Recognized</p><h4 className="text-lg font-black">{record.suggestion?.cardName || item.itemName || "Name unavailable"}</h4><p className="text-sm text-slate-500">{record.suggestion?.cardSet || item.cardSet || "Set unknown"} · #{record.suggestion?.collectorNumber || item.collectorNumber || "—"}</p><p className="mt-2 text-xs text-slate-500">The original uploaded photo remains visible while you choose another result.</p></div></div>
        <div className="mt-4 flex items-end justify-between gap-3"><div><h4 className="text-lg font-black">Same-name alternatives</h4><p className="text-xs text-slate-500">Provider results only; AI recognition is not rerun.</p></div><button type="button" onClick={onManualSearch} className="shrink-0 text-xs font-black text-violet-700 dark:text-violet-300"><Search size={15} className="inline" /> Search Manually</button></div>
        {searching ? <p className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-violet-700"><LoaderCircle size={15} className="animate-spin" /> Loading matches…</p> : null}
        {searchError ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">{searchError}</p> : null}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{alternatives.map((match) => <button type="button" disabled={confirming} key={`${match.provider}:${match.providerCardId}`} onClick={() => void confirm(match, false)} className="rounded-2xl border border-slate-200 p-2 text-left transition hover:border-violet-500 hover:bg-violet-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-violet-950/30">{match.imageSmall || match.imageLarge ? <img src={match.imageSmall || match.imageLarge} alt={match.name} className="mx-auto h-40 w-full object-contain" /> : <div className="flex h-40 items-center justify-center text-xs text-slate-500">No image</div>}<b className="mt-2 block truncate text-sm">{match.name}</b><span className="block truncate text-xs text-slate-500">{match.setName || "Set unknown"} · #{match.collectorNumber || match.cardCode || "—"}</span><span className="mt-1 block text-xs font-black">Market {candidateMarket(match, item) == null ? "—" : formatMoney(candidateMarket(match, item) || 0)}</span><span className="mt-2 block rounded-lg bg-violet-600 py-2 text-center text-xs font-black text-white">Use This Card</span></button>)}</div>
        {!alternatives.length && !searching ? <p className="mt-4 rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-500 dark:bg-slate-950">No same-name alternatives were returned. Use manual search with the recognized name prefilled.</p> : null}
        <button type="button" onClick={onManualSearch} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 font-black text-white"><Search size={18} /> Search Manually</button>
      </> : null}

      {screen === "inventory" ? <>
        <section className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">{providerImageUrl ? <img src={providerImageUrl} alt="Confirmed provider card" className="h-24 w-16 object-contain" /> : null}<div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-wide text-emerald-700">Provider match confirmed</p><h4 className="truncate text-lg font-black">{item.itemName}</h4><p className="truncate text-sm">{item.cardSet || "Set unavailable"} · #{item.collectorNumber || item.cardCode || "—"}</p><p className="font-black">Market: {market == null ? "Unavailable" : formatMoney(market)}</p></div><button type="button" onClick={() => setScreen("match")} className="rounded-lg bg-white px-3 py-2 text-xs font-black dark:bg-slate-900">Change</button></section>
        <section className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800"><h4 className="font-black">Inventory details</h4><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-xs font-black">Condition<select value={item.cardCondition || "Near Mint / NM"} onChange={(event) => onPatchItem({ cardCondition: event.target.value as CardCondition })} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950">{conditions.map((condition) => <option key={condition}>{condition}</option>)}</select></label><label className="text-xs font-black">Quantity<input type="number" min="1" value={item.quantity} onChange={(event) => onPatchItem({ quantity: Math.max(1, Number(event.target.value || 1)) })} className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label><label className="text-xs font-black">Cost basis<input type="number" min="0" step=".01" value={item.costBasis || ""} onChange={(event) => onPatchItem({ costBasis: Number(event.target.value || 0), boughtPrice: Number(event.target.value || 0) })} placeholder="Optional if unknown" className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-950" /></label></div></section>
        <div className="mt-4"><OwnershipEditor workers={workers} shares={item.ownershipShares} totalCost={item.costBasis} label="Inventory ownership" onChange={(ownershipShares: OwnershipShare[]) => onPatchItem({ ownershipShares })} /></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => setScreen("match")} className="min-h-12 rounded-xl bg-slate-100 px-4 font-black dark:bg-slate-800">Back to Match</button><button type="button" disabled={busy || !item.ownershipShares.length} onClick={onSaveNext} className="min-h-12 rounded-xl bg-emerald-600 px-4 font-black text-white disabled:opacity-50">Save & Next →</button></div>
      </> : null}
    </section>
  </div>;
}

function PhotoPanel({ label, url, alt, unavailable, compact = false }: { label: string; url?: string; alt: string; unavailable: string; compact?: boolean }) {
  const height = compact ? "h-48" : "h-64 sm:h-80";
  return <div className="overflow-hidden rounded-2xl bg-slate-950 p-2" data-review-photo={label.toLocaleLowerCase().replace(/\s+/g, "-")}><p className="mb-1 text-[10px] font-black uppercase tracking-wide text-white">{label}</p>{url ? <img key={url} src={url} alt={alt} className={`${height} w-full object-contain`} /> : <div className={`flex ${height} flex-col items-center justify-center p-3 text-center text-sm font-bold text-slate-400`}><ImageIcon size={28} /><span className="mt-2">{unavailable}</span></div>}</div>;
}
