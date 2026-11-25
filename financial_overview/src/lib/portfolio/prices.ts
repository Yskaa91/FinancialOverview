// Valuation only ever needs the newest price row (docs/ARCHITECTURE.md §13); a
// stale one is worth refetching rather than showing as today's value.
// Pure: fetching lives elsewhere.

export const PRICE_TTL_MS = 12 * 60 * 60 * 1000;

export function latestPriceCents(prices: { fetchedAt: Date; priceCents: number }[]): number | null {
  let latest: { fetchedAt: Date; priceCents: number } | null = null;
  for (const price of prices) {
    if (!latest || price.fetchedAt.getTime() > latest.fetchedAt.getTime()) latest = price;
  }
  return latest ? latest.priceCents : null;
}

/** No price at all counts as stale: something still has to be fetched. */
export function isStale(fetchedAt: Date | null, now: Date): boolean {
  if (!fetchedAt) return true;
  return now.getTime() - fetchedAt.getTime() >= PRICE_TTL_MS;
}
