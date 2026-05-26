import type { Event, Worker } from "../types/models";

export function roundMoney(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: number) {
  return `$${roundMoney(value).toFixed(2)}`;
}

export function calculateEqualShare(eventCost: number, confirmedWorkerCount: number) {
  if (!confirmedWorkerCount) return 0;
  return roundMoney(eventCost / confirmedWorkerCount);
}

export function calculatePaymentSummary(event: Event, workers: Worker[]) {
  const totalCost = roundMoney(event.eventCost || 0);
  const confirmedIds = event.confirmedWorkerIds || [];
  const confirmedWorkerCount = confirmedIds.length;
  const equalSharePerWorker = calculateEqualShare(totalCost, confirmedWorkerCount);
  const records = event.paymentRecords || [];
  const workerMap = new Map(workers.map((worker) => [worker.id, worker]));
  const totalPaid = roundMoney(records.reduce((sum, record) => sum + Number(record.amountPaid || 0), 0));
  const totalRemaining = roundMoney(totalCost - totalPaid);

  const perWorkerSummary = confirmedIds.map((workerId) => {
    const amountPaid = roundMoney(records.filter((record) => record.workerId === workerId).reduce((sum, record) => sum + Number(record.amountPaid || 0), 0));
    const balance = roundMoney(equalSharePerWorker - amountPaid);
    return {
      workerId,
      workerName: workerMap.get(workerId)?.name || "Unknown worker",
      amountPaid,
      expectedShare: equalSharePerWorker,
      balance,
      percentOfTotalPaid: totalCost > 0 ? roundMoney((amountPaid / totalCost) * 100) : 0,
      status: balance === 0 ? "paid" as const : balance > 0 ? "owes" as const : "overpaid" as const
    };
  });

  const overpaid = perWorkerSummary.filter((worker) => worker.balance < 0).map((worker) => ({ ...worker, credit: Math.abs(worker.balance) }));
  const owing = perWorkerSummary.filter((worker) => worker.balance > 0).map((worker) => ({ ...worker, owed: worker.balance }));
  const internalBalanceNotes: string[] = [];
  let overpayIndex = 0;
  let remainingCredit = overpaid[0]?.credit || 0;
  for (const debtor of owing) {
    let remainingDebt = debtor.owed;
    while (remainingDebt > 0 && overpayIndex < overpaid.length) {
      const creditor = overpaid[overpayIndex];
      const amount = roundMoney(Math.min(remainingDebt, remainingCredit));
      if (amount > 0) internalBalanceNotes.push(`${debtor.workerName} owes ${creditor.workerName} ${formatMoney(amount)}`);
      remainingDebt = roundMoney(remainingDebt - amount);
      remainingCredit = roundMoney(remainingCredit - amount);
      if (remainingCredit <= 0) {
        overpayIndex += 1;
        remainingCredit = overpaid[overpayIndex]?.credit || 0;
      }
    }
  }

  return {
    totalCost,
    totalPaid,
    totalRemaining,
    confirmedWorkerCount,
    equalSharePerWorker,
    perWorkerSummary,
    internalBalanceNotes,
    isOverpaid: totalPaid > totalCost,
    overpaidAmount: totalPaid > totalCost ? roundMoney(totalPaid - totalCost) : 0
  };
}
