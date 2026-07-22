import type { EventStage } from "../types/models";

export const eventStageLabels: Record<EventStage, string> = {
  new: "Not Applied",
  applied: "Applied / Reserved",
  paid: "Paid",
  past: "Past"
};

export const eventStageDescriptions: Record<EventStage, string> = {
  new: "Not applied/reserved yet",
  applied: "Applied/reserved, not paid",
  paid: "Applied/reserved and paid",
  past: "Past event"
};

export const eventStageCardClasses: Record<EventStage, string> = {
  new: "border-red-200/90 bg-gradient-to-br from-white to-red-50/80 dark:border-red-900/60 dark:from-night-850 dark:to-red-950/20",
  applied: "border-amber-200/90 bg-gradient-to-br from-white to-amber-50/90 dark:border-amber-900/60 dark:from-night-850 dark:to-amber-950/20",
  paid: "border-emerald-200/90 bg-gradient-to-br from-white to-emerald-50/80 dark:border-emerald-900/60 dark:from-night-850 dark:to-emerald-950/20",
  past: "border-sky-200/90 bg-gradient-to-br from-white to-sky-50/80 dark:border-sky-900/60 dark:from-night-850 dark:to-sky-950/20"
};

export const eventStageAccentClasses: Record<EventStage, string> = {
  new: "bg-red-500",
  applied: "bg-yellow-400",
  paid: "bg-emerald-500",
  past: "bg-sky-500"
};

export function eventStage(eventStage?: EventStage) {
  return eventStage || "new";
}
