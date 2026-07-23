import type { OwnershipShare, Worker } from "../../types/models";
import { formatMoney } from "../../utils/paymentMath";
import { ownershipTotal } from "../../utils/salesControl";

type Props = { workers: Worker[]; shares: OwnershipShare[]; totalCost: number; paidByWorkerId?: string; label?: string; onChange: (shares: OwnershipShare[]) => void };

export function OwnershipEditor({ workers, shares, totalCost, paidByWorkerId, label = "Ownership", onChange }: Props) {
  const gonzalo = workers.find((worker) => worker.name.toLowerCase() === "gonzalo");
  const thiago = workers.find((worker) => worker.name.toLowerCase() === "thiago");
  const total = ownershipTotal(shares);
  const setSingle = (worker?: Worker) => onChange(worker ? [{ workerId: worker.id, ownershipPercentage: 100 }] : []);
  const shared = () => gonzalo && thiago && onChange([{ workerId: gonzalo.id, ownershipPercentage: 50 }, { workerId: thiago.id, ownershipPercentage: 50 }]);

  return <section className="space-y-3 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-3 dark:border-cyan-900 dark:bg-cyan-950/20">
    <div><p className="font-black text-cyan-900 dark:text-cyan-100">{label}</p><p className="text-xs text-cyan-700 dark:text-cyan-300">Ownership is separate from who paid or entered the purchase.</p></div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><button type="button" disabled={!gonzalo} onClick={() => setSingle(gonzalo)} className="rounded-xl bg-white px-2 py-2 text-xs font-black disabled:opacity-40 dark:bg-slate-900">Gonzalo only</button><button type="button" disabled={!thiago} onClick={() => setSingle(thiago)} className="rounded-xl bg-white px-2 py-2 text-xs font-black disabled:opacity-40 dark:bg-slate-900">Thiago only</button><button type="button" disabled={!gonzalo || !thiago} onClick={shared} className="rounded-xl bg-white px-2 py-2 text-xs font-black disabled:opacity-40 dark:bg-slate-900">50/50</button><button type="button" onClick={() => onChange(workers.slice(0, 2).map((worker) => ({ workerId: worker.id, ownershipPercentage: 0 })))} className="rounded-xl bg-white px-2 py-2 text-xs font-black dark:bg-slate-900">Custom</button></div>
    {shares.length ? <div className="space-y-2">{shares.map((share) => <div key={share.workerId} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-center gap-2"><span className="truncate text-sm font-bold">{workers.find((worker) => worker.id === share.workerId)?.name || "Owner"}</span><input type="number" min="0" max="100" step="0.1" value={share.ownershipPercentage} onChange={(event) => onChange(shares.map((item) => item.workerId === share.workerId ? { ...item, ownershipPercentage: Number(event.target.value) } : item))} className="rounded-lg border border-slate-200 bg-white p-2 text-right dark:border-slate-700 dark:bg-slate-900" /><span className="text-xs font-bold">{formatMoney(totalCost * share.ownershipPercentage / 100)}</span></div>)}</div> : <p className="text-sm font-bold text-slate-500">Ownership not assigned</p>}
    {shares.length ? <div><div className="flex h-3 overflow-hidden rounded-full bg-slate-200">{shares.map((share, index) => <span key={share.workerId} style={{ width: `${Math.max(0, share.ownershipPercentage)}%` }} className={index % 2 ? "bg-violet-500" : "bg-cyan-500"} />)}</div><p className={`mt-1 text-xs font-black ${total === 100 ? "text-emerald-600" : "text-rose-600"}`}>{total}% total {total !== 100 ? "· Must equal 100%" : ""}</p></div> : null}
    {paidByWorkerId && shares.length ? <p className="text-xs text-slate-600 dark:text-slate-300">Paid by {workers.find((worker) => worker.id === paidByWorkerId)?.name || "worker"}. Contributions are not automatically marked settled.</p> : null}
  </section>;
}
