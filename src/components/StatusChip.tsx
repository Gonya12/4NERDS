import type { AttendanceStatus, Confidence, RegistrationStatus } from "../types/models";

const styles: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  closed: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  unknown: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  sold_out: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  waitlist: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  interested: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  maybe: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  not_going: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  none: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300",
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  low: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  review: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
};

const labels: Record<string, string> = {
  sold_out: "Sold Out",
  not_going: "Not Going",
  review: "Needs Review"
};

export function StatusChip({ value }: { value: RegistrationStatus | AttendanceStatus | Confidence | "review" }) {
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full px-3 text-xs font-semibold ${styles[value] || styles.unknown}`}>
      {labels[value] || value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}
