import type { ReactNode } from "react";
import Link from "next/link";
import { MonthPicker } from "./period-month-picker";
import {
  isFuture,
  previousPeriod,
  shiftPeriod,
  withKind,
  type Granularity,
  type Period,
} from "@/lib/periods";

const KINDS: { kind: Granularity; label: string }[] = [
  { kind: "month", label: "Month" },
  { kind: "quarter", label: "Quarter" },
  { kind: "year", label: "Year" },
];

const PILL = "rounded-md border px-2.5 py-1.5";
const IDLE = "border-border text-muted hover:bg-surface-muted";
const ACTIVE = "border-accent bg-accent/10 font-medium text-foreground";
const DISABLED = "border-border/60 text-muted/40";

/**
 * Period navigation is plain links: the URL carries the period and what it is
 * compared with, so every view is bookmarkable and the back button walks back
 * through the months the user actually looked at.
 */
export function PeriodBar({ period, compare }: { period: Period; compare: Period | null }) {
  const href = (p: Period, c: string | Period | null = compare) =>
    `/?p=${p.key}&c=${c === null ? "off" : typeof c === "string" ? c : c.key}`;
  const now = new Date();

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <PeriodStepper
        period={period}
        isCompared={false}
        previousHref={href(previousPeriod(period))}
        nextHref={href(shiftPeriod(period, 1))}
        canStepForward={!isFuture(shiftPeriod(period, 1), now)}
        picker={(value) => (
          <MonthPicker
            value={value}
            field="p"
            other={compare === null ? "off" : compare.key}
            label="Jump to month"
          />
        )}
      />

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

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Compare with">
        <span className="text-xs text-muted">Compare:</span>
        <Link
          href={href(period, compare ? "off" : previousPeriod(period))}
          aria-label={compare ? "Turn the comparison off" : "Turn the comparison on"}
          title={compare ? "Hide the comparison" : "Compare with another period"}
          className={`${PILL} ${compare ? ACTIVE : IDLE}`}
        >
          {compare ? "On" : "Off"}
        </Link>
        {compare && (
          <PeriodStepper
            period={compare}
            isCompared
            previousHref={href(period, shiftPeriod(compare, -1))}
            nextHref={href(period, shiftPeriod(compare, 1))}
            canStepForward={shiftPeriod(compare, 1).start < period.start}
            picker={(value) => (
              <MonthPicker
                value={value}
                field="c"
                other={period.key}
                label="Compare with month"
              />
            )}
          />
        )}
      </div>
    </div>
  );
}

/**
 * `← [period] →` for one of the two periods. The label is a month picker;
 * quarters and years keep a plain label, because a month input cannot say
 * "Q4 2026".
 */
function PeriodStepper({
  period,
  isCompared,
  previousHref,
  nextHref,
  canStepForward,
  picker,
}: {
  period: Period;
  isCompared: boolean;
  previousHref: string;
  nextHref: string;
  canStepForward: boolean;
  picker: (value: string) => ReactNode;
}) {
  const previous = previousPeriod(period);
  const next = shiftPeriod(period, 1);
  const arrowLabel = (target: Period, direction: "Previous" | "Next") =>
    isCompared
      ? `${direction} period to compare with: ${target.label}`
      : `${direction} period: ${target.label}`;

  return (
    <nav aria-label={isCompared ? "Compared period" : "Period"} className="flex items-center gap-1">
      <Link
        href={previousHref}
        className={`${PILL} ${IDLE}`}
        aria-label={arrowLabel(previous, "Previous")}
        title={previous.label}
      >
        ←
      </Link>
      {period.kind === "month" ? (
        picker(period.key)
      ) : (
        <span className="min-w-[9.5rem] text-center font-medium">{period.label}</span>
      )}
      {canStepForward ? (
        <Link
          href={nextHref}
          className={`${PILL} ${IDLE}`}
          aria-label={arrowLabel(next, "Next")}
          title={next.label}
        >
          →
        </Link>
      ) : (
        <span className={`${PILL} ${DISABLED}`} aria-hidden>
          →
        </span>
      )}
    </nav>
  );
}
