import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
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
import { SalesControlPage } from "./pages/SalesControlPage";
import { SettingsPage } from "./pages/SettingsPage";
import { db, getSettings, removeDemoData, seedWorkers } from "./services/storage/localDb";
import { listCalendarFeeds, seedDefaultCalendarFeed, syncCalendarFeed } from "./services/database/calendarFeedRepository";
import { canRunAction, markActionRun } from "./utils/supabase";
import { addDebugLog, appVersion } from "./services/debug/debugLog";
import { applyPwaUpdate, getPwaStatus, subscribePwaStatus } from "./services/pwa/registerPwa";

function Onboarding({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-slate-950/30 p-4">
      <section className="mx-auto w-full max-w-md rounded-lg bg-white p-5 shadow-soft dark:bg-slate-900 dark:text-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-coral">Welcome to 4 Nerds</p>
            <h2 className="mt-1 text-xl font-black text-ink dark:text-white">Plan events in three steps.</h2>
          </div>
          <button onClick={onClose} className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
        </div>
        <ol className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <li><strong>1. Add vendor events.</strong></li>
          <li><strong>2. Open an event.</strong></li>
          <li><strong>3. Confirm who can work it.</strong></li>
        </ol>
        <button onClick={onClose} className="mt-5 min-h-12 w-full rounded-lg bg-ink font-bold text-white dark:bg-coral">Start Tracking</button>
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
    <div className="min-h-screen bg-paper text-ink transition-colors dark:bg-slate-950 dark:text-slate-100">
      <ScrollToTop containerRef={mainRef} />
      <DesktopSidebar />
      <main ref={mainRef} className="mx-auto max-w-md px-4 pb-36 pt-5 sm:max-w-2xl md:max-w-4xl lg:ml-64 lg:max-w-none lg:px-8 lg:pb-10 lg:pt-6 xl:px-10">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/events" element={<CalendarPage />} />
          <Route path="/calendar-feeds" element={<CalendarFeedsPage />} />
          <Route path="/calendar-imports" element={<CalendarImportsPage />} />
          <Route path="/nj-calendar" element={<NjCalendarPage />} />
          <Route path="/past" element={<PastEventsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/flyers" element={<FlyerGalleryPage />} />
          <Route path="/sales" element={<SalesControlPage />} />
          <Route path="/buy" element={<NeedsToBuyPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/events/new" element={<EventFormPage />} />
          <Route path="/events/:id" element={<EventDetailPage />} />
          <Route path="/events/:id/edit" element={<EventFormPage />} />
        </Routes>
      </main>
      <BottomNav />
      {pwaStatus.needRefresh ? (
        <div className="fixed inset-x-4 bottom-24 z-50 rounded-2xl border border-coral/30 bg-ink p-3 text-white shadow-2xl lg:bottom-6 lg:left-auto lg:max-w-sm dark:bg-slate-900">
          <p className="text-sm font-black">Update Available</p>
          <p className="mt-1 text-xs text-slate-300">A newer 4 Nerds build is ready. Reload to avoid stale PWA cache.</p>
          <button onClick={applyPwaUpdate} className="mt-3 min-h-10 w-full rounded-xl bg-coral text-sm font-black text-white">Reload</button>
        </div>
      ) : null}
      {showOnboarding ? <Onboarding onClose={closeOnboarding} /> : null}
    </div>
  );
}
