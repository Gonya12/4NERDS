export function SkeletonEventCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl bg-white/90 p-3 shadow-soft dark:bg-slate-900">
      <div className={`${compact ? "aspect-[4/3]" : "aspect-[4/5]"} rounded-xl bg-slate-200 dark:bg-slate-800`} />
      <div className="mt-3 h-5 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-2 h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-3 h-14 rounded-xl bg-slate-100 dark:bg-slate-950" />
    </div>
  );
}
