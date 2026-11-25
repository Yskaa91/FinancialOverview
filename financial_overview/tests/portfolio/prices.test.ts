import { describe, expect, it } from "vitest";
import {
  PRICE_TTL_MS,
  isStale,
  latestPriceCents,
  looksLikeIsin,
  parseYahooCloseCents,
  parseYahooSearchSymbol,
  quoteTickers,
} from "@/lib/portfolio/prices";

describe("latestPriceCents", () => {
  it("returns null when there is no price yet", () => {
    expect(latestPriceCents([])).toBeNull();
  });

  it("picks the newest fetchedAt, not the order it arrived in", () => {
    const prices = [
      { fetchedAt: new Date("2026-01-02T00:00:00Z"), priceCents: 1200 },
      { fetchedAt: new Date("2026-01-03T00:00:00Z"), priceCents: 1300 },
      { fetchedAt: new Date("2026-01-01T00:00:00Z"), priceCents: 1100 },
    ];

    expect(latestPriceCents(prices)).toBe(1300);
  });

  it("keeps a real zero price instead of treating it as missing", () => {
    expect(latestPriceCents([{ fetchedAt: new Date("2026-01-02T00:00:00Z"), priceCents: 0 }])).toBe(0);
  });
});

describe("isStale", () => {
  const now = new Date("2026-01-02T12:00:00Z");
  const before = (ms: number) => new Date(now.getTime() - ms);

  it("is twelve hours", () => {
    expect(PRICE_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("treats a missing price as stale", () => {
    expect(isStale(null, now)).toBe(true);
  });

  it("is fresh within the ttl", () => {
    expect(isStale(before(60_000), now)).toBe(false);
    expect(isStale(before(PRICE_TTL_MS - 1), now)).toBe(false);
  });

  it("is stale at and past the ttl", () => {
    expect(isStale(before(PRICE_TTL_MS), now)).toBe(true);
    expect(isStale(before(PRICE_TTL_MS + 1), now)).toBe(true);
  });
});

describe("quoteTickers", () => {
  it("tries the configured ticker first, then the usual EU venues", () => {
    expect(quoteTickers("vwce", null)).toEqual(["VWCE.AS", "VWCE.DE", "VWCE"]);
    expect(quoteTickers("vwce", "vwce.de")).toEqual(["vwce.de", "VWCE.AS", "VWCE.DE", "VWCE"]);
  });

  it("leaves a symbol that already names its venue alone", () => {
    expect(quoteTickers("ASML.AS", null)).toEqual(["ASML.AS"]);
    expect(quoteTickers("", null)).toEqual([]);
  });
});

describe("parseYahooCloseCents", () => {
  it("prefers the market price and keeps it as cents", () => {
    expect(parseYahooCloseCents({ chart: { result: [{ meta: { regularMarketPrice: 128.44 } }] } })).toBe(12844);
  });

  it("falls back to the newest non-null close", () => {
    const payload = {
      chart: { result: [{ meta: {}, indicators: { quote: [{ close: [127.1, null, 129.9] }] } }] },
    };
    expect(parseYahooCloseCents(payload)).toBe(12990);
  });

  it("returns null for junk, so no price row is written", () => {
    expect(parseYahooCloseCents(null)).toBeNull();
    expect(parseYahooCloseCents({ chart: { result: [] } })).toBeNull();
    expect(parseYahooCloseCents({ chart: { result: [{ meta: { regularMarketPrice: 0 } }] } })).toBeNull();
  });
});

describe("looksLikeIsin", () => {
  it("accepts a real ISIN in any case", () => {
    expect(looksLikeIsin("IE00BD4TXV59")).toBe(true);
    expect(looksLikeIsin(" ie00bd4txv59 ")).toBe(true);
    expect(looksLikeIsin("NL0000009165")).toBe(true);
  });

  it("rejects tickers, dates and near misses", () => {
    expect(looksLikeIsin("VWCE")).toBe(false);
    expect(looksLikeIsin("VWCE.DE")).toBe(false);
    expect(looksLikeIsin("IE00BD4TXV5")).toBe(false);
    expect(looksLikeIsin("IE00BD4TXV591")).toBe(false);
    expect(looksLikeIsin("1E00BD4TXV59")).toBe(false);
    expect(looksLikeIsin("")).toBe(false);
  });
});

describe("parseYahooSearchSymbol", () => {
  it("takes the first listing Yahoo ranks", () => {
    const payload = {
      quotes: [
        { symbol: "UETW.DE", quoteType: "ETF" },
        { symbol: "IE00BD4TXV59.SG", quoteType: "MUTUALFUND" },
      ],
    };
    expect(parseYahooSearchSymbol(payload)).toBe("UETW.DE");
  });

  it("returns null when nothing names a symbol", () => {
    expect(parseYahooSearchSymbol({ quotes: [] })).toBeNull();
    expect(parseYahooSearchSymbol({ quotes: [{ symbol: "  " }] })).toBeNull();
    expect(parseYahooSearchSymbol(null)).toBeNull();
  });
});
