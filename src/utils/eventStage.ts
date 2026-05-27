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
  new: "border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20",
  applied: "border-yellow-200 bg-yellow-50/80 dark:border-yellow-900/60 dark:bg-yellow-950/20",
  paid: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20",
  past: "border-sky-200 bg-sky-50/70 dark:border-sky-900/60 dark:bg-sky-950/20"
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
