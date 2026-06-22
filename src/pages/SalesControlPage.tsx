import { Camera, ImagePlus, RotateCcw, Save, Search, SwitchCamera, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingScreen } from "../components/LoadingScreen";
import { SkeletonEventCard } from "../components/SkeletonEventCard";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { createSaleRecord, deleteSaleRecord, getCachedSalesRecords, listSalesRecordsPage, saveSaleRecord, syncPendingSales } from "../services/database/salesRepository";
import { imageFromClipboard } from "../services/images/saleImageService";
import { listPlannerEventOptions } from "../services/planner/plannerRepository";
import type { Event, SalesRecord } from "../types/models";
import { eventDays, shortScheduleSummary } from "../utils/eventSchedule";
import { formatMoney, roundMoney } from "../utils/paymentMath";
import { useLocation } from "react-router-dom";
import { actionCooldownRemainingSeconds, canRunAction, markActionRun, recordPageLoad } from "../utils/supabase";
import { safeDateFromLocalInput } from "../utils/browserCompat";
import { addDebugLog } from "../services/debug/debugLog";

type SortMode = "recent" | "oldest" | "highest_sold" | "highest_profit" | "lowest_profit" | "missing";
type DateFilter = "all" | "today" | "week" | "month" | "custom";

function profit(sale: SalesRecord) {
  return roundMoney(Number(sale.soldPrice || 0) - Number(sale.boughtPrice || 0));
}

function todayEventMatches(events: Event[]) {
  const today = new Date().toISOString().slice(0, 10);
  return events.filter((event) => eventDays(event).some((day) => day.date.slice(0, 10) === today));
}

function todayDayId(event?: Event) {
  if (!event) return "";
  const today = new Date().toISOString().slice(0, 10);
  return eventDays(event).find((day) => day.date.slice(0, 10) === today)?.id || "";
}

