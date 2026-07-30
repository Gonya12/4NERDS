import type { TradeItem, TradeTransaction, Worker } from "../../types/models";
import { formatMoney } from "../../utils/paymentMath";
import {
  allocateOwnershipCostBasis,
  purchaseAccountingValidationError,
  transactionReview
} from "../../utils/transactionMath";

type Props = {
  transaction: TradeTransaction;
  workers: Worker[];
  onEditItem: (item: TradeItem) => void;
};

export function TransactionPurchaseReview({ transaction, workers, onEditItem }: Props) {
  const review = transactionReview(transaction);
  const validationError = purchaseAccountingValidationError(transaction);
  const workerName = (workerId: string) =>
    workers.find((worker) => worker.id === workerId)?.name || "Owner";
  const cashPaid = transaction.pricingMode === "bundle_total"
    ? Number(transaction.bundleTotal || 0)
    : review.bought;

  return <section className="space-y-3">
    <div className="surface-card p-4">
      <p className="eyebrow">Inventory Purchase Review</p>
      <h2 className="text-xl font-black">{transaction.items.length} item{transaction.items.length === 1 ? "" : "s"}</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          ["Cash paid", cashPaid],
          ["Item count", transaction.items.length],
          ["Total cash paid", review.bought],
          ["Assigned inventory cost", review.purchaseCostBasis],
          ["Market value", review.marketValue],
          ["Potential margin", review.potentialMargin]
        ].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-100 p-3 dark:bg-slate-900">
          <small className="block text-slate-500">{label}</small>
          <b>{label === "Item count" ? Number(value) : formatMoney(Number(value))}</b>
        </div>)}
        <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-900">
          <small className="block text-slate-500">Who paid</small>
          <b>{transaction.paidByWorkerId ? workerName(transaction.paidByWorkerId) : "Unassigned"}</b>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">Potential margin is market value minus inventory cost. It is not realized sales profit.</p>
      {validationError ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{validationError}</p> : null}
    </div>

    {transaction.items.filter((item) => item.direction === "incoming").map((item) => {
      const shares = allocateOwnershipCostBasis(item.ownershipShares, item.costBasis);
      return <article key={item.id} className="surface-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black">{item.itemName || "Unnamed item"}</h3>
            <p className="text-sm text-slate-500">
              Cash paid {formatMoney(item.boughtPrice || 0)} · Item cost basis {formatMoney(item.costBasis)} · Market {formatMoney(item.marketValue)}
            </p>
          </div>
          <button type="button" onClick={() => onEditItem(item)} className="min-h-10 rounded-xl bg-violet-100 px-3 text-xs font-black text-violet-700">
            Edit
          </button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {shares.map((share) => <div key={share.workerId} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900">
            <b>{workerName(share.workerId)}</b>
            <p className="text-slate-500">{share.ownershipPercentage}% ownership · {formatMoney(share.allocatedCostBasis || 0)} allocated cost</p>
          </div>)}
        </div>
      </article>;
    })}
  </section>;
}
