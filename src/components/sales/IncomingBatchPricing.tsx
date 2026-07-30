import { useState } from "react";
import type { TradeItem } from "../../types/models";
import { applyIncomingPercentage, calculateTargetPrice, targetPricePercentages } from "../../utils/cardPricing";
import { formatMoney } from "../../utils/paymentMath";

type Props = { items: TradeItem[]; mode: "purchase" | "trade"; onApply: (items: TradeItem[]) => void };

export function IncomingBatchPricing({ items, mode, onApply }: Props) {
  const [pending, setPending] = useState<number>();
  const incoming = items.filter((item) => item.direction === "incoming");
  if (incoming.length < 2) return null;
  const confirm = () => {
    if (pending == null) return;
    onApply(applyIncomingPercentage(items, pending, mode));
    setPending(undefined);
  };
  return <section className="surface-card space-y-3 p-4">
    <div><h3 className="font-black">Batch incoming pricing</h3><p className="text-xs text-slate-500">Outgoing inventory is never changed. {mode === "purchase" ? "This sets target prices; Cash Paid still requires a deliberate item action." : "This sets each incoming Accepted Trade Value."}</p></div>
    <div className="grid grid-cols-3 gap-2">{targetPricePercentages.map((value) => <button type="button" key={value} onClick={() => setPending(value)} className="min-h-11 rounded-xl bg-amber-100 text-xs font-black text-amber-900">Apply {value}%</button>)}</div>
    {pending != null ? <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3"><p className="font-black">Preview {pending}% for {incoming.length} incoming items</p><div className="mt-2 max-h-44 space-y-1 overflow-y-auto text-sm">{incoming.map((item) => <p key={item.id} className="flex justify-between gap-3"><span className="truncate">{item.itemName || "Unnamed item"}</span><b>{formatMoney(calculateTargetPrice(item.marketValue, pending))}</b></p>)}</div><div className="mt-3 flex gap-2"><button type="button" onClick={() => setPending(undefined)} className="min-h-10 flex-1 rounded-xl bg-white font-black">Cancel</button><button type="button" onClick={confirm} className="min-h-10 flex-1 rounded-xl bg-amber-600 font-black text-white">Confirm</button></div></div> : null}
  </section>;
}