export function SalesControlPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const requestedEventId = params.get("eventId") || "";
  const [sales, setSales] = useState<SalesRecord[]>(() => getCachedSalesRecords());
  const [events, setEvents] = useState<Event[]>([]);
  const [mode, setMode] = useState<"control" | "sale">("control");
  const [editing, setEditing] = useState<SalesRecord | null>(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [eventFilter, setEventFilter] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [eventDayFilter, setEventDayFilter] = useState("");
  const [customDate, setCustomDate] = useState(new Date().toISOString().slice(0, 10));
  const [imageFile, setImageFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(sales.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [salesPage, setSalesPage] = useState(0);
  const [hasMoreSales, setHasMoreSales] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const todayMatches = useMemo(() => todayEventMatches(events), [events]);
  const [form, setForm] = useState({
    eventId: "",
    eventDayId: "",
    itemName: "",
    soldPrice: "",
    boughtPrice: "",
    boughtFrom: "",
    notes: "",
    soldAt: new Date().toISOString().slice(0, 16)
  });

  async function load(page = 0, append = false) {
    recordPageLoad("Sales Control");
    if (append) setLoadingMore(true);
    setSyncing(true);
    setLoadError("");
    try {
      const [saleResult, eventRows] = await Promise.all([listSalesRecordsPage(page, 50), listPlannerEventOptions(500)]);
      setSales((current) => append ? [...current, ...saleResult.records] : saleResult.records);
      setSalesPage(page);
      setHasMoreSales(saleResult.hasMore);
      setEvents(eventRows);
      const requestedEvent = requestedEventId ? eventRows.find((event) => event.id === requestedEventId) : undefined;
      if (requestedEvent && !editing) {
        setForm((current) => ({ ...current, eventId: requestedEvent.id, eventDayId: todayDayId(requestedEvent) }));
        return;
      }
      const matches = todayEventMatches(eventRows);
      if (!form.eventId && matches.length === 1) {
        setForm((current) => ({ ...current, eventId: matches[0].id, eventDayId: todayDayId(matches[0]) }));
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load sales.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (new URLSearchParams(location.search).get("mode") === "sale") setMode("sale");
    void load(0, false);
  }, [location.search]);

  useEffect(() => {
    if (mode === "sale" && !previewUrl) {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [mode, previewUrl, facingMode]);

  function resetForm() {
    setEditing(null);
    setImageFile(undefined);
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setCameraError("");
    setCameraReady(false);
    const requestedEvent = requestedEventId ? events.find((event) => event.id === requestedEventId) : undefined;
    const match = requestedEvent || (todayMatches.length === 1 ? todayMatches[0] : undefined);
    setForm({
      eventId: match?.id || "",
      eventDayId: match ? todayDayId(match) : "",
      itemName: "",
      soldPrice: "",
      boughtPrice: "",
      boughtFrom: "",
      notes: "",
      soldAt: new Date().toISOString().slice(0, 16)
    });
  }

  function pickFile(file?: File) {
    if (!file) return;
    stopCamera();
    setCameraError("");
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function startCamera() {
    stopCamera();
    setCameraReady(false);
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera is unavailable. You can still upload or paste an image.");
      addDebugLog("error", "Camera API unavailable", { userAgent: navigator.userAgent });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (error) {
      addDebugLog("error", "Camera permission or preview failed", error);
      setCameraError("Camera permission denied. You can still upload or paste an image.");
      setCameraReady(false);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) {
      setMessage("Could not capture photo.");
      return;
    }
    pickFile(new File([blob], `sale-${Date.now()}.jpg`, { type: "image/jpeg" }));
  }

  function retakePhoto() {
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setImageFile(undefined);
    setPreviewUrl("");
    setCameraError("");
  }

  function editSale(sale: SalesRecord) {
    stopCamera();
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setEditing(sale);
    setPreviewUrl(sale.imageUrl || "");
    setImageFile(undefined);
    setForm({
      eventId: sale.eventId || "",
      eventDayId: sale.eventDayId || "",
      itemName: sale.itemName || "",
      soldPrice: sale.soldPrice === undefined ? "" : String(sale.soldPrice),
      boughtPrice: sale.boughtPrice === undefined ? "" : String(sale.boughtPrice),
      boughtFrom: sale.boughtFrom || "",
      notes: sale.notes || "",
      soldAt: sale.soldAt.slice(0, 16)
    });
    setMode("sale");
  }

  async function saveSale() {
    setBusy(true);
    setMessage("");
    try {
      const input: Partial<SalesRecord> = {
        id: editing?.id,
        eventId: form.eventId || undefined,
        eventDayId: form.eventDayId || undefined,
        imageUrl: editing?.imageUrl,
        imagePath: editing?.imagePath,
        itemName: form.itemName.trim() || undefined,
        soldPrice: form.soldPrice === "" ? undefined : Number(form.soldPrice),
        boughtPrice: form.boughtPrice === "" ? undefined : Number(form.boughtPrice),
        boughtFrom: form.boughtFrom.trim() || undefined,
        notes: form.notes.trim() || undefined,
        soldAt: form.soldAt ? safeDateFromLocalInput(form.soldAt).toISOString() : new Date().toISOString(),
        createdAt: editing?.createdAt
      };
      if (editing && !imageFile) {
        await saveSaleRecord({ ...editing, ...input, pendingUpload: editing.pendingUpload, updatedAt: new Date().toISOString() } as SalesRecord);
        setMessage("Sale saved.");
      } else {
        const result = await createSaleRecord(input, imageFile);
        setMessage(result.message);
      }
      resetForm();
      setMode("control");
      await load(0, false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save sale.");
    } finally {
      setBusy(false);
    }
  }

  async function syncPending() {
    const key = "sales-sync-pending";
    if (!canRunAction(key, 45_000)) {
      setMessage(`Please wait ${actionCooldownRemainingSeconds(key, 45_000)}s before syncing again.`);
      return;
    }
    markActionRun(key);
    setMessage("Syncing pending sales...");
    const result = await syncPendingSales();
    setMessage(`Synced ${result.synced}. Pending ${result.failed}.`);
    await load(0, false);
  }

  const eventMap = new Map(events.map((event) => [event.id, event]));
  const selectedFilterEvent = eventFilter ? events.find((event) => event.id === eventFilter) : undefined;
  const filtered = useMemo(() => {
    const text = query.toLowerCase();
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const rows = sales.filter((sale) => {
      const event = sale.eventId ? eventMap.get(sale.eventId) : undefined;
      const haystack = `${sale.itemName || ""} ${event?.name || ""} ${sale.boughtFrom || ""} ${sale.notes || ""}`.toLowerCase();
      if (sort === "missing" && sale.itemName && sale.soldPrice !== undefined && sale.boughtPrice !== undefined) return false;
      if (eventFilter && sale.eventId !== eventFilter) return false;
      if (eventDayFilter && sale.eventDayId !== eventDayFilter) return false;
      const soldDate = new Date(sale.soldAt);
      if (dateFilter === "today" && soldDate.toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) return false;
      if (dateFilter === "week" && soldDate < startOfWeek) return false;
      if (dateFilter === "month" && soldDate < startOfMonth) return false;
      if (dateFilter === "custom" && soldDate.toISOString().slice(0, 10) !== customDate) return false;
      return haystack.includes(text);
    });
    return rows.sort((a, b) => {
      if (sort === "oldest") return a.soldAt.localeCompare(b.soldAt);
      if (sort === "highest_sold") return Number(b.soldPrice || 0) - Number(a.soldPrice || 0);
      if (sort === "highest_profit") return profit(b) - profit(a);
      if (sort === "lowest_profit") return profit(a) - profit(b);
      return b.soldAt.localeCompare(a.soldAt);
    });
  }, [sales, query, sort, events, eventFilter, dateFilter, eventDayFilter, customDate]);

  const totals = sales.reduce((acc, sale) => ({
    sold: acc.sold + Number(sale.soldPrice || 0),
    bought: acc.bought + Number(sale.boughtPrice || 0),
    profit: acc.profit + profit(sale)
  }), { sold: 0, bought: 0, profit: 0 });

  const selectedEvent = events.find((event) => event.id === form.eventId);

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 overflow-x-hidden lg:mx-auto lg:max-w-7xl">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-coral">Sales</p>
          <h1 className="text-3xl font-black text-ink dark:text-white">Sales Control</h1>
        </div>
        <button onClick={() => { resetForm(); setMode("sale"); }} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-coral px-4 text-sm font-black text-white"><Camera size={18} /> Add Sale</button>
      </header>
      <SyncStatusBadge syncing={syncing && sales.length > 0} />
      {loadError ? <ErrorState message="Sales could not be refreshed." details={loadError} onRetry={() => void load(0, false)} onSync={() => void load(0, false)} /> : null}

      <section className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3">
        <div className="min-w-0 rounded-2xl bg-white/90 p-3 shadow-soft sm:p-4 dark:bg-slate-900"><p className="text-xs text-slate-500">Total sales</p><p className="truncate text-sm font-black sm:text-base">{formatMoney(totals.sold)}</p></div>
        <div className="min-w-0 rounded-2xl bg-white/90 p-3 shadow-soft sm:p-4 dark:bg-slate-900"><p className="text-xs text-slate-500">Total cost</p><p className="truncate text-sm font-black sm:text-base">{formatMoney(totals.bought)}</p></div>
        <div className="min-w-0 rounded-2xl bg-white/90 p-3 shadow-soft sm:p-4 dark:bg-slate-900"><p className="text-xs text-slate-500">Profit</p><p className={`truncate text-sm font-black sm:text-base ${totals.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatMoney(totals.profit)}</p></div>
      </section>

      {message ? <p className="rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{message}</p> : null}

      {mode === "sale" ? (
        <section className="grid w-full min-w-0 max-w-full gap-4 overflow-hidden rounded-3xl bg-white/90 p-4 shadow-soft lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)] dark:bg-slate-900">
          <div
            tabIndex={0}
            onPaste={(event) => {
              const file = imageFromClipboard(event);
              if (file) {
                event.preventDefault();
                pickFile(file);
              }
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              pickFile(event.dataTransfer.files[0]);
            }}
            className="relative flex min-h-80 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-center dark:border-slate-700 dark:bg-slate-950"
          >
            {previewUrl ? (
              <img src={previewUrl} alt="" className="h-full max-h-[70vh] w-full object-contain" />
            ) : (
              <>
                <video ref={videoRef} playsInline muted className={`h-full min-h-80 max-h-[70vh] w-full object-contain ${cameraReady ? "block" : "hidden"}`} />
                {!cameraReady ? (
                  <div className="space-y-2 p-6">
                    <Camera className="mx-auto text-coral" size={44} />
                    <p className="font-black text-ink dark:text-white">{cameraError || "Starting camera..."}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">You can save with only the image and add details later.</p>
                  </div>
                ) : null}
              </>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {previewUrl ? (
                <button onClick={retakePhoto} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white"><RotateCcw size={17} /> Retake</button>
              ) : (
                <button onClick={capturePhoto} disabled={!cameraReady} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-coral text-sm font-black text-white disabled:opacity-60"><Camera size={17} /> Capture</button>
              )}
              <button onClick={() => setFacingMode((current) => current === "environment" ? "user" : "environment")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white"><SwitchCamera size={17} /> Switch</button>
              <button onClick={() => inputRef.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-bold text-white dark:bg-coral"><ImagePlus size={17} /> Upload</button>
            </div>
            {selectedEvent ? (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                Linked to: {selectedEvent.name}
              </p>
            ) : null}
            <select value={form.eventId} onChange={(e) => setForm({ ...form, eventId: e.target.value, eventDayId: "" })} className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
              <option value="">No event selected</option>
              {events.map((event) => <option key={event.id} value={event.id}>{event.name} - {shortScheduleSummary(event)}</option>)}
            </select>
            {selectedEvent ? (
              <select value={form.eventDayId} onChange={(e) => setForm({ ...form, eventDayId: e.target.value })} className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
                <option value="">No day selected</option>
                {eventDays(selectedEvent).map((day) => <option key={day.id} value={day.id}>{day.date.slice(0, 10)}</option>)}
              </select>
            ) : null}
            <input value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} placeholder="Item name" className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <input type="number" value={form.soldPrice} onChange={(e) => setForm({ ...form, soldPrice: e.target.value })} placeholder="Sold price" className="min-w-0 rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
              <input type="number" value={form.boughtPrice} onChange={(e) => setForm({ ...form, boughtPrice: e.target.value })} placeholder="Bought price" className="min-w-0 rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            </div>
            <input value={form.boughtFrom} onChange={(e) => setForm({ ...form, boughtFrom: e.target.value })} placeholder="Bought from" className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            <input type="datetime-local" value={form.soldAt} onChange={(e) => setForm({ ...form, soldAt: e.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { resetForm(); setMode("control"); }} className="min-h-11 rounded-xl bg-slate-100 font-bold dark:bg-slate-800">Cancel</button>
              <button onClick={saveSale} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-coral font-black text-white disabled:opacity-60"><Save size={17} /> {busy ? "Saving..." : "Save"}</button>
            </div>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" hidden onChange={(event) => pickFile(event.target.files?.[0])} />
            <button onClick={() => inputRef.current?.click()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white"><Upload size={17} /> Choose, paste, or drop image fallback</button>
          </div>
        </section>
      ) : (
        <>
          <section className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl bg-white/90 p-3 shadow-soft dark:bg-slate-900">
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="flex w-full min-w-0 max-w-full items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/70">
              <Search size={17} className="text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sales" className="w-full min-w-0 max-w-full flex-1 bg-transparent outline-none" />
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
              <option value="recent">Recent</option>
              <option value="oldest">Oldest</option>
              <option value="highest_sold">Highest sold price</option>
              <option value="highest_profit">Highest profit</option>
              <option value="lowest_profit">Lowest profit</option>
              <option value="missing">Missing details</option>
            </select>
            <select value={eventFilter} onChange={(e) => { setEventFilter(e.target.value); setEventDayFilter(""); }} className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
              <option value="">All events</option>
              {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
            </select>
            <select value={eventDayFilter || dateFilter} onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith("day:")) {
                setEventDayFilter(value.replace("day:", ""));
                setDateFilter("all");
              } else {
                setEventDayFilter("");
                setDateFilter(value as DateFilter);
              }
            }} className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
              <option value="all">All dates</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="custom">Custom date</option>
              {selectedFilterEvent ? eventDays(selectedFilterEvent).map((day) => <option key={day.id} value={`day:${day.id}`}>{day.date.slice(0, 10)}</option>) : null}
            </select>
            {dateFilter === "custom" ? <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800 dark:bg-slate-950 dark:text-white" /> : null}
            </div>
            <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              <button onClick={syncPending} className="min-h-11 w-full min-w-0 max-w-full rounded-xl bg-ink px-3 py-2 text-sm font-bold text-white dark:bg-coral">Sync Pending</button>
              <button onClick={() => { setQuery(""); setSort("recent"); setEventFilter(""); setEventDayFilter(""); setDateFilter("all"); }} className="min-h-11 w-full min-w-0 max-w-full rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-ink dark:bg-slate-800 dark:text-white">Clear Filters</button>
            </div>
          </section>
          {loading ? <LoadingScreen label="Loading sales..."><section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[1, 2, 3].map((item) => <SkeletonEventCard key={item} />)}</section></LoadingScreen> : null}
          {!loading && filtered.length === 0 ? <EmptyState title="No sales yet." /> : null}
          <section className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {filtered.map((sale) => {
              const event = sale.eventId ? eventMap.get(sale.eventId) : undefined;
              return (
                <article key={sale.id} onClick={() => editSale(sale)} className="min-w-0 max-w-full cursor-pointer overflow-hidden rounded-2xl bg-white/90 p-3 shadow-soft transition hover:-translate-y-0.5 dark:bg-slate-900">
                  {sale.imageUrl ? <img src={sale.imageUrl} loading="lazy" decoding="async" alt="" className="aspect-[4/5] w-full rounded-xl object-contain bg-slate-100 dark:bg-slate-950" /> : <div className="flex aspect-[4/5] items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-950">No image</div>}
                  <div className="mt-3 space-y-1 text-sm">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <h2 className="min-w-0 flex-1 truncate font-black text-ink dark:text-white">{sale.itemName || "Untitled sale"}</h2>
                      {sale.pendingUpload ? <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">Pending upload</span> : null}
                    </div>
                    <p className="truncate text-xs text-slate-500">{event?.name || "No event selected"}</p>
                    <p>Sold {formatMoney(Number(sale.soldPrice || 0))} | Cost {formatMoney(Number(sale.boughtPrice || 0))}</p>
                    <p className={`font-black ${profit(sale) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>Profit {formatMoney(profit(sale))}</p>
                    {sale.boughtFrom ? <p className="break-words text-xs text-slate-500">From: {sale.boughtFrom}</p> : null}
                    {sale.notes ? <p className="break-words text-xs text-slate-500">{sale.notes}</p> : null}
                  </div>
                  <button onClick={async (eventClick) => { eventClick.stopPropagation(); await deleteSaleRecord(sale.id); await load(0, false); }} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-xl bg-rose-50 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200"><Trash2 size={15} /> Delete</button>
                </article>
              );
            })}
          </section>
          {hasMoreSales ? (
            <button
              onClick={() => void load(salesPage + 1, true)}
              disabled={loadingMore}
              className="min-h-11 w-full rounded-xl bg-white text-sm font-black text-ink shadow-soft disabled:opacity-60 dark:bg-slate-900 dark:text-white"
            >
              {loadingMore ? "Loading more..." : "Load more sales"}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
