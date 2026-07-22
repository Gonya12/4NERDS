export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`skeleton-shimmer surface-card p-4 ${className}`}>
      <div className="h-4 w-2/5 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-3 h-6 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-3 h-4 w-full rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-2 h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-800" />
    </div>
  );
}
