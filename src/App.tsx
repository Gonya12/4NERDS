import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { BottomNav } from "./components/BottomNav";
import { DesktopSidebar } from "./components/DesktopSidebar";
import { CalendarPage } from "./pages/CalendarPage";
import { EventDetailPage } from "./pages/EventDetailPage";
import { EventFormPage } from "./pages/EventFormPage";
import { FlyerGalleryPage } from "./pages/FlyerGalleryPage";
import { HomePage } from "./pages/HomePage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { PastEventsPage } from "./pages/PastEventsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { db, getSettings, removeDemoData, seedWorkers } from "./services/storage/localDb";

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

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    async function boot() {
      await removeDemoData();
      await seedWorkers();
      const settings = await getSettings();
      setShowOnboarding(!settings.onboardingComplete);
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
      <DesktopSidebar />
      <main className="mx-auto max-w-md px-4 pb-28 pt-6 sm:max-w-2xl md:max-w-4xl lg:ml-64 lg:max-w-none lg:px-8 lg:pb-10 xl:px-10">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/events" element={<CalendarPage />} />
          <Route path="/past" element={<PastEventsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/flyers" element={<FlyerGalleryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/events/new" element={<EventFormPage />} />
          <Route path="/events/:id" element={<EventDetailPage />} />
          <Route path="/events/:id/edit" element={<EventFormPage />} />
        </Routes>
      </main>
      <BottomNav />
      {showOnboarding ? <Onboarding onClose={closeOnboarding} /> : null}
    </div>
  );
}
