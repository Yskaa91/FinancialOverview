// House-price index arithmetic. CBS publishes a quarterly index per municipality
// (2020 = 100); a home is worth what the index did between the purchase quarter
// and the newest one. Pure: the network lives in ./cbs.ts.

/** Index values are stored as integers scaled by 1e6, like every other ratio. */
export const INDEX_SCALE_1E6 = 1_000_000;

export type IndexPoint = { period: string; indexMicro: number };

/** CBS quarter code for a date: 2024-Q2 becomes "2024KW02". */
export function quarterCode(date: Date): string {
  return `${date.getUTCFullYear()}KW${String(Math.floor(date.getUTCMonth() / 3) + 1).padStart(2, "0")}`;
}

/** True for a quarterly code; CBS also ships yearly rows ("2024JJ00"). */
export function isQuarterCode(period: string): boolean {
  return /^\d{4}KW\d{2}$/.test(period);
}

export function toIndexMicro(index: number): number {
  return Math.round(index * INDEX_SCALE_1E6);
}

/** Newest point with a period at or before `period`; older data is not asked for. */
export function indexAtPeriod(points: IndexPoint[], period: string): IndexPoint | null {
  let best: IndexPoint | null = null;
  for (const point of points) {
    if (point.period > period) continue;
    if (!best || point.period > best.period) best = point;
  }
  return best;
}

export function latestPoint(points: IndexPoint[]): IndexPoint | null {
  let best: IndexPoint | null = null;
  for (const point of points) {
    if (!best || point.period > best.period) best = point;
  }
  return best;
}

/**
 * Approximate value: the purchase price moved by the index ratio. A purchase
 * newer than the newest index quarter keeps the price as it was paid.
 */
export function estimateValueCents(
  purchasePriceCents: number,
  indexAtPurchaseMicro: number | null,
  indexLatestMicro: number | null,
): number | null {
  if (indexAtPurchaseMicro === null || indexLatestMicro === null) return null;
  if (indexAtPurchaseMicro <= 0) return null;
  return Math.round((purchasePriceCents * indexLatestMicro) / indexAtPurchaseMicro);
}
