// Price refresh against a keyless source. Stooq's CSV endpoint now answers with
// a JavaScript challenge, so quotes come from Yahoo Finance's chart endpoint
// instead. Everything here is best-effort: a dead price source must never break
// a page (docs/ARCHITECTURE.md §7).

import { prisma } from "@/lib/db";
import {
  isStale,
  looksLikeIsin,
  parseYahooCloseCents,
  parseYahooSearchSymbol,
  quoteTickers,
} from "./prices";

const QUOTE_TIMEOUT_MS = 5000;

/** PRICE_FETCH: "disabled" keeps every price manual. "stooq" is the old value. */
export function priceFetchEnabled(): boolean {
  const value = (process.env.PRICE_FETCH ?? "disabled").trim().toLowerCase();
  return value !== "" && value !== "disabled" && value !== "off";
}

/**
 * ISIN to a real ticker. A fund bought in the app is often identified by its
 * ISIN, which no quote endpoint prices directly, so Yahoo's search is asked
 * which listing matches. Cached per process: one lookup per ISIN per run.
 */
const isinCache = new Map<string, string | null>();

export async function resolveIsinTicker(isin: string): Promise<string | null> {
  const key = isin.trim().toUpperCase();
  if (!looksLikeIsin(key)) return null;
  if (isinCache.has(key)) return isinCache.get(key) ?? null;

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(key)}&quotesCount=5&newsCount=0`,
      {
        signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; FinancialOverview)" },
      },
    );
    const ticker = response.ok ? parseYahooSearchSymbol(await response.json()) : null;
    isinCache.set(key, ticker);
    return ticker;
  } catch {
    return null;
  }
}

/**
 * Candidate tickers for one holding, most specific first: the ticker someone
 * pinned, the listing an ISIN resolves to, the usual venues of a plain symbol,
 * then the symbol as typed.
 */
async function candidateTickers(
  symbol: string,
  priceSymbol: string | null,
  isin: string | null,
): Promise<string[]> {
  const candidates = quoteTickers(symbol, priceSymbol);
  const identifiers = [isin, symbol].filter((value): value is string => Boolean(value));
  for (const identifier of identifiers) {
    if (!looksLikeIsin(identifier)) continue;
    const resolved = await resolveIsinTicker(identifier);
    if (resolved) candidates.unshift(resolved);
  }
  return [...new Set(candidates)];
}

/** Newest close for one instrument in cents, or null when no venue knows it. */
export async function fetchQuoteCents(
  symbol: string,
  priceSymbol: string | null,
  isin: string | null = null,
): Promise<number | null> {
  for (const ticker of await candidateTickers(symbol, priceSymbol, isin)) {
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`,
        {
          signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
          cache: "no-store",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; FinancialOverview)" },
        },
      );
      if (!response.ok) continue;
      const priceCents = parseYahooCloseCents(await response.json());
      if (priceCents !== null) return priceCents;
    } catch {
      // Try the next venue.
    }
  }
  return null;
}

/**
 * Writes a price row for every instrument whose newest quote is stale. Called
 * from the portfolio page, so opening the app is enough: at most one fetch per
 * instrument per twelve hours, and only for instruments someone actually holds.
 */
export async function refreshStalePrices(options: { accountId?: string; force?: boolean } = {}): Promise<number> {
  if (!priceFetchEnabled()) return 0;

  const instruments = await prisma.instrument.findMany({
    where: { trades: { some: options.accountId ? { accountId: options.accountId } : {} } },
    select: { id: true, symbol: true, priceSymbol: true, isin: true },
  });
  if (instruments.length === 0) return 0;

  const prices = await prisma.price.findMany({
    where: { instrumentId: { in: instruments.map((instrument) => instrument.id) } },
    select: { instrumentId: true, fetchedAt: true, priceCents: true },
  });
  const byInstrument = new Map<string, { fetchedAt: Date; priceCents: number }[]>();
  for (const price of prices) {
    const list = byInstrument.get(price.instrumentId) ?? [];
    list.push({ fetchedAt: price.fetchedAt, priceCents: price.priceCents });
    byInstrument.set(price.instrumentId, list);
  }

  const now = new Date();
  let written = 0;
  for (const instrument of instruments) {
    const known = byInstrument.get(instrument.id) ?? [];
    const fresh = known.some((price) => !isStale(price.fetchedAt, now));
    if (!options.force && fresh) continue;

    const priceCents = await fetchQuoteCents(instrument.symbol, instrument.priceSymbol, instrument.isin);
    if (priceCents === null) continue;
    await prisma.price.create({
      data: { instrumentId: instrument.id, priceCents, source: "YAHOO", fetchedAt: new Date() },
    });
    written += 1;
  }
  return written;
}
