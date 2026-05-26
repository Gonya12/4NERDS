import type { AttendanceStatus, Confidence, RegistrationStatus } from "../types/models";

const styles: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-200 text-slate-700",
  unknown: "bg-amber-100 text-amber-800",
  sold_out: "bg-rose-100 text-rose-800",
  waitlist: "bg-sky-100 text-sky-800",
  interested: "bg-emerald-100 text-emerald-800",
  maybe: "bg-amber-100 text-amber-800",
  not_going: "bg-slate-200 text-slate-700",
  none: "bg-slate-100 text-slate-500",
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-rose-100 text-rose-800",
  review: "bg-violet-100 text-violet-800"
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
