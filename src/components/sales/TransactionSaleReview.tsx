import type { TradeItem, TradeTransaction, Worker } from "../../types/models";
import { formatMoney, roundMoney } from "../../utils/paymentMath";
import { hasKnownHistoricalCostBasis, transactionReview } from "../../utils/transactionMath";
import { ownershipIsValid } from "../../utils/tradeMath";

type Props = {
  transaction: TradeTransaction;
  workers: Worker[];
  onEditCostBasis: (item: TradeItem) => void;
};

function ownerName(workers: Worker[], workerId: string) {
  return workers.find((worker) => worker.id === workerId)?.name || "Owner";
}

export function TransactionSaleReview({ transaction, workers, onEditCostBasis }: Props) {
  const review = transactionReview(transaction);
  const finalBundlePrice = transaction.pricingMode === "bundle_total" ? Number(transaction.bundleTotal ?? review.sold) : review.sold;
  const ownerIds = [...new Set(review.outgoing.flatMap((item) => item.ownershipShares.map((share) => share.workerId)))];

  return <section className="space-y-3">
    <div className="surface-card p-4">
      <p className="eyebrow">Transaction Review</p>
      <h2 className="text-xl font-black">Sold · {review.outgoing.length} item{review.outgoing.length === 1 ? "" : "s"}</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-900"><small className="block text-slate-500">Final bundle price</small><b>{formatMoney(finalBundlePrice)}</b></div>
        <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-900"><small className="block text-slate-500">Complete cost basis total</small><b>{review.basisComplete ? formatMoney(review.basis) : "Incomplete"}</b></div>
        <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-900"><small className="block text-slate-500">Gross profit</small><b>{review.grossProfit == null ? "Pending cost basis" : formatMoney(review.grossProfit)}</b></div>
        <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-900"><small className="block text-slate-500">Item mode</small><b>{transaction.itemMode === "multiple" ? "Multiple" : "Single"}</b></div>
      </div>
      {!review.basisComplete ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        <p className="font-black">Cost basis required</p>
        <p>{review.missingCostBasisItems.map((item) => item.itemName || "Unnamed item").join(", ")}</p>
      </div> : null}
      {transaction.pricingMode === "bundle_total" && Math.abs(review.bundleDifference) > .009 ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">Bundle allocation is off by {formatMoney(review.bundleDifference)}.</p> : null}
      {review.outgoing.some((item) => !ownershipIsValid(item)) ? <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">One or more item ownership splits do not total 100%.</p> : null}
    </div>

    <div className="space-y-2">
      {review.outgoing.map((item) => {
        const basisKnown = hasKnownHistoricalCostBasis(item);
        const profit = basisKnown ? roundMoney(Number(item.soldPrice || 0) - item.historicalCostBasis) : undefined;
        return <article key={item.id} className="surface-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="font-black">{item.itemName || "Unnamed item"}</h3><p className="text-xs text-slate-500">{item.ownershipShares.map((share) => `${ownerName(workers, share.workerId)} ${share.ownershipPercentage}%`).join(", ") || "Ownership unassigned"}</p></div>
            {!basisKnown ? <button type="button" onClick={() => onEditCostBasis(item)} className="min-h-10 shrink-0 rounded-xl bg-amber-500 px-3 text-xs font-black text-white">Edit Cost Basis</button> : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <span className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900">Allocated sale amount<br /><b>{formatMoney(Number(item.soldPrice || 0))}</b></span>
            <span className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900">Historical cost basis<br /><b>{basisKnown ? formatMoney(item.historicalCostBasis) : "Cost basis required"}</b></span>
            <span className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900">Gross profit<br /><b>{profit == null ? "Incomplete" : formatMoney(profit)}</b></span>
            <span className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900">Owner profit allocation<br /><b>{basisKnown ? item.ownershipShares.map((share) => `${ownerName(workers, share.workerId)} ${formatMoney(roundMoney(profit! * share.ownershipPercentage / 100))}`).join(" · ") || "Ownership required" : "Pending"}</b></span>
          </div>
        </article>;
      })}
    </div>

    <div className="surface-card p-4">
      <h3 className="font-black">Owner profit shares</h3>
      {review.basisComplete
        ? ownerIds.map((workerId) => <p key={workerId} className="mt-1 text-sm">{ownerName(workers, workerId)}: <b>{formatMoney(review.ownerProfit.get(workerId) || 0)}</b></p>)
        : ownerIds.map((workerId) => <p key={workerId} className="mt-1 text-sm">{ownerName(workers, workerId)}: <b className="text-amber-700">Pending</b></p>)}
      {!ownerIds.length ? <p className="text-sm text-slate-500">Assign ownership to each item to calculate owner profit.</p> : null}
    </div>
  </section>;
}
