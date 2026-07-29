import { Calculator } from "lucide-react";
import { calculateTargetPrice, targetPricePercentages } from "../../utils/cardPricing";
import { formatMoney } from "../../utils/paymentMath";

type Props = {
  marketValue: number;
  percentage: number;
  onPercentage: (percentage: number) => void;
  actionLabel?: string;
  onApply?: (amount: number) => void;
  note?: string;
};

export function TargetPriceCalculator({ marketValue, percentage, onPercentage, actionLabel, onApply, note }: Props) {
  const target = calculateTargetPrice(marketValue, percentage);
  return <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
    <div className="flex items-center gap-2">
      <Calculator size={17} className="text-amber-600" />
      <div><p className="text-sm font-black text-ink dark:text-white">Target price calculator</p><p className="text-xs text-slate-500 dark:text-slate-400">{note || "A pricing reference. Financial values change only through the labeled action."}</p></div>
    </div>
    <div className="grid grid-cols-3 gap-2">
      {targetPricePercentages.map((value) => <button type="button" key={value} onClick={() => onPercentage(value)} className={`min-h-12 rounded-xl px-2 text-xs font-black ${percentage === value ? "bg-amber-500 text-white" : "bg-white text-ink shadow-sm dark:bg-slate-900 dark:text-white"}`}>{value}%<span className="block">{formatMoney(calculateTargetPrice(marketValue, value))}</span></button>)}
    </div>
    <label className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs font-black text-slate-600 dark:text-slate-300">Custom % <input type="number" min="0" max="100" step="1" value={percentage} onChange={(event) => onPercentage(Math.max(0, Math.min(100, Number(event.target.value || 0))))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-950" /></label>
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 dark:bg-slate-900"><span className="text-xs font-bold text-slate-500">Target amount</span><b>{formatMoney(target)}</b></div>
    {actionLabel && onApply ? <button type="button" disabled={!marketValue} onClick={() => onApply(target)} className="min-h-11 w-full rounded-xl bg-amber-500 px-4 text-sm font-black text-white disabled:opacity-40">{actionLabel}</button> : null}
  </section>;
}
