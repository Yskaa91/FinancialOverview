import Link from "next/link";
import {
  isFuture,
  periodOf,
  previousPeriod,
  shiftPeriod,
  withKind,
  type Granularity,
  type Period,
} from "@/lib/periods";

export type CompareMode = "off" | "prev" | "year";

const KINDS: { kind: Granularity; label: string }[] = [
  { kind: "month", label: "Month" },
  { kind: "quarter", label: "Quarter" },
  { kind: "year", label: "Year" },
];

const COMPARISONS: { mode: CompareMode; label: string; title: string }[] = [
  { mode: "prev", label: "Previous", title: "The period right before this one" },
  { mode: "year", label: "Year earlier", title: "The same period one year ago" },
  { mode: "off", label: "Off", title: "Show this period on its own" },
];

const PILL = "rounded-md border px-2.5 py-1.5";
const IDLE = "border-border text-muted hover:bg-surface-muted";
const ACTIVE = "border-accent bg-accent/10 font-medium text-foreground";

/**
 * Period navigation is plain links: the URL carries the period and the
 * comparison, so every view is bookmarkable and the back button walks back
 * through the months the user actually looked at.
 */
export function PeriodBar({ period, compare }: { period: Period; compare: CompareMode }) {
  const href = (p: Period, c: CompareMode = compare) => `/?p=${p.key}&c=${c}`;
  const previous = previousPeriod(period);
  const next = shiftPeriod(period, 1);
  const now = new Date();

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <nav aria-label="Period" className="flex items-center gap-1">
        <Link
          href={href(previous)}
          className={`${PILL} ${IDLE}`}
          aria-label={`Previous period: ${previous.label}`}
          title={previous.label}
        >
          ←
        </Link>
        <span className="min-w-[9.5rem] text-center font-medium">{period.label}</span>
        {isFuture(next, now) ? (
          <span className={`${PILL} border-border/60 text-muted/40`} aria-hidden>
            →
          </span>
        ) : (
          <Link
            href={href(next)}
            className={`${PILL} ${IDLE}`}
            aria-label={`Next period: ${next.label}`}
            title={next.label}
          >
            →
          </Link>
        )}
      </nav>

      <div className="flex items-center gap-1" role="group" aria-label="Period length">
        {KINDS.map(({ kind, label }) => (
          <Link
            key={kind}
            href={href(withKind(period, kind))}
            aria-current={period.kind === kind ? "true" : undefined}
            className={`${PILL} ${period.kind === kind ? ACTIVE : IDLE}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Compare with">
        <span className="text-xs text-muted">Compare:</span>
        {COMPARISONS.map(({ mode, label, title }) => (
          <Link
            key={mode}
            href={href(period, mode)}
            title={title}
            aria-current={compare === mode ? "true" : undefined}
            className={`${PILL} ${compare === mode ? ACTIVE : IDLE}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <Link href="/" className="text-xs text-muted underline">
        This month
      </Link>

      {/* Stepping month by month is fine for a quarter; jumping needs a picker.
          Native month input, plain GET: no client JavaScript in the way. */}
      <form action="/" method="get" className="flex items-center gap-1">
        <input
          type="month"
          name="p"
          defaultValue={periodOf("month", period.start).key}
          aria-label="Jump to month"
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground"
        />
        <input type="hidden" name="c" value={compare} />
        <button type="submit" className={`${PILL} ${IDLE} text-xs`}>
          Go
        </button>
      </form>
    </div>
  );
}
