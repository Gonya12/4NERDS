import { Inbox } from "lucide-react";

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="surface-card relative overflow-hidden border-dashed p-6 text-center sm:p-8">
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 shadow-sm dark:bg-orange-950/40 dark:text-orange-300">
        {icon || <Inbox size={22} />}
      </span>
      <p className="mt-4 text-base font-black text-ink dark:text-white">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
