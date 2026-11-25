import { describe, expect, it } from "vitest";
import {
  fifo,
  positionValueCents,
  unrealizedCents,
  type TradeInput,
} from "@/lib/portfolio/trades";

// Quantities are micro-units, so 10 units is 10_000_000. Every expected number
// below is written out in cents by hand; if a rule changes, one of these fails.
function t(
  side: "BUY" | "SELL",
  day: number,
  quantityMicro: number,
  priceCents: number,
  feeCents = 0,
): TradeInput {
  return {
    id: `${side}-${day}-${quantityMicro}`,
    side,
    tradedAt: new Date(Date.UTC(2026, 0, day)),
    quantityMicro,
    priceCents,
    feeCents,
  };
}

function one(instrumentId: string, trades: TradeInput[]) {
  return fifo(new Map([[instrumentId, trades]]));
}

describe("fifo", () => {
  it("adds a buy as a lot with the fee inside the cost basis", () => {
    const result = one("VWCE", [t("BUY", 1, 10_000_000, 10000, 100)]);
    const position = result.positions.get("VWCE");

    expect(position?.quantityMicro).toBe(10_000_000);
    expect(position?.costBasisCents).toBe(100_100); // 10 x 100,00 + 1,00 fee
    expect(position?.averageCostCents).toBe(10010);
    expect(position?.lots).toEqual([
      { tradedAt: new Date(Date.UTC(2026, 0, 1)), quantityMicro: 10_000_000, priceCents: 10000 },
    ]);
    expect(result.realizedCents).toBe(0);
    expect(result.oversold).toEqual([]);
  });

  it("keeps the unsold part of a lot after a partial sell", () => {
    const result = one("VWCE", [
      t("BUY", 1, 10_000_000, 10000, 100),
      t("SELL", 5, 4_000_000, 12000, 50),
    ]);
    const position = result.positions.get("VWCE")!;

    // Proceeds 4 x 120,00 - 0,50 fee, cost 4/10 of 1.001,00.
    expect(result.realizedCents).toBe(48000 - 50 - 40040);
    expect(position.quantityMicro).toBe(6_000_000);
    expect(position.costBasisCents).toBe(60_060);
    expect(position.averageCostCents).toBe(10010); // unchanged: the fee is spread per unit
    expect(position.lots).toHaveLength(1);
    expect(position.lots[0].quantityMicro).toBe(6_000_000);
  });

  it("consumes the oldest lot first when a sell spans two lots", () => {
    const result = one("VWCE", [
      t("BUY", 3, 10_000_000, 12000),
      t("BUY", 1, 10_000_000, 10000), // listed later on purpose: dates decide
      t("SELL", 5, 15_000_000, 15000),
    ]);
    const position = result.positions.get("VWCE")!;

    // 10 units of the cheap lot plus 5 of the expensive one.
    expect(result.realizedCents).toBe(15 * 15000 - (10 * 10000 + 5 * 12000));
    expect(position.quantityMicro).toBe(5_000_000);
    expect(position.costBasisCents).toBe(60_000);
    expect(position.averageCostCents).toBe(12000);
    expect(position.lots).toEqual([
      { tradedAt: new Date(Date.UTC(2026, 0, 3)), quantityMicro: 5_000_000, priceCents: 12000 },
    ]);
  });

  it("closes the position at zero when everything is sold", () => {
    const result = one("VWCE", [
      t("BUY", 1, 10_000_000, 10000, 100),
      t("SELL", 5, 10_000_000, 11000, 100),
    ]);
    const position = result.positions.get("VWCE")!;

    expect(result.realizedCents).toBe(110_000 - 100 - 100_100); // 9.800
    expect(position.quantityMicro).toBe(0);
    expect(position.costBasisCents).toBe(0);
    expect(position.averageCostCents).toBe(0);
    expect(position.lots).toEqual([]);
  });

  it("adds up realized profit and loss across two sells", () => {
    const result = one("VWCE", [
      t("BUY", 1, 10_000_000, 10000),
      t("SELL", 2, 3_000_000, 11000), // +30,00
      t("SELL", 4, 4_000_000, 9000), // -40,00
    ]);
    const position = result.positions.get("VWCE")!;

    expect(result.realizedCents).toBe(3000 - 4000);
    expect(position.quantityMicro).toBe(3_000_000);
    expect(position.costBasisCents).toBe(30_000);
  });

  it("clamps an oversell at zero and reports the gap", () => {
    const result = one("VWCE", [t("BUY", 1, 5_000_000, 10000), t("SELL", 5, 8_000_000, 12000, 100)]);
    const position = result.positions.get("VWCE")!;

    // Only the 5 units actually held are matched; the fee was paid regardless.
    expect(result.realizedCents).toBe(60000 - 100 - 50_000);
    expect(position.quantityMicro).toBe(0);
    expect(position.costBasisCents).toBe(0);
    expect(result.oversold).toEqual([{ instrumentId: "VWCE", quantityMicro: 3_000_000 }]);
  });

  it("reports an oversell against an empty position", () => {
    const result = one("VWCE", [t("SELL", 1, 2_000_000, 10000)]);

    expect(result.positions.get("VWCE")?.quantityMicro).toBe(0);
    expect(result.realizedCents).toBe(0);
    expect(result.oversold).toEqual([{ instrumentId: "VWCE", quantityMicro: 2_000_000 }]);
  });

  it("ignores zero-quantity trades", () => {
    const result = one("VWCE", [
      t("BUY", 1, 0, 10000, 500),
      t("BUY", 2, 10_000_000, 10000),
      t("SELL", 3, 0, 12000, 500),
    ]);
    const position = result.positions.get("VWCE")!;

    expect(position.quantityMicro).toBe(10_000_000);
    expect(position.costBasisCents).toBe(100_000); // the empty trade carried no units for its fee
    expect(result.realizedCents).toBe(0);
    expect(result.oversold).toEqual([]);
  });

  it("keeps instruments apart", () => {
    const result = fifo(
      new Map([
        ["VWCE", [t("BUY", 1, 10_000_000, 10000)]],
        ["AGGH", [t("BUY", 1, 5_000_000, 20000), t("SELL", 2, 5_000_000, 25000)]],
      ]),
    );

    expect(result.positions.get("VWCE")?.quantityMicro).toBe(10_000_000);
    expect(result.positions.get("VWCE")?.costBasisCents).toBe(100_000);
    expect(result.positions.get("AGGH")?.quantityMicro).toBe(0);
    expect(result.realizedCents).toBe(125_000 - 100_000);
  });

  it("returns nothing for an empty trade map", () => {
    expect(fifo(new Map())).toEqual({ positions: new Map(), realizedCents: 0, oversold: [] });
  });
});

describe("valuation", () => {
  const position = one("VWCE", [t("BUY", 1, 10_000_000, 10000, 100)]).positions.get("VWCE")!;

  it("values the open quantity at the given price", () => {
    expect(positionValueCents(position, 12000)).toBe(120_000);
    expect(positionValueCents(position, 0)).toBe(0);
  });

  it("subtracts the open cost basis for unrealized P/L", () => {
    expect(unrealizedCents(position, 12000)).toBe(120_000 - 100_100);
    expect(unrealizedCents(position, 9000)).toBe(-10_100);
  });
});
