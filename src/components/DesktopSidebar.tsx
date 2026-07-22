import { CalendarDays, CalendarSync, Camera, History, Home, Package, PlusCircle, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";

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

export function DesktopSidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200/80 bg-white/85 p-4 backdrop-blur-xl lg:flex lg:flex-col dark:border-slate-800/90 dark:bg-night-950/90">
      <div className="relative overflow-hidden rounded-panel border border-white/10 bg-gradient-to-br from-night-850 to-night-950 p-5 text-white shadow-elevated">
        <span className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-coral/15 blur-2xl" />
        <p className="relative text-xs font-black uppercase text-orange-300" style={{ letterSpacing: "0.08em" }}>Private workspace</p>
        <h1 className="relative mt-1 text-2xl font-black">4 Nerds</h1>
        <p className="relative mt-1 text-sm text-slate-400">Event Planner</p>
      </div>
      <nav aria-label="Primary navigation" className="mt-5 space-y-1.5">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `group relative flex min-h-12 items-center gap-3 overflow-hidden rounded-xl px-4 text-sm font-bold transition duration-180 ease-premium ${isActive ? "bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-glow" : "text-slate-600 hover:translate-x-0.5 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-night-850"}`
            }
          >
            <Icon size={19} className="shrink-0 transition-transform duration-180 group-hover:scale-105" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-night-900/70 dark:text-slate-400">
        <p className="font-black text-slate-700 dark:text-slate-200">Team workspace</p>
        <p className="mt-1 leading-5">Events, staffing, and sales in one place.</p>
      </div>
    </aside>
  );
}
