import { describe, expect, it } from "vitest";
import { holdingsValueByAccount, type AccountTrade } from "@/lib/portfolio/trades";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const trade = (over: Partial<AccountTrade>): AccountTrade => ({
  id: "t",
  accountId: "acc-1",
  instrumentId: "iwda",
  side: "BUY",
  tradedAt: day("2026-01-01"),
  quantityMicro: 10_000_000,
  priceCents: 10_000,
  feeCents: 0,
  ...over,
});

describe("holdingsValueByAccount", () => {
  it("falls back to the average cost when an instrument has no price", () => {
    const value = holdingsValueByAccount([trade({})], new Map());
    expect(value.get("acc-1")).toBe(100_000);
  });

  it("prices open positions with the newest price per instrument", () => {
    const value = holdingsValueByAccount([trade({})], new Map([["iwda", 12_000]]));
    expect(value.get("acc-1")).toBe(120_000);
  });

  it("counts the fee in the cost, and drops a sold-out position", () => {
    const trades = [
      trade({ id: "buy", tradedAt: day("2026-01-01"), feeCents: 500 }),
      trade({ id: "sell", side: "SELL", tradedAt: day("2026-02-01"), priceCents: 12_000 }),
    ];
    // Nothing open: the account contributes zero, not a stale value.
    expect(holdingsValueByAccount(trades, new Map([["iwda", 12_000]])).get("acc-1")).toBe(0);
    // Still holding half of it, priced at the market.
    const half = [...trades];
    half[1] = { ...half[1], quantityMicro: 5_000_000 };
    expect(holdingsValueByAccount(half, new Map([["iwda", 12_000]])).get("acc-1")).toBe(60_000);
  });

  it("keeps accounts apart", () => {
    const value = holdingsValueByAccount(
      [trade({}), trade({ id: "b", accountId: "acc-2", quantityMicro: 5_000_000 })],
      new Map(),
    );
    expect(value.get("acc-1")).toBe(100_000);
    expect(value.get("acc-2")).toBe(50_000);
  });
});
