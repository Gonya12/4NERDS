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
  if (!files) return [] as BulkScanSelection<T>[];
  const seen = new Set(existing.map((item) => item.signature));
  return Array.from(files)
    .filter((file) => supportedBulkScanTypes.has(String(file.type).toLocaleLowerCase()))
    .map((file) => {
      const signature = bulkScanFileSignature(file);
      const possibleDuplicate = seen.has(signature);
      seen.add(signature);
      return { file, signature, possibleDuplicate };
    });
}

export function isLikelyMobileScanner() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || window.matchMedia?.("(pointer: coarse) and (max-width: 900px)").matches === true;
}
