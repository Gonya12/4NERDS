import { LoaderCircle, X } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";

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

export function ActionCard({ title, description, icon, accent, onClick, loading = false }: { title: string; description: string; icon: ReactNode; accent: Accent; onClick: () => void; loading?: boolean }) {
  return <button type="button" onClick={onClick} disabled={loading} className={`group transaction-action-card transaction-action-${accent}`}>
    <span className="transaction-action-icon">{loading ? <LoaderCircle className="animate-spin" size={24} /> : icon}</span>
    <span className="min-w-0 text-left">
      <span className="block text-base font-black text-white">{title}</span>
      <span className="mt-1 block text-sm leading-5 text-slate-300">{description}</span>
    </span>
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

export function ResponsiveModal({ open, title, description, onClose, restoreFocusRef, children }: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
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
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
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
  }, [open, onClose, restoreFocusRef]);

  if (!open) return null;
  return <div className="responsive-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className="responsive-modal-panel"
      onTouchStart={(event) => { touchStartY.current = event.touches[0]?.clientY; }}
      onTouchEnd={(event) => {
        const end = event.changedTouches[0]?.clientY;
        if (touchStartY.current !== undefined && end !== undefined && end - touchStartY.current > 72) onClose();
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
        <AppButton type="button" variant="icon" onClick={onClose} aria-label="Close dialog"><X size={19} /></AppButton>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  </div>;
}
