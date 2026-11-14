import { AlertTriangle, CheckCircle2, Clock3, Loader2, OctagonX, PauseCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Verdict } from "../types/analytics";

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs font-medium tracking-wide text-ink-3 uppercase">
        {label}
        {icon && <span className="text-ink-3">{icon}</span>}
      </div>
      <div className="tabular mt-2 text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

const VERDICT_STYLE: Record<Verdict, { cls: string; Icon: typeof CheckCircle2 }> = {
  GO: { cls: "text-good border-good/40 bg-good/10", Icon: CheckCircle2 },
  OK: { cls: "text-good border-good/40 bg-good/10", Icon: CheckCircle2 },
  "KEEP RUNNING": { cls: "text-warning border-warning/40 bg-warning/10", Icon: Clock3 },
  CONDITIONAL: { cls: "text-warning border-warning/40 bg-warning/10", Icon: AlertTriangle },
  STOP: { cls: "text-serious border-serious/40 bg-serious/10", Icon: PauseCircle },
  "ACTION REQUIRED": { cls: "text-serious border-serious/40 bg-serious/10", Icon: AlertTriangle },
  "NO-GO": { cls: "text-critical border-critical/40 bg-critical/10", Icon: OctagonX },
};

/** Status badge: colour is never the only carrier of meaning (icon + label). */
export function VerdictBadge({ verdict, size = "sm" }: { verdict: Verdict; size?: "sm" | "lg" }) {
  const { cls, Icon } = VERDICT_STYLE[verdict] ?? VERDICT_STYLE.OK;
  const sz = size === "lg" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-semibold tracking-wide ${cls} ${sz}`}>
      <Icon className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
      {verdict}
    </span>
  );
}

export function Pill({ tone, children }: { tone: "good" | "warning" | "critical" | "neutral"; children: ReactNode }) {
  const map = {
    good: "text-good bg-good/10 border-good/30",
    warning: "text-warning bg-warning/10 border-warning/30",
    critical: "text-critical bg-critical/10 border-critical/30",
    neutral: "text-ink-2 bg-surface-2 border-line",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  options: string[];
  allLabel?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
      {label}
      <select
        className="h-9 min-w-40 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink focus:ring-2 focus:ring-brand/40 focus:outline-none"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-3">
      {label}
      <div className="relative">
        <input
          type="number"
          className="tabular h-9 w-full rounded-lg border border-line bg-surface px-2.5 pr-8 text-sm text-ink focus:ring-2 focus:ring-brand/40 focus:outline-none"
          value={Number.isFinite(value) ? value : ""}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-ink-3">{suffix}</span>}
      </div>
    </label>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-3" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-sm" role="alert">
      <span className="inline-flex items-center gap-2 text-critical">
        <OctagonX className="h-4 w-4" aria-hidden /> {error.message || "Request failed"}
      </span>
      {onRetry && (
        <button className="rounded-lg border border-line px-3 py-1.5 text-ink-2 hover:bg-surface-2" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Shared Recharts tooltip shell so every chart's hover layer looks the same. */
export function TooltipBox({ title, rows }: { title: ReactNode; rows: { label: string; value: ReactNode; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-2">
            {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="tabular font-medium text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function LegendItem({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span
        className="inline-block h-0.5 w-4"
        style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color }}
      />
      {label}
    </span>
  );
}
