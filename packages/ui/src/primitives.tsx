import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { AnimatedNumber } from "./motion/animated-number";
import { Button } from "./motion/button/base";
import { Loader } from "./motion/loader";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? "Loading"}
      className={cn(
        "inline-block size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary",
        className,
      )}
    />
  );
}

export function FullPageSpinner({ label }: { label?: string | undefined }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Spinner label={label ?? "Loading"} />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string | undefined }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-border p-6 text-center sm:p-10">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SurfacePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <section className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <EmptyState title="Nothing here yet" hint="This surface ships in a later phase." />
    </section>
  );
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: string;
  description?: string | undefined;
  icon?: ReactNode | undefined;
  actions?: ReactNode | undefined;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground">
            {icon}
          </span>
        ) : null}
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string | undefined;
  description?: string | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  bodyClassName?: string | undefined;
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export type StatTone = "neutral" | "info" | "success" | "warning" | "danger";

const STAT_TONE: Record<StatTone, { color: string }> = {
  neutral: { color: "#94a3b8" },
  info: { color: "#38bdf8" },
  success: { color: "#34d399" },
  warning: { color: "#fbbf24" },
  danger: { color: "#fb7185" },
};

export function StatCard({
  label,
  value,
  hint,
  format,
  decimals,
  tone,
  icon,
  trend,
}: {
  label: string;
  value: number | string;
  hint?: string | undefined;
  format?: ((n: number) => string) | undefined;
  /** Round the rolling value to N decimals — use for currency/rates. */
  decimals?: number | undefined;
  tone?: StatTone | undefined;
  icon?: ReactNode | undefined;
  /** `value` is a percentage change; `invert` treats a rise as bad (e.g. abandon rate). */
  trend?: { value: number; label?: string; invert?: boolean } | undefined;
}) {
  const t = STAT_TONE[tone ?? "neutral"];

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        {icon ? (
          <span className="shrink-0 [&_svg]:size-3.5" style={{ color: t.color }}>
            {icon}
          </span>
        ) : null}
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      </div>

      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
        {typeof value === "number" ? (
          <AnimatedNumber
            value={value}
            startOnView={false}
            {...(format ? { format } : {})}
            {...(decimals !== undefined ? { decimals } : {})}
          />
        ) : (
          value
        )}
      </p>

      {hint || trend ? (
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {hint ? <span className="truncate">{hint}</span> : null}
          {trend ? (
            <span
              className={cn(
                "shrink-0 font-medium tabular-nums",
                trend.value >= 0 !== Boolean(trend.invert)
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400",
              )}
            >
              {trend.value >= 0 ? "▲" : "▼"} {Math.abs(trend.value)}%
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
      <Loader variant="dots" size={22} label={label} />
      {label}…
    </div>
  );
}

export function EmptyPanel({
  title,
  hint,
  icon,
  action,
}: {
  title: string;
  hint?: string | undefined;
  icon?: ReactNode | undefined;
  action?: { label: string; onClick: () => void } | undefined;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      {icon ? (
        <span className="mb-1 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
      {action ? (
        <Button size="sm" variant="secondary" className="mt-2" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
