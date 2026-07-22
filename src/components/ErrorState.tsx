import { AlertCircle, RefreshCw } from "lucide-react";

export function ErrorState({ message, details, onRetry, onSync }: { message: string; details?: string; onRetry?: () => void; onSync?: () => void }) {
  return (
    <section role="alert" className="overflow-hidden rounded-panel border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-4 shadow-card dark:border-rose-900/60 dark:from-rose-950/30 dark:to-night-850">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300"><AlertCircle size={20} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-black text-rose-800 dark:text-rose-100">Could not load data</h2>
          <p className="mt-1 text-sm text-rose-700 dark:text-rose-200">{message}</p>
          {details ? <details className="mt-3 text-xs text-rose-700 dark:text-rose-300"><summary className="inline-flex min-h-9 cursor-pointer items-center rounded-lg px-2 font-bold transition hover:bg-rose-100/70 dark:hover:bg-rose-950/40">Technical details</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-rose-100 bg-white/70 p-3 font-mono leading-5 dark:border-rose-900/50 dark:bg-night-950/70">{details}</pre></details> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry ? <button onClick={onRetry} className="btn-danger bg-rose-700 text-white hover:bg-rose-800 dark:bg-rose-700"><RefreshCw size={15} /> Retry</button> : null}
            {onSync ? <button onClick={onSync} className="btn-secondary text-rose-700 dark:text-rose-200">Sync Now</button> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
