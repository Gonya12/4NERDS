import type { CardScanSuggestion } from "../../services/sales/cardScanService";
type Props = { suggestion: CardScanSuggestion; isSlab: boolean; onChange: (value: CardScanSuggestion) => void };
const money = (value?: number) => value == null ? "Unavailable" : `$${value.toFixed(2)}`;
export function TcgplayerPricingPanel({ suggestion, isSlab, onChange }: Props) {
  const pricing = suggestion.tcgplayerPricing;
  if (!pricing) return null;
  const selected = pricing.variants.find((row) => row.variant === pricing.selectedVariant);
  return <section className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-slate-800"><strong>{isSlab ? "Raw card market reference" : "TCGplayer pricing"}</strong>{isSlab ? <p>Reference only; this will not become the graded slab market value.</p> : null}
    {!pricing.variants.length ? <p className="font-black text-amber-700">TCGplayer market price unavailable. Enter market value manually.</p> : pricing.variants.length > 1 ? <select value={pricing.selectedVariant || ""} onChange={(event) => onChange({ ...suggestion, tcgplayerPricing: { ...pricing, selectedVariant: event.target.value || undefined } })} className="w-full rounded-lg border bg-white p-2"><option value="">Choose finish/version</option>{pricing.variants.map((row) => <option key={row.variant} value={row.variant}>{row.variant.replace(/([a-z])([A-Z])/g, "$1 $2")}</option>)}</select> : null}
    {selected ? <><div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><span>Market<br /><b>{money(selected.market)}</b></span><span>Low<br /><b>{money(selected.low)}</b></span><span>Mid<br /><b>{money(selected.mid)}</b></span><span>High<br /><b>{money(selected.high)}</b></span><span>Direct Low<br /><b>{money(selected.directLow)}</b></span></div>{!isSlab && selected.market != null ? <p>75% target: <b>{money(selected.market * .75)}</b> · 80% target: <b>{money(selected.market * .8)}</b></p> : null}</> : pricing.variants.length ? <p>Select the physical finish before applying its market value.</p> : null}
    <p>Updated: {pricing.updatedAt || "Unavailable"} · Checked: {new Date(pricing.checkedAt).toLocaleString()}</p>{pricing.url ? <a href={pricing.url} target="_blank" rel="noreferrer" className="font-black text-sky-700 underline">Open on TCGplayer</a> : null}</section>;
}
