import { describe, expect, it } from "vitest";
import { PRICE_TTL_MS, isStale, latestPriceCents } from "@/lib/portfolio/prices";

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
