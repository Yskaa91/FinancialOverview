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
    <section className={`rounded-lg border border-border bg-surface p-5 ${className}`}>
      {(title ?? action) && (
        <header className="mb-4 flex items-baseline justify-between gap-3">
          {title && <h2 className="text-sm font-medium text-muted">{title}</h2>}
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
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`tabular mt-1 ${large ? "text-3xl" : "text-xl"} font-semibold ${toneClass[tone]}`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
    </header>
  );
}
