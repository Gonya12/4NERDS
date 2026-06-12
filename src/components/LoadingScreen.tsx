import { useEffect, useState } from "react";
import { SkeletonCard } from "./SkeletonCard";

export function LoadingScreen({ label = "Loading data...", children }: { label?: string; children?: React.ReactNode }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-w-0 max-w-full space-y-4" aria-busy="true">
      <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400">
        <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-coral" />
        <span className="min-w-0 break-words">{slow ? "Still loading data..." : label}</span>
      </div>
      {children || (
        <div className="grid gap-3 md:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
    </div>
  );
}
