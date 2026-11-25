// Valuation only ever needs the newest price row (docs/ARCHITECTURE.md §13); a
// stale one is worth refetching rather than showing as today's value.
// Pure: fetching and parsing quirks live in ./quotes.ts, the parsing itself here.

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

/**
 * Ticker candidates for a free quote, most specific first. Stooq's CSV endpoint
 * started answering with a JavaScript challenge, so the quote comes from Yahoo
 * Finance; an EU ETF lists as `SYMBOL.AS` (Amsterdam) or `SYMBOL.DE` (Xetra).
 */
export function quoteTickers(symbol: string, priceSymbol: string | null): string[] {
  const base = symbol.trim().toUpperCase();
  if (!base) return [];
  // A symbol that already carries a venue ("ASML.AS") is used as it is.
  const venues = base.includes(".") ? [] : [`${base}.AS`, `${base}.DE`];
  const candidates = [priceSymbol?.trim(), ...venues, base];
  return [...new Set(candidates.filter((ticker): ticker is string => Boolean(ticker)))];
}

/** Latest price in cents out of a Yahoo `v8/finance/chart` payload, or null. */
export function parseYahooCloseCents(payload: unknown): number | null {
  const result = (payload as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | {
        meta?: { regularMarketPrice?: number };
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }
    | undefined;
  if (!result) return null;

  const fromMeta = result.meta?.regularMarketPrice;
  if (typeof fromMeta === "number" && Number.isFinite(fromMeta) && fromMeta > 0) {
    return Math.round(fromMeta * 100);
  }

  const closes = result.indicators?.quote?.[0]?.close ?? [];
  for (let i = closes.length - 1; i >= 0; i--) {
    const close = closes[i];
    if (typeof close === "number" && Number.isFinite(close) && close > 0) {
      return Math.round(close * 100);
    }
  }
  return null;
}

/** An ISIN starts with a two-letter country code and ends with a check digit. */
export function looksLikeIsin(value: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value.trim().toUpperCase());
}

/**
 * Ticker out of a Yahoo `v1/finance/search` answer. Yahoo sorts the quotes by
 * how well they match, so the first one that names a symbol is the primary
 * listing; the same ISIN also shows up as `<isin>.<venue>` on a secondary
 * exchange, which is a usable fallback but a worse quote.
 */
export function parseYahooSearchSymbol(payload: unknown): string | null {
  const quotes = (payload as { quotes?: { symbol?: unknown; quoteType?: unknown }[] })?.quotes;
  if (!Array.isArray(quotes)) return null;
  for (const quote of quotes) {
    const symbol = quote?.symbol;
    if (typeof symbol === "string" && symbol.trim() !== "") return symbol.trim();
  }
  return null;
}
