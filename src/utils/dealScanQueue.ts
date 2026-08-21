import { bulkImportCapacity } from "./bulkInventoryImport";

export type BulkScanFileLike = Pick<File, "name" | "size" | "type" | "lastModified">;

export type BulkScanSelection<T extends BulkScanFileLike> = {
  file: T;
  signature: string;
  possibleDuplicate: boolean;
};

const supportedBulkScanTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function bulkScanFileSignature(file: BulkScanFileLike) {
  return `${file.name.toLocaleLowerCase()}::${file.size}::${file.lastModified}`;
}

export function appendBulkScanSelection<T extends BulkScanFileLike>(
  existing: Array<Pick<BulkScanSelection<T>, "signature">>,
  files: ArrayLike<T> | null | undefined,
) {
  return appendBulkScanSelectionWithCapacity(existing, files).selections;
}

export function appendBulkScanSelectionWithCapacity<T extends BulkScanFileLike>(
  existing: Array<Pick<BulkScanSelection<T>, "signature">>,
  files: ArrayLike<T> | null | undefined,
) {
  if (!files) return { selections: [] as BulkScanSelection<T>[], skipped: 0, unsupported: 0, remaining: bulkImportCapacity(existing.length, 0).remaining };
  const supported = Array.from(files).filter((file) => supportedBulkScanTypes.has(String(file.type).toLocaleLowerCase()));
  const unsupported = Array.from(files).length - supported.length;
  const capacity = bulkImportCapacity(existing.length, supported.length);
  const seen = new Set(existing.map((item) => item.signature));
  const selections = supported
    .slice(0, capacity.accepted)
    .map((file) => {
      const signature = bulkScanFileSignature(file);
      const possibleDuplicate = seen.has(signature);
      seen.add(signature);
      return { file, signature, possibleDuplicate };
    });
  return { selections, skipped: capacity.skipped, unsupported, remaining: capacity.remaining };
}

export function compactBulkScanRecovery<T extends { file?: unknown; previewUrl?: string; suggestion?: unknown }>(rows: T[]) {
  return rows.map(({ file: _file, previewUrl, suggestion: _suggestion, ...row }) => ({
    ...row,
    previewUrl: previewUrl?.startsWith("blob:") || previewUrl?.startsWith("data:image") ? undefined : previewUrl,
  }));
}

export function isLikelyMobileScanner() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || window.matchMedia?.("(pointer: coarse) and (max-width: 900px)").matches === true;
}
