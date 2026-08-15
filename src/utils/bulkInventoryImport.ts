export type BulkQueueFilter =
  | "all"
  | "ready"
  | "needs_review"
  | "failed"
  | "missing_variant"
  | "missing_condition"
  | "missing_price"
  | "stamped"
  | "low_confidence"
  | "possible_duplicate"
  | "confirmed";
export type BulkQueueSort = "upload" | "status" | "confidence" | "name" | "market";

export type BulkQueueItemLike = {
  uploadOrder: number;
  status: string;
  overallConfidence?: "high" | "medium" | "low";
  recognizedName?: string;
  selectedCandidate?: {
    name?: string;
    pricing?: { variants?: Array<{ name?: string; variant?: string; market?: number }> };
  };
  adjustedMarket?: number;
  baseMarket?: number;
  condition?: string;
  marketVariant?: string;
  possibleDuplicate?: boolean;
  ownershipShares?: Array<{ ownershipPercentage: number }>;
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

export type BulkReviewIssue = "match" | "variant" | "condition" | "price" | "ownership" | "ambiguous" | "failed" | "processing";

export function bulkItemPricingVariants(item: BulkQueueItemLike) {
  return item.selectedCandidate?.pricing?.variants || [];
}

export function bulkItemMarketValue(item: BulkQueueItemLike) {
  return item.condition === "Near Mint / NM"
    ? item.baseMarket ?? item.adjustedMarket
    : item.adjustedMarket;
}

export function bulkItemReviewIssues(item: BulkQueueItemLike): BulkReviewIssue[] {
  if (item.status === "confirmed") return [];
  const issues: BulkReviewIssue[] = [];
  if (item.status === "failed") issues.push("failed");
  if (item.status === "waiting" || item.status === "processing") issues.push("processing");
  if (!item.selectedCandidate) issues.push("match");
  if (bulkItemPricingVariants(item).length > 1 && !item.marketVariant) issues.push("variant");
  if (!item.condition) issues.push("condition");
  if (item.condition && bulkItemMarketValue(item) == null) issues.push("price");
  if (item.ownershipShares?.length) {
    const total = item.ownershipShares.reduce((sum, share) => sum + Number(share.ownershipPercentage || 0), 0);
    if (Math.abs(total - 100) >= 0.001) issues.push("ownership");
  }
  if (item.status === "needs_review") issues.push("ambiguous");
  return issues;
}

export function isBulkItemImportReady(item: BulkQueueItemLike) {
  if (item.status === "confirmed") return true;
  return item.status === "identified" && bulkItemReviewIssues(item).length === 0;
}

export function isStampedBulkItem(item: BulkQueueItemLike) {
  const values = [item.marketVariant, ...bulkItemPricingVariants(item).flatMap((variant) => [variant.name, variant.variant])];
  return values.some((value) => /stamp/i.test(String(value || "")));
}

export function itemMatchesBulkFilter(item: BulkQueueItemLike, filter: BulkQueueFilter) {
  if (filter === "all") return true;
  if (filter === "ready") return isBulkItemImportReady(item) && item.status !== "confirmed";
  if (filter === "needs_review") return !["confirmed", "failed", "waiting", "processing"].includes(item.status) && !isBulkItemImportReady(item);
  if (filter === "failed") return item.status === "failed";
  if (filter === "missing_variant") return bulkItemReviewIssues(item).includes("variant");
  if (filter === "missing_condition") return bulkItemReviewIssues(item).includes("condition");
  if (filter === "missing_price") return bulkItemReviewIssues(item).includes("price");
  if (filter === "stamped") return isStampedBulkItem(item);
  if (filter === "low_confidence") return item.overallConfidence === "low";
  if (filter === "possible_duplicate") return Boolean(item.possibleDuplicate);
  return item.status === "confirmed";
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
