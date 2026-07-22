import { Calculator } from "lucide-react";
import { formatMoney, roundMoney } from "../../utils/paymentMath";

type Props = {
  marketValue: string;
  buyPercentage: string;
  actualCost: string;
  onMarketValue: (value: string) => void;
  onPercentage: (value: string) => void;
  onActualCost: (value: string) => void;
};

export function RawCardCalculator({ marketValue, buyPercentage, actualCost, onMarketValue, onPercentage, onActualCost }: Props) {
  const market = Number(marketValue || 0);
  const percentage = Number(buyPercentage || 0);
  const actual = Number(actualCost || 0);
  const target = roundMoney(market * percentage / 100);
  const difference = roundMoney(actual - target);
  const potentialProfit = roundMoney(market - actual);
  const margin = market > 0 ? roundMoney((potentialProfit / market) * 100) : 0;

  return (
    <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
      <div className="flex items-center gap-2">
        <Calculator size={17} className="text-amber-600" />
        <div>
          <p className="text-sm font-black text-ink dark:text-white">Raw Pokémon Card Calculator</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">A recommendation only. Your actual cost stays editable.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Market value
          <input type="number" min="0" step="0.01" value={marketValue} onChange={(event) => onMarketValue(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-base dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
        </label>
        <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Buy percentage
          <input type="number" min="1" max="100" step="1" value={buyPercentage} onChange={(event) => onPercentage(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-base dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[75, 80].map((value) => <button type="button" key={value} onClick={() => onPercentage(String(value))} className="min-h-10 rounded-xl bg-white text-sm font-black text-ink shadow-sm dark:bg-slate-900 dark:text-white">{value}%</button>)}
        <button type="button" onClick={() => onActualCost(String(target))} disabled={!target} className="min-h-10 rounded-xl bg-amber-500 text-sm font-black text-white disabled:opacity-50">Use target</button>
      </div>
      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">Actual bought price
        <input type="number" min="0" step="0.01" value={actualCost} onChange={(event) => onActualCost(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-base dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
      </label>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-xl bg-white p-2 dark:bg-slate-900"><p className="text-slate-500">Target</p><p className="font-black">{formatMoney(target)}</p></div>
        <div className="rounded-xl bg-white p-2 dark:bg-slate-900"><p className="text-slate-500">From target</p><p className={`font-black ${difference <= 0 ? "text-emerald-600" : "text-rose-600"}`}>{difference > 0 ? "+" : ""}{formatMoney(difference)}</p></div>
        <div className="rounded-xl bg-white p-2 dark:bg-slate-900"><p className="text-slate-500">Potential profit</p><p className="font-black text-emerald-600">{formatMoney(potentialProfit)}</p></div>
        <div className="rounded-xl bg-white p-2 dark:bg-slate-900"><p className="text-slate-500">Margin</p><p className="font-black">{margin.toFixed(1)}%</p></div>
      </div>
    </section>
  );
}
