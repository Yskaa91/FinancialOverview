import { beforeEach, describe, expect, it, vi } from "vitest";

const { accountFindMany, transactionFindMany, tradeFindMany, priceFindMany } = vi.hoisted(() => ({
  accountFindMany: vi.fn(),
  transactionFindMany: vi.fn(),
  tradeFindMany: vi.fn(),
  priceFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    account: { findMany: accountFindMany },
    transaction: { findMany: transactionFindMany },
    trade: { findMany: tradeFindMany },
    price: { findMany: priceFindMany },
  },
}));

import { accountBalancesAt } from "@/lib/queries/history";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * The balance at a period end is what the account was worth *just before* the
 * next period starts, so a row booked on the first day of the next period must
 * not count. That boundary is the whole risk in this query.
 */
describe("accountBalancesAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountFindMany.mockResolvedValue([
      { id: "checking", name: "Checking", type: "CHECKING", openingBalanceCents: 100_00 },
      { id: "card", name: "Card", type: "CREDIT_CARD", openingBalanceCents: 0 },
      { id: "broker", name: "Broker", type: "BROKER", openingBalanceCents: 5_000 },
    ]);
    // The mock honours the bound the query asks for, so a wrong comparison in the
    // caller shows up as a wrong number here.
    const rows = [
      { accountId: "checking", bookedAt: day("2026-11-30"), amountCents: -25_00 },
      { accountId: "checking", bookedAt: day("2026-12-01"), amountCents: -999_00 },
      { accountId: "card", bookedAt: day("2026-11-15"), amountCents: -40_00 },
      { accountId: "broker", bookedAt: day("2026-11-10"), amountCents: 1_000 },
    ];
    transactionFindMany.mockImplementation(
      async (args: { where: { bookedAt: { lt?: Date; lte?: Date } } }) => {
        const bound = args.where.bookedAt;
        return bound.lt ? rows.filter((row) => row.bookedAt < bound.lt!) : rows;
      },
    );
    tradeFindMany.mockResolvedValue([]);
    priceFindMany.mockResolvedValue([]);
  });

  it("sums opening balance and movements before the period end", async () => {
    const balances = await accountBalancesAt(day("2026-12-01"));
    const byName = new Map(balances.map((row) => [row.name, row.cents]));

    expect(byName.get("Checking")).toBe(100_00 - 25_00);
    expect(byName.get("Card")).toBe(-40_00);
    expect(byName.get("Broker")).toBe(5_000 + 1_000);
  });

  it("asks the database for the strict bound, not an inclusive one", async () => {
    await accountBalancesAt(day("2026-12-01"));
    expect(transactionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bookedAt: { lt: day("2026-12-01") } } }),
    );
  });
});
