export function EmptyState({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600">
      <p className="text-sm">{title}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
