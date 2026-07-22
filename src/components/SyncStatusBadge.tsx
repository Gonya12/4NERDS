import { RefreshCw } from "lucide-react";

export function SyncStatusBadge({ syncing, label = "Syncing..." }: { syncing: boolean; label?: string }) {
  if (!syncing) return null;
  return (
    <span role="status" className="inline-flex min-h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50/90 px-3 text-xs font-bold text-orange-700 shadow-sm dark:border-orange-900/70 dark:bg-orange-950/30 dark:text-orange-200">
      <RefreshCw size={13} className="shrink-0 animate-spin" />
      <span className="truncate">{label}</span>
    </span>
  );
}
