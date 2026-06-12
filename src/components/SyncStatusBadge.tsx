import { RefreshCw } from "lucide-react";

export function SyncStatusBadge({ syncing, label = "Syncing..." }: { syncing: boolean; label?: string }) {
  if (!syncing) return null;
  return (
    <span className="inline-flex min-h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-white px-3 text-xs font-bold text-slate-600 shadow-soft dark:bg-slate-900 dark:text-slate-300">
      <RefreshCw size={13} className="shrink-0 animate-spin" />
      <span className="truncate">{label}</span>
    </span>
  );
}
