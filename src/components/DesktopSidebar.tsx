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
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white/90 p-5 backdrop-blur lg:block dark:border-slate-800 dark:bg-slate-950/90">
      <div className="rounded-3xl bg-ink p-4 text-white shadow-soft dark:bg-slate-900">
        <p className="text-sm font-bold text-orange-300">4 Nerds</p>
        <h1 className="mt-1 text-xl font-black">Planner</h1>
      </div>
      <nav className="mt-6 space-y-2">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-3 rounded-2xl px-4 text-sm font-bold transition ${isActive ? "bg-ink text-white shadow-soft dark:bg-coral" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"}`
            }
          >
            <Icon size={19} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
