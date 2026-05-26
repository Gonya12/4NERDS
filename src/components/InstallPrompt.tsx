import { Download, Share } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("pwa_install_prompt_dismissed") === "true");
  const standalone = useMemo(() => isStandalone(), []);
  const ios = useMemo(() => isIos(), []);

  useEffect(() => {
    function onPrompt(event: Event) {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone || dismissed) return null;

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
    setPromptEvent(null);
  }

  function close() {
    localStorage.setItem("pwa_install_prompt_dismissed", "true");
    setDismissed(true);
  }

  return (
    <section className="rounded-lg bg-white p-4 text-sm text-slate-600 shadow-soft dark:bg-slate-900 dark:text-slate-300">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-ink dark:text-white">Install 4 Nerds</h2>
          <p className="mt-1">Use it like an app on Android or iPhone. Sync still works through Supabase.</p>
        </div>
        <button onClick={close} className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Hide</button>
      </div>
      {promptEvent ? (
        <button onClick={install} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm font-bold text-white dark:bg-coral">
          <Download size={17} /> Install App
        </button>
      ) : ios ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-950/70 dark:text-slate-300">
          <Share size={15} /> iPhone: open in Safari, tap Share, then Add to Home Screen.
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Use your browser menu and choose Install app or Add to Home Screen.</p>
      )}
    </section>
  );
}
