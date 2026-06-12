import { AlertCircle, RefreshCw } from "lucide-react";

export function ErrorState({ message, details, onRetry, onSync }: { message: string; details?: string; onRetry?: () => void; onSync?: () => void }) {
  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/25">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-300" size={20} />
        <div className="min-w-0 flex-1">
          <h2 className="font-black text-rose-800 dark:text-rose-100">Could not load data</h2>
          <p className="mt-1 text-sm text-rose-700 dark:text-rose-200">{message}</p>
          {details ? <details className="mt-2 text-xs text-rose-700 dark:text-rose-300"><summary className="cursor-pointer font-bold">Technical details</summary><pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-white/60 p-3 font-mono leading-5 dark:bg-slate-950/50">{details}</pre></details> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry ? <button onClick={onRetry} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-rose-700 px-3 text-sm font-bold text-white"><RefreshCw size={15} /> Retry</button> : null}
            {onSync ? <button onClick={onSync} className="min-h-10 rounded-xl bg-white px-3 text-sm font-bold text-rose-700 dark:bg-slate-900 dark:text-rose-200">Sync Now</button> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
