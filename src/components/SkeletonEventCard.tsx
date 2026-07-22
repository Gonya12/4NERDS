export function SkeletonEventCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className="skeleton-shimmer surface-card min-w-0 max-w-full overflow-hidden p-3">
      <div className={`${compact ? "aspect-[4/3]" : "aspect-[4/5]"} rounded-xl bg-slate-200 dark:bg-slate-800`} />
      <div className="mt-3 h-5 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-2 h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-3 h-14 rounded-xl bg-slate-100 dark:bg-slate-950" />
    </div>
  );
}
