import { CheckCircle2, Circle, ExternalLink, Package, Plus, Search, Trash2, User, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingScreen } from "../components/LoadingScreen";
import { SkeletonEventCard } from "../components/SkeletonEventCard";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { deleteBuyItem, fetchProductPreview, getCachedBuyItems, listBuyItems, saveBuyItem } from "../services/database/buyItemsRepository";
import { listWorkers } from "../services/database/workerRepository";
import type { BuyItem, BuyItemPriority, Worker } from "../types/models";
import { id, nowIso } from "../utils/normalize";
import { formatMoney } from "../utils/paymentMath";

type SortMode = "newest" | "oldest" | "price_low" | "price_high";
type FilterMode = "all" | "purchased" | "needed" | "high";
type BuyerFilter = "all" | "unassigned" | string;

const emptyDraft = {
  title: "",
  description: "",
  productUrl: "",
  imageUrl: "",
  estimatedPrice: "",
  quantity: "1",
  priority: "medium" as BuyItemPriority,
  purchased: false,
  purchasedBy: "",
  purchasedByWorkerId: "",
  notes: ""
};

export function NeedsToBuyPage() {
  const [items, setItems] = useState<BuyItem[]>(() => getCachedBuyItems());
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [editing, setEditing] = useState<BuyItem | "new" | null>(null);
  const [buyerTarget, setBuyerTarget] = useState<BuyItem | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [buyerFilter, setBuyerFilter] = useState<BuyerFilter>("all");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [loading, setLoading] = useState(items.length === 0);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setSyncing(true);
    setError("");
    try {
      const [loadedItems, loadedWorkers] = await Promise.all([listBuyItems(), listWorkers().catch(() => [] as Worker[])]);
      setItems(loadedItems);
      setWorkers(loadedWorkers.filter((worker) => worker.active));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load buy items.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openForm(item?: BuyItem) {
    setMessage("");
    setError("");
    setEditing(item || "new");
    setDraft(item ? {
      title: item.title,
      description: item.description || "",
      productUrl: item.productUrl || "",
      imageUrl: item.imageUrl || "",
      estimatedPrice: item.estimatedPrice === undefined ? "" : String(item.estimatedPrice),
      quantity: String(item.quantity || 1),
      priority: item.priority || "medium",
      purchased: item.purchased,
      purchasedBy: item.purchasedBy || "",
      purchasedByWorkerId: item.purchasedByWorkerId || "",
      notes: item.notes || ""
    } : emptyDraft);
  }

  async function tryPreview() {
    if (!draft.productUrl.trim()) return;
    setPreviewing(true);
    setError("");
    try {
      const preview = await fetchProductPreview(draft.productUrl);
      setDraft((current) => ({
        ...current,
        title: current.title || preview.title || "",
        description: current.description || preview.description || "",
        imageUrl: current.imageUrl || preview.imageUrl || "",
        estimatedPrice: current.estimatedPrice || (preview.estimatedPrice === undefined ? "" : String(preview.estimatedPrice))
      }));
      setMessage("Preview loaded.");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Could not preview this link. Add details manually.");
    } finally {
      setPreviewing(false);
    }
  }

  async function saveDraft() {
    setError("");
    setMessage("");
    if (!draft.title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    try {
      const timestamp = nowIso();
      const existing = editing && editing !== "new" ? editing : undefined;
      await saveBuyItem({
        id: existing?.id || id("buy"),
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        productUrl: draft.productUrl.trim() || undefined,
        imageUrl: draft.imageUrl.trim() || undefined,
        estimatedPrice: draft.estimatedPrice === "" ? undefined : Number(draft.estimatedPrice),
        quantity: Number(draft.quantity || 1),
        priority: draft.priority,
        purchased: draft.purchased,
        purchasedBy: draft.purchased ? draft.purchasedBy.trim() || undefined : undefined,
        purchasedByWorkerId: draft.purchased ? draft.purchasedByWorkerId || undefined : undefined,
        purchasedAt: draft.purchased ? existing?.purchasedAt || timestamp : undefined,
        notes: draft.notes.trim() || undefined,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      });
      setEditing(null);
      setMessage("Item saved.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save item.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePurchased(item: BuyItem) {
    if (!item.purchased) {
      setBuyerTarget(item);
      return;
    }
    const previous = items;
    const nextItem = {
      ...item,
      purchased: false,
      purchasedBy: undefined,
      purchasedByWorkerId: undefined,
      purchasedAt: undefined,
      updatedAt: nowIso()
    };
    setItems((current) => current.map((existing) => existing.id === item.id ? nextItem : existing));
    setError("");
    try {
      await saveBuyItem(nextItem);
      setMessage("Marked as needed.");
      await load();
    } catch (saveError) {
      setItems(previous);
      setError(saveError instanceof Error ? saveError.message : "Could not update purchase status.");
    }
  }

  async function markPurchased(item: BuyItem, worker?: Worker) {
    const previous = items;
    const nextItem = {
      ...item,
      purchased: true,
      purchasedBy: worker?.name || undefined,
      purchasedByWorkerId: worker?.id || undefined,
      purchasedAt: nowIso(),
      updatedAt: nowIso()
    };
    setBuyerTarget(null);
    setItems((current) => current.map((existing) => existing.id === item.id ? nextItem : existing));
    setError("");
    try {
      await saveBuyItem(nextItem);
      setMessage(worker ? `Purchased by ${worker.name}.` : "Marked purchased.");
      await load();
    } catch (saveError) {
      setItems(previous);
      setError(saveError instanceof Error ? saveError.message : "Could not update purchase status.");
    }
  }

  const filtered = useMemo(() => {
    const text = query.toLowerCase();
    return items
      .filter((item) => {
        if (filter === "purchased" && !item.purchased) return false;
        if (filter === "needed" && item.purchased) return false;
        if (filter === "high" && item.priority !== "high") return false;
        if (buyerFilter === "unassigned" && (!item.purchased || item.purchasedByWorkerId || item.purchasedBy)) return false;
        if (buyerFilter !== "all" && buyerFilter !== "unassigned" && item.purchasedByWorkerId !== buyerFilter) return false;
        return `${item.title} ${item.description || ""} ${item.notes || ""}`.toLowerCase().includes(text);
      })
      .sort((a, b) => {
        if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
        if (sort === "price_low") return Number(a.estimatedPrice || 0) - Number(b.estimatedPrice || 0);
        if (sort === "price_high") return Number(b.estimatedPrice || 0) - Number(a.estimatedPrice || 0);
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [items, query, sort, filter, buyerFilter]);

  return (
    <div className="space-y-5 lg:mx-auto lg:max-w-7xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-coral">Supplies</p>
          <h1 className="text-3xl font-black text-ink dark:text-white">Needs to Buy</h1>
        </div>
        <button onClick={() => openForm()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-coral px-4 text-sm font-black text-white"><Plus size={18} /> Add Item</button>
      </header>
      <SyncStatusBadge syncing={syncing && items.length > 0} />

      {message ? <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</p> : null}
      {error ? <ErrorState message="Needs to Buy could not be refreshed." details={error} onRetry={load} onSync={load} /> : null}

      <section className="grid gap-3 rounded-2xl bg-white/90 p-3 shadow-soft md:grid-cols-[1fr_160px_160px_180px] dark:bg-slate-900">
        <label className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/70">
          <Search size={17} className="text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search items" className="min-w-0 flex-1 bg-transparent outline-none" />
        </label>
        <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="price_low">Price low-high</option>
          <option value="price_high">Price high-low</option>
        </select>
        <select value={filter} onChange={(event) => setFilter(event.target.value as FilterMode)} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
          <option value="all">All</option>
          <option value="purchased">Purchased</option>
          <option value="needed">Not Purchased</option>
          <option value="high">High Priority</option>
        </select>
        <select value={buyerFilter} onChange={(event) => setBuyerFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
          <option value="all">Purchased By: All</option>
          {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
          <option value="unassigned">Not assigned</option>
        </select>
      </section>

      {loading ? <LoadingScreen label="Loading items..."><section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[1, 2, 3].map((item) => <SkeletonEventCard key={item} compact />)}</section></LoadingScreen> : null}
      {!loading && filtered.length === 0 ? <EmptyState title="No buy items yet." /> : null}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {filtered.map((item) => (
          <article key={item.id} onClick={() => openForm(item)} className={`cursor-pointer overflow-hidden rounded-2xl border p-3 shadow-soft transition hover:-translate-y-0.5 ${item.purchased ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/25" : "border-white/70 bg-white/90 dark:border-slate-800 dark:bg-slate-900"}`}>
            <div className="relative">
              {item.imageUrl ? <img src={item.imageUrl} loading="lazy" decoding="async" alt="" className="aspect-[4/3] w-full rounded-xl bg-slate-100 object-contain dark:bg-slate-950" /> : <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-950"><Package size={30} /></div>}
              <button onClick={(event) => { event.stopPropagation(); void togglePurchased(item); }} className={`absolute right-2 top-2 inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-xs font-black shadow-soft ${item.purchased ? "bg-emerald-600 text-white" : "bg-white text-slate-700 dark:bg-slate-800 dark:text-white"}`} aria-label={item.purchased ? "Mark as needed" : "Mark as purchased"}>
                {item.purchased ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                {item.purchased ? "Purchased" : "Needed"}
              </button>
            </div>
            <div className="mt-3 space-y-1 text-sm">
              <h2 className="font-black text-ink dark:text-white">{item.title}</h2>
              {item.description ? <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{item.description}</p> : null}
              {item.purchased ? <p className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-black text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"><User size={13} /> Purchased by {item.purchasedBy || "Not assigned"}</p> : null}
              <p className="font-bold text-slate-700 dark:text-slate-300">{formatMoney(Number(item.estimatedPrice || 0))} x {item.quantity}</p>
              <p className={`text-xs font-black ${item.priority === "high" ? "text-rose-600" : item.priority === "medium" ? "text-amber-600" : "text-slate-500"}`}>{item.priority.toUpperCase()} PRIORITY</p>
              {item.productUrl ? <a href={item.productUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-slate-100 px-3 text-xs font-bold text-ink dark:bg-slate-800 dark:text-white"><ExternalLink size={14} /> Open Product</a> : null}
            </div>
          </article>
        ))}
      </section>

      {editing ? (
        <div className="fixed inset-0 z-40 flex items-end bg-slate-950/50 p-4 backdrop-blur-sm lg:items-center lg:justify-center">
          <section className="mx-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-coral">Needs to Buy</p>
                <h2 className="text-2xl font-black text-ink dark:text-white">{editing === "new" ? "Add Item" : "Edit Item"}</h2>
              </div>
              <button onClick={() => setEditing(null)} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <input value={draft.productUrl} onChange={(event) => setDraft({ ...draft, productUrl: event.target.value })} placeholder="Amazon/product link" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
                <button onClick={tryPreview} disabled={previewing || !draft.productUrl.trim()} className="rounded-xl bg-ink px-3 text-sm font-bold text-white disabled:opacity-60 dark:bg-coral">{previewing ? "Loading" : "Preview"}</button>
              </div>
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Title" className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Description" className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <input value={draft.imageUrl} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })} placeholder="Image URL" className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <div className="grid grid-cols-2 gap-2">
                <input type="number" value={draft.estimatedPrice} onChange={(event) => setDraft({ ...draft, estimatedPrice: event.target.value })} placeholder="Price" className="rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
                <input type="number" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} placeholder="Quantity" className="rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              </div>
              <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as BuyItemPriority })} className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
                <option value="low">Low priority</option>
                <option value="medium">Medium priority</option>
                <option value="high">High priority</option>
              </select>
              <input value={draft.purchasedBy} onChange={(event) => setDraft({ ...draft, purchasedBy: event.target.value })} placeholder="Purchased by" className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <select value={draft.purchasedByWorkerId} onChange={(event) => {
                const worker = workers.find((item) => item.id === event.target.value);
                setDraft({ ...draft, purchasedByWorkerId: event.target.value, purchasedBy: worker?.name || "" });
              }} className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
                <option value="">Purchased by worker: Not assigned</option>
                {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
              </select>
              <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Notes" className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <label className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold dark:bg-slate-950/70">
                <input type="checkbox" checked={draft.purchased} onChange={(event) => setDraft({ ...draft, purchased: event.target.checked, purchasedBy: event.target.checked ? draft.purchasedBy : "", purchasedByWorkerId: event.target.checked ? draft.purchasedByWorkerId : "" })} />
                Purchased
              </label>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <button onClick={() => setEditing(null)} className="min-h-11 rounded-xl bg-slate-100 font-bold dark:bg-slate-800">Cancel</button>
              {editing !== "new" ? <button onClick={async () => { await deleteBuyItem(editing.id); setEditing(null); await load(); }} className="min-h-11 rounded-xl bg-rose-50 font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200"><Trash2 className="mx-auto" size={17} /></button> : null}
              <button onClick={saveDraft} disabled={saving} className="col-span-1 min-h-11 rounded-xl bg-coral font-black text-white disabled:opacity-60">{saving ? "Saving..." : "Save"}</button>
            </div>
          </section>
        </div>
      ) : null}
      {buyerTarget ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-4 backdrop-blur-sm lg:items-center lg:justify-center">
          <section className="mx-auto w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-coral">Purchase</p>
                <h2 className="text-2xl font-black text-ink dark:text-white">Who bought this?</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{buyerTarget.title}</p>
              </div>
              <button onClick={() => setBuyerTarget(null)} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
            </div>
            <div className="mt-5 grid gap-2">
              {workers.map((worker) => (
                <button key={worker.id} onClick={() => void markPurchased(buyerTarget, worker)} className="min-h-12 rounded-xl bg-slate-100 px-4 text-left font-black text-ink transition active:scale-[0.98] dark:bg-slate-800 dark:text-white">
                  {worker.name}
                </button>
              ))}
              <button onClick={() => void markPurchased(buyerTarget)} className="min-h-12 rounded-xl border border-slate-200 px-4 text-left font-black text-slate-600 transition active:scale-[0.98] dark:border-slate-800 dark:text-slate-300">
                Not assigned
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
