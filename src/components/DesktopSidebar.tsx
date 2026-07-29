import { CalendarDays, CalendarSync, Camera, ChevronLeft, ChevronRight, History, Home, Package, PlusCircle, Settings } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

const items = [
  { to: "/", label: "Home", icon: Home },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/nj-calendar", label: "NJ Calendar", icon: CalendarSync },
  { to: "/events/new", label: "Add Event", icon: PlusCircle },
  { to: "/sales", label: "Sales Control", icon: Camera },
  { to: "/buy", label: "Needs to Buy", icon: Package },
  { to: "/past", label: "Past Events", icon: History },
  { to: "/settings", label: "Settings", icon: Settings }
];

export function DesktopSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { pathname } = useLocation();
  const exactIndex = items.findIndex((item) => item.to === pathname);
  const activeIndex = exactIndex >= 0 ? exactIndex : items.findIndex((item) => item.to !== "/" && pathname.startsWith(`${item.to}/`));

  return (
    <aside className={`fixed inset-y-0 left-0 z-30 hidden border-r border-slate-200/80 bg-white/90 p-3 backdrop-blur-xl transition-[width] duration-240 ease-premium lg:flex lg:flex-col dark:border-slate-800/90 dark:bg-night-950/95 ${collapsed ? "w-20" : "w-64"}`}>
      <div className={`relative overflow-hidden rounded-panel border border-white/10 bg-gradient-to-br from-night-850 to-night-950 text-white shadow-elevated transition-[padding] duration-240 ${collapsed ? "p-3" : "p-5"}`}>
        <span className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-coral/15 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-coral text-lg font-black shadow-glow">4N</span>
          <div className={`min-w-0 overflow-hidden whitespace-nowrap transition-all duration-180 ${collapsed ? "max-w-0 -translate-x-1 opacity-0" : "max-w-40 opacity-100"}`}>
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-orange-300">Private workspace</p>
            <h1 className="text-xl font-black">4 Nerds</h1>
          </div>
        </div>
      </div>
      <nav aria-label="Primary navigation" className="relative mt-5 space-y-1.5">
        {activeIndex >= 0 ? <span aria-hidden="true" className="pointer-events-none absolute -left-3 top-0 h-12 w-1 rounded-r-full bg-coral shadow-glow transition-transform duration-240 ease-premium" style={{ transform: `translateY(${activeIndex * 54}px)` }} /> : null}
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
            className={({ isActive }) =>
              `group relative flex min-h-12 items-center overflow-hidden rounded-xl text-sm font-bold transition duration-180 ease-premium ${collapsed ? "justify-center px-2" : "gap-3 px-4"} ${isActive ? "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300" : "text-slate-600 hover:translate-x-0.5 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-night-850"}`
            }
          >
            <Icon size={19} className="shrink-0 transition-transform duration-180 group-hover:scale-105" />
            <span className={`overflow-hidden whitespace-nowrap transition-all duration-180 ${collapsed ? "max-w-0 -translate-x-1 opacity-0" : "max-w-40 opacity-100"}`}>{label}</span>
          </NavLink>
        ))}
      </nav>
      <button type="button" onClick={onToggle} className="mt-auto flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-600 hover:border-orange-300 hover:text-orange-600 dark:border-slate-800 dark:bg-night-900 dark:text-slate-300" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <ChevronRight size={17} /> : <><ChevronLeft size={17} /><span>Collapse sidebar</span></>}
      </button>
      <div className={`mt-3 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/80 text-xs text-slate-500 transition-all duration-180 dark:border-slate-800 dark:bg-night-900/70 dark:text-slate-400 ${collapsed ? "max-h-0 border-transparent p-0 opacity-0" : "max-h-28 p-3 opacity-100"}`}>
        <p className="font-black text-slate-700 dark:text-slate-200">Team workspace</p>
        <p className="mt-1 leading-5">Events, staffing, and sales in one place.</p>
      </div>
    </aside>
  );
}
