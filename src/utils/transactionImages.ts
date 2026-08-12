export const TRANSACTION_PHOTO_LIMIT = 20;

export function fitImagesWithinLimit<T>(selected: T[], existingCount: number, limit: number) {
  const available = Math.max(0, limit - Math.max(0, existingCount));
  const accepted = selected.slice(0, available);
  return {
    accepted,
    skippedCount: Math.max(0, selected.length - accepted.length),
    available
  };
}
