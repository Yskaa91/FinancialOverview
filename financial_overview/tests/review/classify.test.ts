import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyPreview, groupRows, loadCategoryOptions, type PreviewInputRow } from "@/lib/review/classify";
import type { ReviewGroup } from "@/lib/review/types";

const { ruleFindMany, merchantFindMany, txnFindMany, categoryFindMany, categoryFindFirst, accountFindMany } =
  vi.hoisted(() => ({
    ruleFindMany: vi.fn(),
    merchantFindMany: vi.fn(),
    txnFindMany: vi.fn(),
    categoryFindMany: vi.fn(),
    categoryFindFirst: vi.fn(),
    accountFindMany: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    rule: { findMany: ruleFindMany },
    merchantMap: { findMany: merchantFindMany },
    transaction: { findMany: txnFindMany },
    category: { findMany: categoryFindMany, findFirst: categoryFindFirst },
    account: { findMany: accountFindMany },
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
  categoryFindFirst.mockResolvedValue(null); // no Transfers category: detection off
  accountFindMany.mockResolvedValue([]);
});

describe("groupRows", () => {
  it("groups identical merchants and keeps the row indexes", () => {
    const groups = groupRows(rows);

    expect(groups.map((group) => group.key)).toEqual(["LIDL", "FLORIST JANSEN"]);
    const lidl = groups[0];
    expect(lidl.rows.map((row) => row.index)).toEqual([1, 0]);
    expect(lidl.rows[0].bookedAt).toBe("2026-03-09");
    expect(lidl.totalCents).toBe(-2500);
    expect(lidl.label).toBe("LIDL");
  });

  it("orders a group's rows newest first, whatever order the file had", () => {
    const groups = groupRows([
      { bookedAt: "2026-01-05", amountCents: -1000, description: "NETFLIX", merchant: "NETFLIX" },
      { bookedAt: "2026-03-05", amountCents: -1000, description: "NETFLIX", merchant: "NETFLIX" },
      { bookedAt: "2026-02-05", amountCents: -1000, description: "NETFLIX", merchant: "NETFLIX" },
    ]);
    expect(groups[0].rows.map((row) => row.bookedAt)).toEqual(["2026-03-05", "2026-02-05", "2026-01-05"]);
    // The indexes still point at the original rows, so edits map back.
    expect(groups[0].rows.map((row) => row.index)).toEqual([1, 2, 0]);
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

  it("matches a COUNTERPARTY rule, not just MERCHANT ones", async () => {
    ruleFindMany.mockResolvedValue([
      { ...lidlRule, id: "r3", name: "Payroll", matchOn: "COUNTERPARTY", pattern: "ACME", categoryId: "cat-salary" },
    ]);

    const groups = await classifyPreview([
      {
        bookedAt: "2026-03-25",
        amountCents: 385000,
        description: "SEPA Overboeking Loon",
        merchant: "ACME BV",
        counterparty: "ACME BV",
        counterpartyIban: "NL02RABO0987654321",
      },
    ]);

    expect(groups[0].match).toEqual({ ruleId: "r3", ruleName: "Payroll", categoryId: "cat-salary" });
  });

  it("keeps the counterparty on the group so rules can still see it", () => {
    const groups = groupRows([
      {
        bookedAt: "2026-03-25",
        amountCents: 385000,
        description: "SEPA Overboeking Loon",
        merchant: "ACME BV",
        counterparty: "ACME BV",
        counterpartyIban: "NL02RABO0987654321",
      },
    ]);
    expect(groups[0].sources[0].counterparty).toBe("ACME BV");
    expect(groups[0].sources[0].counterpartyIban).toBe("NL02RABO0987654321");
  });

  it("orders groups by their newest booking date, descending", async () => {
    ruleFindMany.mockResolvedValue([{ ...lidlRule, pattern: "BAKERY", categoryId: "cat-bread" }]);

    const groups = await classifyPreview([
      { bookedAt: "2026-03-02", amountCents: -100, description: "BAKERY", merchant: "BAKERY" },
      { bookedAt: "2026-03-03", amountCents: -5000, description: "FLORIST", merchant: "FLORIST" },
      { bookedAt: "2026-03-04", amountCents: -200, description: "SHELL", merchant: "SHELL" },
    ]);

    expect(groups.map((group) => group.key)).toEqual(["SHELL", "FLORIST", "BAKERY"]);
    // A rule match no longer reorders the table: it only fills the category.
    expect(groups[2].match).not.toBeNull();
  });
});

describe("classifyPreview transfers", () => {
  const ownAccounts = [
    { id: "a1", name: "ASN Checking", iban: "NL91ABNA0417164300" },
    { id: "a2", name: "PayPal", iban: null },
  ];

  it("matches an account transfer to the Transfers category", async () => {
    accountFindMany.mockResolvedValue(ownAccounts);
    categoryFindFirst.mockResolvedValue({ id: "cat-transfers" });

    const groups = await classifyPreview(
      [
        {
          bookedAt: "2026-03-02",
          amountCents: 5000,
          description: "Van PayPal",
          merchant: "PAYPAL",
          counterpartyIban: "NL91ABNA0417164300",
        },
      ],
      undefined,
      "a2",
    );

    expect(groups[0].match).toEqual({
      ruleId: "",
      ruleName: "Account transfer",
      categoryId: "cat-transfers",
    });
  });

  it("beats a rule, because a transfer must never land in a spending category", async () => {
    accountFindMany.mockResolvedValue(ownAccounts);
    categoryFindFirst.mockResolvedValue({ id: "cat-transfers" });
    ruleFindMany.mockResolvedValue([{ ...lidlRule, pattern: "PAYPAL", categoryId: "cat-shopping" }]);

    const groups = await classifyPreview(
      [{ bookedAt: "2026-03-02", amountCents: 5000, description: "Van PayPal", merchant: "PAYPAL" }],
      undefined,
      "a1",
    );

    expect(groups[0].match?.categoryId).toBe("cat-transfers");
  });

  it("leaves the row unmatched when the Transfers category does not exist", async () => {
    accountFindMany.mockResolvedValue(ownAccounts);
    categoryFindFirst.mockResolvedValue(null);

    const groups = await classifyPreview(
      [
        {
          bookedAt: "2026-03-02",
          amountCents: 5000,
          description: "Van PayPal",
          merchant: "PAYPAL",
          counterpartyIban: "NL91ABNA0417164300",
        },
      ],
      undefined,
      "a2",
    );

    expect(groups[0].match).toBeNull();
  });

  it("does not treat an ordinary shop as a transfer", async () => {
    accountFindMany.mockResolvedValue(ownAccounts);
    categoryFindFirst.mockResolvedValue({ id: "cat-transfers" });

    const groups = await classifyPreview(rows, undefined, "a1");
    expect(groups.every((group) => group.match === null)).toBe(true);
  });
});

describe("loadCategoryOptions", () => {
  it("maps rows to the dialog's shape", async () => {
    categoryFindMany.mockResolvedValue([{ id: "c1", name: "Groceries", kind: "EXPENSE" }]);
    await expect(loadCategoryOptions()).resolves.toEqual([{ id: "c1", name: "Groceries", kind: "EXPENSE" }]);
  });
});
