import type { CardScanSuggestion } from "../../services/sales/cardScanService";
import { calculateTargetPrice } from "../../utils/cardPricing";

type Props = {
  suggestion: CardScanSuggestion;
  isSlab: boolean;
  onChange: (value: CardScanSuggestion) => void;
  showTargetCalculator?: boolean;
};

const money = (value?: number | null, currency = "USD") => value == null ? "Unavailable" : `${currency} ${value.toFixed(2)}`;
const friendlyVariants: Record<string, string> = {
  normal: "Normal",
  holofoil: "Holo",
  reverseHolofoil: "Reverse Holo",
  "1stEditionNormal": "First Edition Normal",
  "1stEditionHolofoil": "First Edition Holo",
};
const variantLabel = (value: string) => friendlyVariants[value] || value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
const quickPercentages = [90, 85, 80, 75, 70] as const;

export function TcgplayerPricingPanel({ suggestion, isSlab, onChange, showTargetCalculator = true }: Props) {
  const pricing = suggestion.tcgplayerPricing;
  if (!pricing) return null;
  const selected = pricing.variants.find((row) => row.variant === pricing.selectedVariant);
  const currency = pricing.currency || suggestion.marketPriceCurrency || "USD";
  const providerName = pricing.source || (suggestion.dataProvider === "tcgdex" ? "TCGdex" : suggestion.dataProvider === "optcgapi" ? "OPTCG API" : "TCGplayer");
  const rawPokemon = !isSlab && suggestion.cardGame === "pokemon";
  const isNearMint = suggestion.condition === "Near Mint / NM";
  const hasProviderStampedVariant = pricing.variants.some((row) => /stamp/i.test(row.variant));
  const stampedManual = suggestion.manualPricingVariant === "stamped/manual";
  const providerMarket = selected?.market;
  const confirmedMarket = suggestion.confirmedMarketValue;
  const targetPercent = pricing.targetPercent ?? 75;
  const offer = confirmedMarket == null ? null : calculateTargetPrice(confirmedMarket, targetPercent);

  const updatePricing = (patch: Partial<typeof pricing>) => {
    const nextPricing = { ...pricing, ...patch };
    const nextSelected = nextPricing.variants.find((row) => row.variant === nextPricing.selectedVariant);
    onChange({
      ...suggestion,
      tcgplayerPricing: nextPricing,
      confirmedMarketValue: rawPokemon && isNearMint && !stampedManual ? nextSelected?.market ?? null : suggestion.confirmedMarketValue,
    });
  };

  return <section className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-slate-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-slate-100">
    <div>
      <strong>{isSlab ? "Raw card market reference" : `${providerName} pricing`}</strong>
      {isSlab ? <p>Reference only. Raw-card prices are not graded-slab market values and will not be applied automatically.</p> : null}
    </div>

    {!pricing.variants.length ? <p className="font-black text-amber-700 dark:text-amber-300">No provider market price is available. Market Value remains blank until you enter it.</p> : pricing.variants.length === 1 ? <p className="rounded-lg bg-white/70 p-2 font-bold dark:bg-slate-900/70">Printing: {variantLabel(pricing.variants[0].variant)} <span className="font-normal text-slate-500">(selected automatically)</span></p> : <label className="block font-bold">
      Choose Printing
      <select
        value={pricing.selectedVariant || ""}
        onChange={(event) => updatePricing({ selectedVariant: event.target.value || undefined })}
        className="mt-1 w-full rounded-lg border bg-white p-2 dark:bg-slate-950"
      >
        <option value="">Choose printing</option>
        {pricing.variants.map((row) => <option key={row.variant} value={row.variant}>{variantLabel(row.variant)}</option>)}
      </select>
    </label>}

    {rawPokemon && !hasProviderStampedVariant ? <label className="flex items-start gap-2 rounded-lg border border-sky-200 bg-white/70 p-2 font-bold dark:border-sky-800 dark:bg-slate-900/70">
      <input type="checkbox" checked={stampedManual} onChange={(event) => onChange({
        ...suggestion,
        manualPricingVariant: event.target.checked ? "stamped/manual" : undefined,
        confirmedMarketValue: event.target.checked ? null : isNearMint ? providerMarket ?? null : null,
      })} className="mt-0.5 size-4" />
      <span>Stamped <small className="block font-normal text-slate-500">Provider data does not list a separate stamped price; confirm market manually.</small></span>
    </label> : null}

    {selected ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <span>Provider Market<br /><b>{money(selected.market, currency)}</b></span>
      <span>Low<br /><b>{money(selected.low, currency)}</b></span>
      <span>Mid<br /><b>{money(selected.mid, currency)}</b></span>
      <span>High<br /><b>{money(selected.high, currency)}</b></span>
      <span>Direct Low<br /><b>{money(selected.directLow, currency)}</b></span>
    </div> : pricing.variants.length ? <p className="font-bold text-amber-700 dark:text-amber-300">Choose the physical printing to continue.</p> : null}

    {rawPokemon && suggestion.condition ? <div className="space-y-2 rounded-lg bg-white/70 p-2 dark:bg-slate-900/70">
      {isNearMint && !stampedManual && providerMarket != null ? <p>NM provider market loaded automatically: <b>{money(providerMarket, currency)}</b></p> : <>
        <p>NM/provider reference: <b>{money(providerMarket, currency)}</b></p>
        <label className="block font-bold">Your market value
          <input type="number" min="0" step="0.01" value={confirmedMarket ?? ""} onChange={(event) => onChange({ ...suggestion, confirmedMarketValue: event.target.value === "" ? null : Number(event.target.value) })} placeholder="Enter confirmed market" className="mt-1 w-full rounded-lg border bg-white p-2 dark:bg-slate-950" />
        </label>
        <p className="text-slate-500">{stampedManual ? "Stamped/manual pricing" : `${suggestion.condition} requires a manually confirmed value; no condition percentage was assumed.`}</p>
      </>}
    </div> : null}

    {showTargetCalculator && rawPokemon && confirmedMarket != null ? <div className="space-y-2 rounded-lg bg-white/70 p-2 dark:bg-slate-900/70">
      <p>Confirmed Market: <b>{money(confirmedMarket, currency)}</b></p>
      <div className="flex flex-wrap gap-1.5">
        {quickPercentages.map((percent) => <button type="button" key={percent} onClick={() => updatePricing({ targetPercent: percent })} className={`min-h-9 rounded-lg px-3 font-black ${targetPercent === percent ? "bg-violet-600 text-white" : "border border-slate-300 bg-white dark:bg-slate-950"}`}>{percent}%</button>)}
        <label className="flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 font-bold dark:bg-slate-950">Custom <input type="number" min="0" max="100" step="1" value={targetPercent} onChange={(event) => updatePricing({ targetPercent: Number(event.target.value || 0) })} className="w-14 bg-transparent text-right" />%</label>
      </div>
      <p className="text-base font-black text-violet-700 dark:text-violet-300">Offer / Purchase Price: {money(offer, currency)}</p>
    </div> : null}

    <p>Source: {providerName} · Currency: {currency} · Updated: {pricing.updatedAt || "Unavailable"} · Checked: {new Date(pricing.checkedAt).toLocaleString()}</p>
    {pricing.url ? <a href={pricing.url} target="_blank" rel="noreferrer" className="font-black text-sky-700 underline dark:text-sky-300">Open provider product</a> : null}
  </section>;
}
