import type { ReactNode } from "react";

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-border bg-surface p-3 ${className}`}>
      {(title ?? action) && (
        <header className="mb-3 flex items-baseline justify-between gap-3">
          {title && (
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">{title}</h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const toneClass = {
  neutral: "text-foreground",
  positive: "text-positive",
  negative: "text-negative",
} as const;

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  large = false,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof toneClass;
  large?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`tabular mt-1 ${large ? "text-2xl" : "text-lg"} font-semibold leading-tight ${toneClass[tone]}`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-prose text-xs text-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-4">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
    </header>
  );
}
