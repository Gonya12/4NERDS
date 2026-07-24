import { ArrowRight, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { BottomNav } from "./components/BottomNav";
import { DesktopSidebar } from "./components/DesktopSidebar";
import { CalendarPage } from "./pages/CalendarPage";
import { CalendarFeedsPage } from "./pages/CalendarFeedsPage";
import { CalendarImportsPage } from "./pages/CalendarImportsPage";
import { EventDetailPage } from "./pages/EventDetailPage";
import { EventFormPage } from "./pages/EventFormPage";
import { FlyerGalleryPage } from "./pages/FlyerGalleryPage";
import { HomePage } from "./pages/HomePage";
import { NeedsToBuyPage } from "./pages/NeedsToBuyPage";
import { NjCalendarPage } from "./pages/NjCalendarPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { PastEventsPage } from "./pages/PastEventsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { db, getSettings, removeDemoData, seedWorkers } from "./services/storage/localDb";
import { listCalendarFeeds, seedDefaultCalendarFeed, syncCalendarFeed } from "./services/database/calendarFeedRepository";
import { canRunAction, markActionRun } from "./utils/supabase";
import { addDebugLog, appVersion } from "./services/debug/debugLog";
import { applyPwaUpdate, getPwaStatus, subscribePwaStatus } from "./services/pwa/registerPwa";

const SalesControlPage = lazy(() => import("./pages/SalesControlPage").then((module) => ({ default: module.SalesControlPage })));

function Onboarding({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-slate-950/60 p-3 backdrop-blur-sm sm:items-center sm:justify-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="onboarding-title" className="mx-auto w-full max-w-md rounded-panel border border-white/10 bg-white p-5 shadow-elevated dark:bg-night-850 dark:text-slate-100 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Welcome to 4 Nerds</p>
            <h2 id="onboarding-title" className="mt-1 text-2xl font-black leading-tight text-ink dark:text-white">Plan the show. Work the show.</h2>
          </div>
          <button onClick={onClose} className="icon-button" aria-label="Close welcome"><X size={18} /></button>
        </div>
        <ol className="mt-5 space-y-2 text-sm text-slate-600 dark:text-slate-300">
          {["Add vendor events", "Open the event plan", "Confirm who can work"].map((label, index) => (
            <li key={label} className="surface-muted flex min-h-12 items-center gap-3 px-3 py-2 font-bold">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-xs font-black text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <button onClick={onClose} className="btn-primary mt-5 w-full">Start Planning <ArrowRight size={17} /></button>
      </section>
    </div>
  );
}

function ScrollToTop({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.documentElement.scrollTo?.({ top: 0, left: 0, behavior: "instant" });
    document.body.scrollTo?.({ top: 0, left: 0, behavior: "instant" });
    containerRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, containerRef]);

  return null;
}

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [pwaStatus, setPwaStatus] = useState(getPwaStatus());
  const mainRef = useRef<HTMLElement | null>(null);
  const location = useLocation();

  useEffect(() => subscribePwaStatus(() => setPwaStatus(getPwaStatus())), []);

  useEffect(() => {
    addDebugLog("route", "Route changed", { route: location.pathname, version: appVersion });
  }, [location.pathname]);

  useEffect(() => {
    async function boot() {
      await removeDemoData();
      await seedWorkers();
      const settings = await getSettings();
      setShowOnboarding(!settings.onboardingComplete);
      await seedDefaultCalendarFeed();
      void listCalendarFeeds().then((feeds) => {
        const cutoff = Date.now() - 12 * 60 * 60 * 1000;
        const staleAutoFeeds = feeds.filter((feed) => feed.enabled && feed.autoImport && (!feed.lastCheckedAt || new Date(feed.lastCheckedAt).getTime() < cutoff));
        if (!staleAutoFeeds.length || !canRunAction("app-calendar-auto-sync", 12 * 60 * 60 * 1000)) return undefined;
        markActionRun("app-calendar-auto-sync");
        return Promise.allSettled(staleAutoFeeds.map((feed) => syncCalendarFeed(feed)));
      }).catch(() => undefined);
    }
    void boot();
  }, []);

  async function closeOnboarding() {
    const settings = await getSettings();
    await db.settings.put({ ...settings, onboardingComplete: true, updatedAt: new Date().toISOString() });
    setShowOnboarding(false);
  }

  return (
    <div className="min-h-screen bg-transparent text-ink transition-colors duration-240 dark:text-slate-100">
      <ScrollToTop containerRef={mainRef} />
      <DesktopSidebar />
      <main ref={mainRef} id="main-content" className="mx-auto min-h-[100dvh] max-w-md px-4 pb-36 pt-4 sm:max-w-2xl sm:px-5 md:max-w-4xl lg:ml-64 lg:max-w-none lg:px-8 lg:pb-10 lg:pt-6 xl:px-10">
        <div key={location.pathname} className="page-enter">
          <Routes location={location}>
            <Route path="/" element={<HomePage />} />
            <Route path="/events" element={<CalendarPage />} />
            <Route path="/calendar-feeds" element={<CalendarFeedsPage />} />
            <Route path="/calendar-imports" element={<CalendarImportsPage />} />
            <Route path="/nj-calendar" element={<NjCalendarPage />} />
            <Route path="/past" element={<PastEventsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/flyers" element={<FlyerGalleryPage />} />
            <Route path="/sales" element={<Suspense fallback={<div className="surface-card p-5 font-bold">Loading Sales Control…</div>}><SalesControlPage /></Suspense>} />
            <Route path="/buy" element={<NeedsToBuyPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/events/new" element={<EventFormPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
            <Route path="/events/:id/edit" element={<EventFormPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      <BottomNav />
      {pwaStatus.needRefresh ? (
        <div className="fixed inset-x-4 bottom-24 z-50 rounded-panel border border-coral/30 bg-night-850 p-4 text-white shadow-elevated lg:bottom-6 lg:left-auto lg:max-w-sm">
          <p className="text-sm font-black">Update Available</p>
          <p className="mt-1 text-xs text-slate-300">A newer 4 Nerds build is ready. Reload to avoid stale PWA cache.</p>
          <button onClick={applyPwaUpdate} className="btn-primary mt-3 w-full">Reload</button>
        </div>
      ) : null}
      {showOnboarding ? <Onboarding onClose={closeOnboarding} /> : null}
    </div>
  );
}
