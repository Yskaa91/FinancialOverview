// Dates are stored as UTC midnight and rendered in Europe/Amsterdam. Statement
// dates arrive as "31-01-2026" (NL), "31/01/2026" or "2026-01-31" (PayPal/ISO).

export const TZ = "Europe/Amsterdam";

/** Accepts DD-MM-YYYY, D/M/YYYY, YYYY-MM-DD (and -/ separators mixed). */
export function parseStatementDate(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const nl = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (nl) {
    const year = Number(nl[3]) < 100 ? 2000 + Number(nl[3]) : Number(nl[3]);
    return utcDate(year, Number(nl[2]), Number(nl[1])); // day first
  }

  return null;
}

function utcDate(year: number, month: number, day: number): Date | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  const valid =
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  return valid ? d : null;
}

/** First instant of the month containing `ref`, UTC. */
export function monthStart(ref: Date = new Date()): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
}

/** First instant of the next month, exclusive upper bound. */
export function monthEndExclusive(ref: Date = new Date()): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
}

export function addDays(ref: Date, days: number): Date {
  return new Date(ref.getTime() + days * 86_400_000);
}

export function daysAgo(days: number, ref: Date = new Date()): Date {
  return addDays(ref, -days);
}

const dayFormat = new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: TZ,
});

const monthFormat = new Intl.DateTimeFormat("nl-NL", {
  month: "short",
  year: "2-digit",
  timeZone: TZ,
});

export function formatDay(d: Date): string {
  return dayFormat.format(d);
}

export function formatMonth(d: Date): string {
  return monthFormat.format(d);
}

/** Inclusive lower bound / exclusive upper bound pair for "this month". */
export function currentMonthRange(now: Date = new Date()): { start: Date; end: Date } {
  return { start: monthStart(now), end: monthEndExclusive(now) };
}
