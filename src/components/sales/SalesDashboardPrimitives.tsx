import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, Circle, Info, LoaderCircle, RotateCcw, TriangleAlert, X, XCircle
} from "lucide-react";
import {
  forwardRef, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode, type RefObject
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "success" | "warning" | "destructive" | "icon" | "floating";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "ui-button ui-button-primary",
  secondary: "ui-button ui-button-secondary",
  ghost: "ui-button ui-button-ghost",
  success: "ui-button ui-button-success",
  warning: "ui-button ui-button-warning",
  destructive: "ui-button ui-button-destructive",
  icon: "ui-button ui-button-icon",
  floating: "ui-button ui-button-floating"
};

export const AppButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }>(function AppButton({ variant = "primary", loading = false, className = "", children, disabled, ...props }, ref) {
  return <button ref={ref} {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={`${buttonVariants[variant]} ${className}`}>
    {loading ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : null}
    {children}
  </button>;
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; loading?: boolean }>(function IconButton({ label, loading, children, ...props }, ref) {
  return <AppButton ref={ref} {...props} variant="icon" loading={loading} aria-label={label} title={label}>{children}</AppButton>;
});

export const FloatingActionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(function FloatingActionButton({ label, children, ...props }, ref) {
  return <AppButton ref={ref} {...props} variant="floating" aria-label={label}>{children}</AppButton>;
});

export function DashboardPanel({ eyebrow, title, action, className = "", children }: { eyebrow?: string; title?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`dashboard-panel ${className}`}>
    {eyebrow || title || action ? <div className="dashboard-panel-header">
      <div>{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}{title ? <h2 className="section-title">{title}</h2> : null}</div>
      {action}
    </div> : null}
    {children}
  </section>;
}

type Accent = "orange" | "blue" | "purple" | "green" | "red" | "cyan";

export function MetricCard({ label, value, context, icon, accent = "orange", negative = false }: { label: string; value: ReactNode; context?: string; icon: ReactNode; accent?: Accent; negative?: boolean }) {
  return <article className={`metric-card metric-card-${accent}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="metric-label">{label}</p>
        <p key={String(value)} className={`metric-value metric-number-change ${negative ? "text-rose-400" : ""}`}>{value}</p>
      </div>
      <span className="metric-icon" aria-hidden="true">{icon}</span>
    </div>
    {context ? <p className="metric-context">{context}</p> : null}
  </article>;
}

export function ActionCard({ title, description, icon, accent, onClick, loading = false, selected = false, disabled = false }: {
  title: string;
  description: string;
  icon: ReactNode;
  accent: Accent;
  onClick: () => void;
  loading?: boolean;
  selected?: boolean;
  disabled?: boolean;
}) {
  return <button
    type="button"
    onClick={onClick}
    disabled={loading || disabled}
    aria-busy={loading || undefined}
    className={`group transaction-action-card transaction-action-${accent} ${selected ? "is-selected" : ""}`}
  >
    <span className="transaction-action-icon">{loading ? <LoaderCircle className="animate-spin" size={24} /> : icon}</span>
    <span className="min-w-0 flex-1 text-left">
      <span className="block text-base font-black text-white">{title}</span>
      <span className="mt-1 block text-sm leading-5 text-slate-300">{description}</span>
    </span>
    <ArrowRight size={19} className="transaction-action-arrow" aria-hidden="true" />
  </button>;
}

export function DashboardEmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="dashboard-empty-state">
    <span className="dashboard-empty-icon" aria-hidden="true">{icon}</span>
    <p className="font-black text-slate-100">{title}</p>
    <p className="mt-1 max-w-md text-sm leading-5 text-slate-400">{description}</p>
    {action ? <div className="mt-4">{action}</div> : null}
  </div>;
}

export function DashboardSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" aria-hidden="true">
    {Array.from({ length: rows }, (_, index) => <div key={index} className="skeleton-shimmer h-16 rounded-2xl bg-slate-800/70" />)}
  </div>;
}

export function SkeletonCard() {
  return <div className="dashboard-panel space-y-4" aria-hidden="true">
    <div className="skeleton-shimmer h-3 w-24 rounded-full bg-slate-200 dark:bg-slate-800" />
    <div className="skeleton-shimmer h-8 w-2/3 rounded-xl bg-slate-200 dark:bg-slate-800" />
    <div className="skeleton-shimmer h-20 rounded-2xl bg-slate-100 dark:bg-slate-900" />
  </div>;
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return <div className="dashboard-panel space-y-3" aria-hidden="true">
    <div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton-shimmer h-4 rounded-full bg-slate-200 dark:bg-slate-800" />)}</div>
    {Array.from({ length: rows }, (_, index) => <div key={index} className="grid grid-cols-4 gap-3 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
      {Array.from({ length: 4 }, (_, cell) => <div key={cell} className="skeleton-shimmer h-5 rounded-lg bg-slate-100 dark:bg-slate-900" />)}
    </div>)}
  </div>;
}

export function SkeletonChart() {
  return <div className="dashboard-panel" aria-hidden="true">
    <div className="skeleton-shimmer h-4 w-40 rounded-full bg-slate-200 dark:bg-slate-800" />
    <div className="mt-5 flex h-56 items-end gap-3">
      {[46, 72, 55, 88, 64, 78].map((height, index) => <div key={index} className="skeleton-shimmer flex-1 rounded-t-xl bg-slate-200 dark:bg-slate-800" style={{ height: `${height}%` }} />)}
    </div>
  </div>;
}

export function LoadingOverlay({ label = "Preparing your workflow…", detail, onRetry, onCancel, cancelLabel = "Return to Sales Control", timeoutMs = 15_000, inline = false }: {
  label?: string;
  detail?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
  timeoutMs?: number;
  inline?: boolean;
}) {
  const [slow, setSlow] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const slowTimer = window.setTimeout(() => setSlow(true), 3_000);
    const timeoutTimer = window.setTimeout(() => setTimedOut(true), timeoutMs);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeoutTimer);
    };
  }, [timeoutMs]);

  const content = <div className="loading-state-card" role="status" aria-live="polite" aria-busy={!timedOut}>
    <span className="loading-state-orbit" aria-hidden="true"><LoaderCircle size={30} /></span>
    <div>
      <p className="font-black text-slate-950 dark:text-white">{timedOut ? "This transaction could not be opened" : slow ? "Still preparing your transaction…" : label}</p>
      <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">{timedOut ? "Your data is safe. Retry the transition or return to Sales Control." : detail || "Please keep this window open."}</p>
    </div>
    {timedOut ? <div className="mt-2 flex flex-wrap justify-center gap-2">
      {onRetry ? <AppButton type="button" variant="secondary" onClick={onRetry}><RotateCcw size={16} /> Retry</AppButton> : null}
      {onCancel ? <AppButton type="button" variant="ghost" onClick={onCancel}>{cancelLabel}</AppButton> : null}
    </div> : null}
  </div>;

  return inline ? content : <div className="loading-overlay">{content}</div>;
}

export type ProgressStep = { id: string; label: string };

export function ProgressSteps({ steps, activeStep, complete = false, title = "Saving transaction" }: {
  steps: ProgressStep[];
  activeStep: number;
  complete?: boolean;
  title?: string;
}) {
  return <section className="progress-panel" role="status" aria-live="polite" aria-label={title}>
    <div className="flex items-center justify-between gap-3">
      <div><p className="eyebrow">{complete ? "Complete" : "In progress"}</p><h3 className="font-black text-slate-950 dark:text-white">{complete ? "Transaction saved" : title}</h3></div>
      {complete ? <CheckCircle2 className="text-emerald-500" /> : <LoaderCircle className="animate-spin text-coral" />}
    </div>
    <ol className="mt-4 grid gap-2 sm:grid-cols-3">
      {steps.map((step, index) => {
        const done = complete || index < activeStep;
        const active = !complete && index === activeStep;
        return <li key={step.id} className={`progress-step ${done ? "is-done" : active ? "is-active" : ""}`}>
          <span className="progress-step-icon">{done ? <Check size={14} /> : active ? <LoaderCircle size={14} className="animate-spin" /> : <Circle size={11} />}</span>
          <span>{step.label}</span>
        </li>;
      })}
    </ol>
  </section>;
}

type ToastTone = "success" | "error" | "warning" | "info";

export function Toast({ open, message, tone = "info", onDismiss, action }: {
  open: boolean;
  message: string;
  tone?: ToastTone;
  onDismiss: () => void;
  action?: { label: string; onClick: () => void };
}) {
  useEffect(() => {
    if (!open || tone === "error") return;
    const timer = window.setTimeout(onDismiss, 4_500);
    return () => window.clearTimeout(timer);
  }, [onDismiss, open, tone]);

  if (!open) return null;
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? XCircle : tone === "warning" ? TriangleAlert : Info;
  return <div className={`app-toast app-toast-${tone}`} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}>
    <Icon size={20} className="shrink-0" aria-hidden="true" />
    <p className="min-w-0 flex-1 text-sm font-bold">{message}</p>
    {action ? <button type="button" onClick={action.onClick} className="rounded-lg px-2 py-1 text-xs font-black underline underline-offset-2">{action.label}</button> : null}
    <button type="button" onClick={onDismiss} className="rounded-lg p-1 opacity-70 hover:opacity-100" aria-label="Dismiss notification"><X size={17} /></button>
  </div>;
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="tooltip-root" data-tooltip={label}>{children}</span>;
}

export function StatusChip({ label, tone = "neutral", dot = true }: {
  label: string;
  tone?: "success" | "warning" | "danger" | "info" | "trade" | "neutral";
  dot?: boolean;
}) {
  return <span className={`transaction-status-chip status-${tone}`}>{dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}{label}</span>;
}

export function ResponsiveModal({ open, title, description, onClose, restoreFocusRef, children, size = "md", dismissible = true }: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  dismissible?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const touchStartY = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    window.requestAnimationFrame(() => {
      const first = panel?.querySelector<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
      first?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => restoreFocusRef?.current?.focus());
    };
  }, [dismissible, open, onClose, restoreFocusRef]);

  if (!open) return null;
  return <div className="responsive-modal-backdrop" onMouseDown={(event) => { if (dismissible && event.target === event.currentTarget) onClose(); }}>
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={`responsive-modal-panel responsive-modal-${size}`}
      onTouchStart={(event) => { touchStartY.current = event.touches[0]?.clientY; }}
      onTouchEnd={(event) => {
        const end = event.changedTouches[0]?.clientY;
        if (dismissible && touchStartY.current !== undefined && end !== undefined && end - touchStartY.current > 72) onClose();
        touchStartY.current = undefined;
      }}
    >
      <div className="modal-drag-indicator" aria-hidden="true" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Sales Control</p>
          <h2 id={titleId} className="mt-1 text-2xl font-black text-white">{title}</h2>
          {description ? <p id={descriptionId} className="mt-1 max-w-lg text-sm leading-6 text-slate-400">{description}</p> : null}
        </div>
        {dismissible ? <AppButton type="button" variant="icon" onClick={onClose} aria-label="Close dialog"><X size={19} /></AppButton> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  </div>;
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "danger", busy = false, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return <ResponsiveModal open={open} title={title} description={description} onClose={onCancel} size="sm" dismissible={!busy}>
    <div className={`confirm-callout ${tone === "danger" ? "text-rose-300" : "text-amber-300"}`}>
      <AlertTriangle size={22} className="shrink-0" aria-hidden="true" />
      <p className="text-sm leading-6">This action may remove information that has not been saved.</p>
    </div>
    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <AppButton type="button" variant="ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</AppButton>
      <AppButton type="button" variant={tone === "danger" ? "destructive" : "warning"} loading={busy} onClick={onConfirm}>{confirmLabel}</AppButton>
    </div>
  </ResponsiveModal>;
}
