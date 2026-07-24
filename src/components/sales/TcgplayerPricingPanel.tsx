import type { CardScanSuggestion } from "../../services/sales/cardScanService";

type Props = {
  suggestion: CardScanSuggestion;
  isSlab: boolean;
  onChange: (value: CardScanSuggestion) => void;
};

const money = (value?: number) => value == null ? "Unavailable" : `$${value.toFixed(2)}`;
const variantLabel = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());

export function TcgplayerPricingPanel({ suggestion, isSlab, onChange }: Props) {
  const pricing = suggestion.tcgplayerPricing;
  if (!pricing) return null;
  const selected = pricing.variants.find((row) => row.variant === pricing.selectedVariant);
  const targetPercent = pricing.targetPercent ?? 75;
  const updatePricing = (patch: Partial<typeof pricing>) => {
    onChange({ ...suggestion, tcgplayerPricing: { ...pricing, ...patch } });
  };

  return <section className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-slate-800">
    <strong>{isSlab ? "Raw card market reference" : "TCGplayer pricing"}</strong>
    {isSlab ? <p>Reference only. Raw-card prices are not graded-slab market values and will not be applied automatically.</p> : null}
    {!pricing.variants.length ? <p className="font-black text-amber-700">TCGplayer market price unavailable. Enter market value manually.</p> : <label className="block font-bold">
      Physical finish / version
      <select
        value={pricing.selectedVariant || ""}
        onChange={(event) => updatePricing({ selectedVariant: event.target.value || undefined })}
        className="mt-1 w-full rounded-lg border bg-white p-2"
      >
        <option value="">{pricing.variants.length > 1 ? "Choose finish/version" : "Choose available finish"}</option>
        {pricing.variants.map((row) => <option key={row.variant} value={row.variant}>{variantLabel(row.variant)}</option>)}
      </select>
    </label>}
    {selected ? <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <span>Market<br /><b>{money(selected.market)}</b></span>
        <span>Low<br /><b>{money(selected.low)}</b></span>
        <span>Mid<br /><b>{money(selected.mid)}</b></span>
        <span>High<br /><b>{money(selected.high)}</b></span>
        <span>Direct Low<br /><b>{money(selected.directLow)}</b></span>
      </div>
      {!isSlab && selected.market != null ? <div className="rounded-lg bg-white/70 p-2">
        <p>75% target: <b>{money(selected.market * 0.75)}</b> · 80% target: <b>{money(selected.market * 0.8)}</b></p>
        <label className="mt-2 flex items-center gap-2 font-bold">
          Custom target
          <input
            type="number"
            min="0"
            max="200"
            step="1"
            value={targetPercent}
            onChange={(event) => updatePricing({ targetPercent: Number(event.target.value || 0) })}
            className="w-20 rounded-lg border bg-white p-1.5"
          />
          % = <b>{money(selected.market * targetPercent / 100)}</b>
        </label>
      </div> : null}
    </> : pricing.variants.length ? <p className="font-bold text-amber-700">Select the finish printed on the physical card before applying market value.</p> : null}
    <p>Source: TCGplayer · Updated: {pricing.updatedAt || "Unavailable"} · Checked: {new Date(pricing.checkedAt).toLocaleString()}</p>
    {pricing.url ? <a href={pricing.url} target="_blank" rel="noreferrer" className="font-black text-sky-700 underline">Open on TCGplayer</a> : null}
  </section>;
}
