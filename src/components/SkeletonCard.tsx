export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900 ${className}`}>
      <div className="h-4 w-2/5 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-3 h-6 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-3 h-4 w-full rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-2 h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-800" />
    </div>
  );
}
