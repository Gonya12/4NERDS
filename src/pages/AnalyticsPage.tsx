import { useEffect, useMemo, useState } from "react";
import { listPlannerEvents, listWorkers } from "../services/planner/plannerRepository";
import type { Event, Worker } from "../types/models";
import { calculateEventProfit } from "../utils/financeMath";
import { formatMoney } from "../utils/paymentMath";

export function AnalyticsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);

  useEffect(() => {
    async function load() {
      setEvents(await listPlannerEvents());
      setWorkers(await listWorkers());
    }
    void load();
  }, []);

  const stats = useMemo(() => {
    const now = new Date();
    const monthEvents = events.filter((event) => {
      const date = new Date(event.startDate);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });
    const totalSales = monthEvents.reduce((sum, event) => sum + calculateEventProfit(event, event.finance).totalSales, 0);
    const totalExpenses = monthEvents.reduce((sum, event) => sum + calculateEventProfit(event, event.finance).totalExpenses, 0);
    const monthlyProfit = monthEvents.reduce((sum, event) => sum + calculateEventProfit(event, event.finance).netProfit, 0);
    const locations = new Map<string, number>();
    const months = new Map<string, number>();
    const workerCounts = new Map<string, number>();
    events.forEach((event) => {
      const profit = calculateEventProfit(event, event.finance).netProfit;
      const location = event.venueName || event.city || "Unknown";
      locations.set(location, (locations.get(location) || 0) + profit);
      const month = new Date(event.startDate).toLocaleString([], { month: "short", year: "numeric" });
      months.set(month, (months.get(month) || 0) + profit);
      (event.confirmedWorkerIds || []).forEach((workerId) => workerCounts.set(workerId, (workerCounts.get(workerId) || 0) + 1));
    });
    return {
      totalSales,
      totalExpenses,
      monthlyProfit,
      bestLocations: [...locations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      bestMonths: [...months.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      workerCounts: [...workerCounts.entries()].map(([id, count]) => [workers.find((worker) => worker.id === id)?.name || "Unknown", count] as const).sort((a, b) => b[1] - a[1])
    };
  }, [events, workers]);

  return (
    <div className="space-y-5 lg:mx-auto lg:max-w-7xl">
      <header>
        <p className="text-sm font-bold text-coral">Business</p>
        <h1 className="text-3xl font-black text-ink dark:text-white">Analytics</h1>
      </header>
      <section className="grid grid-cols-3 gap-2 lg:gap-4">
        <div className="rounded-2xl bg-white/90 p-3 shadow-soft dark:bg-slate-900"><p className="text-xs text-slate-500">Sales</p><p className="font-black">{formatMoney(stats.totalSales)}</p></div>
        <div className="rounded-2xl bg-white/90 p-3 shadow-soft dark:bg-slate-900"><p className="text-xs text-slate-500">Expenses</p><p className="font-black">{formatMoney(stats.totalExpenses)}</p></div>
        <div className="rounded-2xl bg-white/90 p-3 shadow-soft dark:bg-slate-900"><p className="text-xs text-slate-500">Profit</p><p className={`font-black ${stats.monthlyProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatMoney(stats.monthlyProfit)}</p></div>
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
      {[["Best Locations", stats.bestLocations], ["Best Months", stats.bestMonths], ["Worker Attendance", stats.workerCounts]].map(([title, rows]) => (
        <section key={title as string} className="rounded-2xl bg-white/90 p-4 shadow-soft dark:bg-slate-900">
          <h2 className="font-black text-ink dark:text-white">{title as string}</h2>
          <div className="mt-3 space-y-2">
            {(rows as readonly (readonly [string, number])[]).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-950/70">
                <span>{label}</span>
                <strong>{title === "Worker Attendance" ? value : formatMoney(value)}</strong>
              </div>
            ))}
          </div>
        </section>
      ))}
      </div>
    </div>
  );
}
