// Periods are half-open UTC ranges: `start` inclusive, `end` exclusive, matching
// how every other query bounds a month. One key format per granularity
// ("2026-11", "2026-Q4", "2026") round-trips through the URL, so a link fully
// describes what the page shows and the browser's back button keeps working.

import { LOCALE } from "@/lib/money";

export type Granularity = "month" | "quarter" | "year";

export type Period = {
  kind: Granularity;
  /** Inclusive lower bound, UTC midnight. */
  start: Date;
  /** Exclusive upper bound, UTC midnight. */
  end: Date;
  /** Stable key for the URL: `2026-11`, `2026-Q4`, `2026`. */
  key: string;
  /** Human label: "November 2026", "Q4 2026", "2026". */
  label: string;
};

const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `index` is the month (0-11), the quarter (0-3) or 0 for a year. Out-of-range
 * values roll over into the neighbouring year, which is what shifting wants.
 */
function build(kind: Granularity, year: number, index: number): Period {
  if (kind === "month") {
    const start = new Date(Date.UTC(year, index, 1));
    const end = new Date(Date.UTC(year, index + 1, 1));
    return {
      kind,
      start,
      end,
      key: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`,
      label: MONTH_LABEL.format(start),
    };
  }

  if (kind === "quarter") {
    const start = new Date(Date.UTC(year, index * 3, 1));
    const end = new Date(Date.UTC(year, index * 3 + 3, 1));
    const quarter = Math.floor(start.getUTCMonth() / 3) + 1;
    return {
      kind,
      start,
      end,
      key: `${start.getUTCFullYear()}-Q${quarter}`,
      label: `Q${quarter} ${start.getUTCFullYear()}`,
    };
  }

  const start = new Date(Date.UTC(year, 0, 1));
  return {
    kind,
    start,
    end: new Date(Date.UTC(year + 1, 0, 1)),
    key: String(year),
    label: String(year),
  };
}

/** The period of `kind` that contains `ref`. */
export function periodOf(kind: Granularity, ref: Date = new Date()): Period {
  if (kind === "quarter") {
    return build("quarter", ref.getUTCFullYear(), Math.floor(ref.getUTCMonth() / 3));
  }
  if (kind === "year") return build("year", ref.getUTCFullYear(), 0);
  return build("month", ref.getUTCFullYear(), ref.getUTCMonth());
}

/** A period key, or null when the text is not one. */
export function tryParsePeriod(raw?: string | string[] | null): Period | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const text = (value ?? "").trim();

  const month = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (month) {
    const m = Number(month[2]);
    if (m >= 1 && m <= 12) return build("month", Number(month[1]), m - 1);
  }

  const quarter = /^(\d{4})-[Qq]([1-4])$/.exec(text);
  if (quarter) return build("quarter", Number(quarter[1]), Number(quarter[2]) - 1);

  const year = /^(\d{4})$/.exec(text);
  if (year) return build("year", Number(year[1]), 0);

  return null;
}

/**
 * Parses `?p=`. Anything unrecognised falls back to the current month rather
 * than throwing: a hand-edited URL should not blank the dashboard.
 */
export function parsePeriod(raw?: string | string[] | null, now: Date = new Date()): Period {
  return tryParsePeriod(raw) ?? periodOf("month", now);
}

/**
 * Parses `?c=`. `off` hides the comparison, a period key picks what to compare
 * with, and anything else means "the period right before this one". A picked
 * period takes the length of the shown one, so both columns always cover the
 * same amount of time.
 */
export function comparePeriod(
  raw: string | string[] | null | undefined,
  current: Period,
): Period | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase() ?? "";
  if (value === "off") return null;

  const picked = tryParsePeriod(value);
  const period = picked ? withKind(picked, current.kind) : previousPeriod(current);
  // Comparing a period with itself is a table of zeros; step back instead.
  return period.key === current.key ? previousPeriod(current) : period;
}

/** `-1` is the previous period, `+1` the next one; the step size follows `kind`. */
export function shiftPeriod(period: Period, steps: number): Period {
  if (period.kind === "year") {
    return build("year", period.start.getUTCFullYear() + steps, 0);
  }
  const months = period.kind === "month" ? steps : steps * 3;
  const start = new Date(
    Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth() + months, 1),
  );
  return periodOf(period.kind, start);
}

export function previousPeriod(period: Period): Period {
  return shiftPeriod(period, -1);
}

/** The same calendar slot one year earlier: the fair comparison for seasonality. */
export function yearAgoPeriod(period: Period): Period {
  const steps = period.kind === "month" ? -12 : period.kind === "quarter" ? -4 : -1;
  return shiftPeriod(period, steps);
}

/** Keeps the anchor date, changes the length: "November" → "Q4 2026" → "2026". */
export function withKind(period: Period, kind: Granularity): Period {
  return periodOf(kind, period.start);
}

/** True when the period has not started yet, so there is nothing to show. */
export function isFuture(period: Period, now: Date = new Date()): boolean {
  return period.start.getTime() > now.getTime();
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** `YYYY-MM-DD` bounds for a `/transactions?from=&to=` link; `to` is inclusive. */
export function dayBounds(period: Period): { from: string; to: string } {
  return { from: iso(period.start), to: iso(new Date(period.end.getTime() - 86_400_000)) };
}

export type CategoryTotal = {
  /** `null` is the "Uncategorised" bucket: it has no category row to point at. */
  id: string | null;
  name: string;
  color: string | null;
  /** Spending as a positive magnitude. */
  cents: number;
};

export type PeriodTotals = {
  period: Period;
  incomeCents: number;
  /** Positive magnitude of everything that left the accounts. */
  expenseCents: number;
  categories: CategoryTotal[];
};

export type CompareRow = {
  id: string | null;
  name: string;
  color: string | null;
  currentCents: number;
  otherCents: number;
  /** Positive means more was spent in the current period. */
  deltaCents: number;
};

/**
 * Lines up two periods by category. Categories that only exist on one side are
 * kept — a subscription that started this month is exactly what the user is
 * looking for — and the union is ordered by what dominates the current period.
 */
export function comparisonRows(
  current: CategoryTotal[],
  other: CategoryTotal[],
): CompareRow[] {
  const keyOf = (id: string | null) => id ?? "\u0000uncategorised";
  const rows = new Map<string, CompareRow>();

  for (const item of other) {
    rows.set(keyOf(item.id), {
      id: item.id,
      name: item.name,
      color: item.color,
      currentCents: 0,
      otherCents: item.cents,
      deltaCents: -item.cents,
    });
  }

  for (const item of current) {
    const row = rows.get(keyOf(item.id));
    if (row) {
      row.currentCents = item.cents;
      // The current side wins the label: a renamed category reads as renamed.
      row.name = item.name;
      row.color = item.color;
      row.deltaCents = item.cents - row.otherCents;
    } else {
      rows.set(keyOf(item.id), {
        id: item.id,
        name: item.name,
        color: item.color,
        currentCents: item.cents,
        otherCents: 0,
        deltaCents: item.cents,
      });
    }
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.currentCents - a.currentCents ||
      b.otherCents - a.otherCents ||
      a.name.localeCompare(b.name),
  );
}

const PERCENT = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/**
 * `+18%`, `−3,7%`, or `new` when the earlier period had nothing to compare
 * against. One decimal, because a real but small change must not read as `0%`.
 */
export function formatChangePercent(deltaCents: number, baseCents: number): string {
  if (baseCents === 0) return deltaCents === 0 ? "—" : "new";
  const percent = Math.round((deltaCents / baseCents) * 1000) / 10;
  if (percent === 0) return "0%";
  return `${percent > 0 ? "+" : "−"}${PERCENT.format(Math.abs(percent))}%`;
}
