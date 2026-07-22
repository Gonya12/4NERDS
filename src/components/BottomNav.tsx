import { CalendarDays, History, Home, PlusCircle, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";

const items = [
  { to: "/", label: "Home", icon: Home },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/events/new", label: "Add Event", icon: PlusCircle },
  { to: "/past", label: "Past", icon: History },
  { to: "/settings", label: "Settings", icon: Settings }
];

export function BottomNav() {
  return (
    <nav aria-label="Primary navigation" className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-slate-200/80 bg-white/90 px-2 pt-1.5 shadow-[0_-12px_36px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl lg:hidden dark:border-slate-800/90 dark:bg-night-950/92">
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `group relative flex min-h-[54px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-bold transition duration-180 ease-premium active:scale-95 ${isActive ? "text-orange-600 dark:text-orange-300" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-night-850"}`}
          >
            {({ isActive }) => (
              <>
                <span className={`absolute inset-x-3 top-0 h-0.5 origin-center rounded-full bg-coral transition-transform duration-240 ${isActive ? "scale-x-100" : "scale-x-0"}`} />
                <Icon size={21} strokeWidth={isActive ? 2.6 : 2.1} className={`transition-transform duration-180 ${isActive ? "-translate-y-0.5" : "group-hover:-translate-y-0.5"}`} />
                <span className="max-w-full truncate">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
