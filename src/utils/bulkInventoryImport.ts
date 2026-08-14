export type BulkQueueFilter = "all" | "ready" | "needs_review" | "failed" | "confirmed";
export type BulkQueueSort = "upload" | "status" | "confidence" | "name" | "market";

export type BulkQueueItemLike = {
  uploadOrder: number;
  status: string;
  overallConfidence?: "high" | "medium" | "low";
  recognizedName?: string;
  selectedCandidate?: { name?: string };
  adjustedMarket?: number;
  baseMarket?: number;
  condition?: string;
  possibleDuplicate?: boolean;
};

const statusOrder: Record<string, number> = {
  failed: 0,
  needs_review: 1,
  identified: 2,
  waiting: 3,
  processing: 4,
  confirmed: 5,
};

const confidenceOrder = { low: 0, medium: 1, high: 2 } as const;

export function itemMatchesBulkFilter(item: BulkQueueItemLike, filter: BulkQueueFilter) {
  if (filter === "all") return true;
  if (filter === "ready") return item.status === "identified";
  return item.status === filter;
}

export function filterBulkQueue<T extends BulkQueueItemLike>(items: T[], options: {
  filter: BulkQueueFilter;
  lowConfidenceOnly?: boolean;
  missingPriceOnly?: boolean;
  missingConditionOnly?: boolean;
  duplicatesOnly?: boolean;
}) {
  return items.filter((item) => itemMatchesBulkFilter(item, options.filter)
    && (!options.lowConfidenceOnly || item.overallConfidence === "low")
    && (!options.missingPriceOnly || (item.adjustedMarket == null && item.baseMarket == null))
    && (!options.missingConditionOnly || !item.condition)
    && (!options.duplicatesOnly || item.possibleDuplicate));
}

export function sortBulkQueue<T extends BulkQueueItemLike>(items: T[], sort: BulkQueueSort) {
  return [...items].sort((left, right) => {
    if (sort === "status") return (statusOrder[left.status] ?? 99) - (statusOrder[right.status] ?? 99) || left.uploadOrder - right.uploadOrder;
    if (sort === "confidence") return (confidenceOrder[left.overallConfidence || "low"] - confidenceOrder[right.overallConfidence || "low"]) || left.uploadOrder - right.uploadOrder;
    if (sort === "name") return String(left.selectedCandidate?.name || left.recognizedName || "").localeCompare(String(right.selectedCandidate?.name || right.recognizedName || "")) || left.uploadOrder - right.uploadOrder;
    if (sort === "market") return Number(right.adjustedMarket ?? right.baseMarket ?? -1) - Number(left.adjustedMarket ?? left.baseMarket ?? -1) || left.uploadOrder - right.uploadOrder;
    return left.uploadOrder - right.uploadOrder;
  });
}

export function pageBulkQueue<T>(items: T[], page: number, pageSize: number) {
  const safeSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / safeSize));
  const safePage = Math.min(pageCount, Math.max(1, Math.floor(page)));
  return { page: safePage, pageCount, items: items.slice((safePage - 1) * safeSize, safePage * safeSize) };
}

export async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency = 3, onSettled?: (completed: number) => void) {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
      completed += 1;
      onSettled?.(completed);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), tasks.length) }, worker));
  return results;
}
