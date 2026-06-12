import { SkeletonEventCard } from "./SkeletonEventCard";

export function SkeletonDashboard() {
  return (
    <div className="space-y-4" aria-label="Loading dashboard">
      <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
      <div className="-mx-4 flex gap-3 overflow-hidden px-4 lg:mx-0 lg:grid lg:grid-cols-3 lg:px-0">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="w-[84vw] max-w-[380px] shrink-0 lg:w-auto lg:max-w-none">
            <SkeletonEventCard />
          </div>
        ))}
      </div>
    </div>
  );
}
