import { Component, type ErrorInfo, type ReactNode } from "react";
import { appBuildTime, appVersion } from "../services/debug/debugLog";
import { clearAppCaches, recoverChunkLoadOnce, saveStartupError } from "../services/startupRecovery";

type State = { error?: Error };

export class GlobalErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    saveStartupError(error);
    recoverChunkLoadOnce(error);
  }

  render() {
    const error = this.state.error;
    if (!error) return this.props.children;
    return <main className="flex min-h-[100dvh] items-center justify-center bg-slate-100 p-4 text-slate-950 dark:bg-slate-950 dark:text-white">
      <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <p className="text-sm font-black uppercase tracking-wide text-orange-600">4 Nerds recovery</p>
        <h1 className="mt-2 text-2xl font-black">Something went wrong while loading 4 Nerds.</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Your records were not changed. Reload the app, or clear stale app files if this followed an update.</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <button onClick={() => window.location.reload()} className="rounded-xl bg-orange-600 px-3 py-3 font-black text-white">Reload App</button>
          <button onClick={() => { void clearAppCaches().finally(() => window.location.reload()); }} className="rounded-xl bg-slate-800 px-3 py-3 font-black text-white">Clear App Cache and Reload</button>
          <button onClick={() => { window.history.replaceState(null, "", "/"); window.location.reload(); }} className="rounded-xl border border-slate-300 px-3 py-3 font-black">Return to Dashboard</button>
        </div>
        <details className="mt-4 rounded-xl bg-slate-100 p-3 text-xs dark:bg-slate-800">
          <summary className="cursor-pointer font-black">Technical Details</summary>
          <p className="mt-2 break-words"><strong>Error:</strong> {error.message}</p>
          <p><strong>Route:</strong> {window.location.pathname}</p>
          <p><strong>Version:</strong> {appVersion} ({appBuildTime})</p>
          <p className="break-words"><strong>Browser:</strong> {navigator.userAgent}</p>
        </details>
      </section>
    </main>;
  }
}
