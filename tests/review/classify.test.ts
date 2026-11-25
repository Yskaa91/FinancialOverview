import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyPreview, groupRows, loadCategoryOptions, type PreviewInputRow } from "@/lib/review/classify";
import type { ReviewGroup } from "@/lib/review/types";

const { ruleFindMany, merchantFindMany, txnFindMany, categoryFindMany } = vi.hoisted(() => ({
  ruleFindMany: vi.fn(),
  merchantFindMany: vi.fn(),
  txnFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    rule: { findMany: ruleFindMany },
    merchantMap: { findMany: merchantFindMany },
    transaction: { findMany: txnFindMany },
    category: { findMany: categoryFindMany },
  },
}));

const lidlRule = {
  id: "r1",
  name: "Lidl groceries",
  matchOn: "MERCHANT" as const,
  operator: "CONTAINS" as const,
  pattern: "LIDL",
  accountId: null,
  amountMinCents: null,
  amountMaxCents: null,
  categoryId: "cat-groceries",
  priority: 100,
  enabled: true,
};

const rows: PreviewInputRow[] = [
  { bookedAt: "2026-03-02", amountCents: -1250, description: "LIDL 1234 AMSTERDAM", merchant: "LIDL" },
  { bookedAt: "2026-03-09", amountCents: -1250, description: "LIDL 5678 AMSTERDAM", merchant: "LIDL" },
  { bookedAt: "2026-03-10", amountCents: -999, description: "FLORIST JANSEN", merchant: "FLORIST JANSEN" },
];

beforeEach(() => {
  vi.clearAllMocks();
  ruleFindMany.mockResolvedValue([]);
  merchantFindMany.mockResolvedValue([]);
  txnFindMany.mockResolvedValue([]);
  categoryFindMany.mockResolvedValue([]);
});

describe("groupRows", () => {
  it("groups identical merchants and keeps the row indexes", () => {
    const groups = groupRows(rows);

    expect(groups.map((group) => group.key)).toEqual(["LIDL", "FLORIST JANSEN"]);
    const lidl = groups[0];
    expect(lidl.rows.map((row) => row.index)).toEqual([0, 1]);
    expect(lidl.rows[0].bookedAt).toBe("2026-03-02");
    expect(lidl.totalCents).toBe(-2500);
    expect(lidl.label).toBe("LIDL");
  });

  it("sends the dominant amount, not the sum of the group", () => {
    const groups = groupRows([
      { bookedAt: "2026-03-02", amountCents: -1000, description: "NETFLIX", merchant: "NETFLIX" },
      { bookedAt: "2026-03-03", amountCents: -1099, description: "NETFLIX", merchant: "NETFLIX" },
      { bookedAt: "2026-03-04", amountCents: -1000, description: "NETFLIX", merchant: "NETFLIX" },
    ]);
    expect(groups[0].amountCents).toBe(-1000);
    expect(groups[0].totalCents).toBe(-3099);
  });

  it("is pure: no database call", () => {
    groupRows(rows);
    expect(txnFindMany).not.toHaveBeenCalled();
    expect(ruleFindMany).not.toHaveBeenCalled();
  });
});

describe("classifyPreview", () => {
  it("propagates the rule match of a group's rows", async () => {
    ruleFindMany.mockResolvedValue([lidlRule]);

    const groups = await classifyPreview(rows);
    const lidl = groups.find((group) => group.key === "LIDL");

    expect(lidl?.match).toEqual({
      ruleId: "r1",
      ruleName: "Lidl groceries",
      categoryId: "cat-groceries",
    });
    expect(groups.find((group) => group.key === "FLORIST JANSEN")?.match).toBeNull();
  });

  it("names merchant memory when no rule answered", async () => {
    merchantFindMany.mockResolvedValue([{ merchantKey: "LIDL", categoryId: "cat-groceries" }]);

    const groups = await classifyPreview(rows);
    expect(groups.find((group) => group.key === "LIDL")?.match).toEqual({
      ruleId: "",
      ruleName: "Merchant memory",
      categoryId: "cat-groceries",
    });
  });

  it("leaves the match empty when the rows of one group disagree", async () => {
    ruleFindMany.mockResolvedValue([
      { ...lidlRule, id: "r2", name: "Small amounts", amountMaxCents: 1200, categoryId: "cat-snacks" },
    ]);

    const groups = await classifyPreview([
      { bookedAt: "2026-03-02", amountCents: -1250, description: "LIDL 1", merchant: "LIDL" },
      { bookedAt: "2026-03-03", amountCents: -500, description: "LIDL 2", merchant: "LIDL" },
    ]);
    expect(groups[0].match).toBeNull();
  });

  it("derives the recurring flag from history plus the batch", async () => {
    txnFindMany.mockResolvedValue([
      { merchant: "LIDL", description: "LIDL 1", bookedAt: new Date("2026-01-05T00:00:00Z") },
    ]);

    const groups = await classifyPreview(rows);
    const lidl = groups.find((group) => group.key === "LIDL");
    expect(lidl?.historyHits).toBe(1);
    expect(lidl?.recurring).toBe(true); // 1 in the database + 2 in this batch

    const florist = groups.find((group) => group.key === "FLORIST JANSEN");
    expect(florist?.historyHits).toBe(0);
    expect(florist?.recurring).toBe(false); // visited once a year: a category, no rule
  });

  it("preserves earlier proposals by key and leaves new groups alone", async () => {
    const previous: ReviewGroup[] = [
      {
        key: "LIDL",
        label: "LIDL",
        rows: [],
        totalCents: 0,
        historyHits: 0,
        recurring: false,
        match: null,
        proposedCategoryId: "cat-groceries",
        proposal: "SUGGESTED",
      },
    ];

    const groups = await classifyPreview(rows, previous);
    expect(groups.find((group) => group.key === "LIDL")?.proposedCategoryId).toBe("cat-groceries");
    expect(groups.find((group) => group.key === "LIDL")?.proposal).toBe("SUGGESTED");
    expect(groups.find((group) => group.key === "FLORIST JANSEN")?.proposedCategoryId).toBeNull();
    expect(groups.find((group) => group.key === "FLORIST JANSEN")?.proposal).toBe("NONE");
  });

  it("orders unmatched groups first, then by absolute total", async () => {
    ruleFindMany.mockResolvedValue([{ ...lidlRule, pattern: "BAKERY", categoryId: "cat-bread" }]);

    const groups = await classifyPreview([
      { bookedAt: "2026-03-02", amountCents: -100, description: "BAKERY", merchant: "BAKERY" },
      { bookedAt: "2026-03-03", amountCents: -5000, description: "FLORIST", merchant: "FLORIST" },
      { bookedAt: "2026-03-04", amountCents: -200, description: "SHELL", merchant: "SHELL" },
    ]);

    expect(groups.map((group) => group.key)).toEqual(["FLORIST", "SHELL", "BAKERY"]);
    expect(groups[2].match).not.toBeNull();
  });
});

describe("loadCategoryOptions", () => {
  it("maps rows to the dialog's shape", async () => {
    categoryFindMany.mockResolvedValue([{ id: "c1", name: "Groceries", kind: "EXPENSE" }]);
    await expect(loadCategoryOptions()).resolves.toEqual([{ id: "c1", name: "Groceries", kind: "EXPENSE" }]);
  });
});
