import { Bell } from "lucide-react";

export function ReminderBadge({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
      <Bell size={13} />
      Reminders
    </span>
  );
}
