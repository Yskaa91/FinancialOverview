import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  accountFindMany,
  categoryFindFirst,
  transactionFindMany,
  transactionUpdateMany,
  transferLinkCreate,
  transferLinkFindUnique,
  transferLinkDelete,
  runTransaction,
} = vi.hoisted(() => {
  const transactionUpdateMany = vi.fn(async () => ({ count: 1 }));
  const transferLinkCreate = vi.fn(async () => ({ id: "link-1" }));
  return {
    accountFindMany: vi.fn(),
    categoryFindFirst: vi.fn(),
    transactionFindMany: vi.fn(),
    transactionUpdateMany,
    transferLinkCreate,
    transferLinkFindUnique: vi.fn(),
    transferLinkDelete: vi.fn(async () => ({})),
    runTransaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        transferLink: {
          create: transferLinkCreate,
          delete: transferLinkDelete,
        },
        transaction: { updateMany: transactionUpdateMany },
      }),
    ),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    account: { findMany: accountFindMany },
    category: { findFirst: categoryFindFirst },
    transaction: { findMany: transactionFindMany, updateMany: transactionUpdateMany },
    transferLink: {
      create: transferLinkCreate,
      findUnique: transferLinkFindUnique,
      delete: transferLinkDelete,
    },
    $transaction: runTransaction,
  },
}));

import { linkPair, linkTransfers, pairingAccount, unlinkTransfer } from "@/lib/transfers/link";

const accounts = [
  { id: "acc-asn", name: "ASN Betaalrekening", iban: "NL80SNSB0339881577", institution: "ASN", type: "CHECKING" },
  { id: "acc-paypal", name: "PayPal", iban: null, institution: "PAYPAL", type: "CHECKING" },
];

function tx(overrides: Record<string, unknown>) {
  return {
    id: "tx-1",
    accountId: "acc-asn",
    transferLinkId: null,
    bookedAt: new Date("2026-10-07T00:00:00.000Z"),
    amountCents: -9379,
    currency: "EUR",
    description: "Europese incasso PAYPAL Europe S.a.r.l.",
    counterparty: "PayPal Europe S.a.r.l. et Cie S.C.A",
    counterpartyIban: "LU89751000135104200E",
    merchant: "PAYPAL EUROPE S.A.R.L",
    excludeFromSpending: false,
    categoryId: null,
    categorySource: "NONE",
    ...overrides,
  };
}

const bankLeg = tx({ id: "asn-1" });
const walletLeg = tx({
  id: "pp-1",
  accountId: "acc-paypal",
  amountCents: -9379,
  bookedAt: new Date("2026-10-05T00:00:00.000Z"),
  description: "Express Checkout Payment",
  counterparty: "Servicecenter Windhorn",
  counterpartyIban: null,
  merchant: "SERVICECENTER WINDHORN",
});

beforeEach(() => {
  vi.clearAllMocks();
  accountFindMany.mockResolvedValue(accounts);
  categoryFindFirst.mockResolvedValue({ id: "cat-transfers" });
  transactionFindMany.mockResolvedValue([bankLeg, walletLeg]);
  transactionUpdateMany.mockResolvedValue({ count: 1 });
  transferLinkCreate.mockResolvedValue({ id: "link-1" });
});

describe("pairingAccount", () => {
  it("knows which accounts name the shop and which settle monthly", () => {
    const wallet = pairingAccount({
      id: "acc-paypal",
      name: "PayPal",
      iban: null,
      institution: "PAYPAL",
      type: "CHECKING",
    });
    expect(wallet).toMatchObject({ carriesDetail: true, settlesMonthly: false });
    expect(wallet.hints).toContain("paypal");

    const card = pairingAccount({
      id: "acc-ics",
      name: "ICS Card",
      iban: null,
      institution: "ICS",
      type: "CREDIT_CARD",
    });
    expect(card).toMatchObject({ carriesDetail: true, settlesMonthly: true });

    const bank = pairingAccount(accounts[0]);
    expect(bank).toMatchObject({ carriesDetail: false, settlesMonthly: false });
  });
});

describe("linkTransfers", () => {
  it("links the pair and keeps only the shop-naming leg counted", async () => {
    const result = await linkTransfers();
    expect(result).toEqual({ created: 1 });

    // Only unlinked rows are candidates: this is what makes a re-run a no-op.
    expect(transactionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { transferLinkId: null } }),
    );

    expect(transferLinkCreate).toHaveBeenCalledWith({ data: { kind: "FUNDING", method: "AUTO" } });
    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asn-1", "pp-1"] } },
      data: { transferLinkId: "link-1" },
    });
    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asn-1"] } },
      data: { excludeFromSpending: true },
    });
  });

  it("gives the excluded leg the Transfers category but never over a manual choice", async () => {
    await linkTransfers();
    const calls = transactionUpdateMany.mock.calls as unknown as [
      { data: { categoryId?: string } },
    ][];
    const categoryCall = calls.find((call) => call[0].data.categoryId === "cat-transfers");
    expect(categoryCall?.[0]).toEqual({
      where: { id: { in: ["asn-1"] }, categorySource: { not: "MANUAL" } },
      data: { categoryId: "cat-transfers", categorySource: "RULE", reviewState: "OK" },
    });
  });

  it("does nothing when the rows do not name each other", async () => {
    // Neither row names the other account: the same amount is a coincidence.
    transactionFindMany.mockResolvedValue([
      { ...bankLeg, description: "LIDL 1234 AMSTERDAM", counterparty: null, counterpartyIban: null },
      tx({
        id: "pp-2",
        accountId: "acc-paypal",
        description: "Express Checkout Payment",
        counterparty: "Some other shop",
        counterpartyIban: null,
        merchant: "SOME OTHER SHOP",
      }),
    ]);
    expect(await linkTransfers()).toEqual({ created: 0 });
    expect(transferLinkCreate).not.toHaveBeenCalled();
  });

  it("keeps going when one pair fails to store", async () => {
    transferLinkCreate.mockRejectedValueOnce(new Error("unique constraint"));
    transactionFindMany.mockResolvedValue([
      bankLeg,
      walletLeg,
      tx({ id: "asn-2", amountCents: -4200, description: "PAYPAL Europe" }),
      tx({ id: "pp-2", accountId: "acc-paypal", amountCents: -4200, merchant: "SOMNIA", counterparty: "Somnia" }),
    ]);
    const result = await linkTransfers();
    expect(result.created).toBe(1);
  });

  it("reports nothing when there is nothing to pair", async () => {
    transactionFindMany.mockResolvedValue([bankLeg]);
    expect(await linkTransfers()).toEqual({ created: 0 });
  });
});

describe("linkPair", () => {
  it("links a plausible pair by hand and reports the kind", async () => {
    transactionFindMany.mockResolvedValue([bankLeg, walletLeg]);
    expect(await linkPair("asn-1", "pp-1")).toEqual({ ok: true, kind: "FUNDING" });
  });

  it("refuses the same row twice", async () => {
    expect(await linkPair("asn-1", "asn-1")).toEqual({ ok: false, reason: "same-transaction" });
  });

  it("refuses two rows of one account", async () => {
    transactionFindMany.mockResolvedValue([bankLeg, tx({ id: "asn-9" })]);
    expect(await linkPair("asn-1", "asn-9")).toEqual({ ok: false, reason: "same-account" });
  });

  it("refuses amounts that are not the same money", async () => {
    transactionFindMany.mockResolvedValue([bankLeg, { ...walletLeg, amountCents: -9378 }]);
    expect(await linkPair("asn-1", "pp-1")).toEqual({ ok: false, reason: "amount" });
  });

  it("refuses rows too far apart", async () => {
    transactionFindMany.mockResolvedValue([
      bankLeg,
      { ...walletLeg, bookedAt: new Date("2026-07-01T00:00:00.000Z") },
    ]);
    expect(await linkPair("asn-1", "pp-1")).toEqual({ ok: false, reason: "too-far-apart" });
  });

  it("refuses a row that already belongs to a pair", async () => {
    transactionFindMany.mockResolvedValue([bankLeg, { ...walletLeg, transferLinkId: "link-0" }]);
    expect(await linkPair("asn-1", "pp-1")).toEqual({ ok: false, reason: "already-linked" });
  });
});

describe("unlinkTransfer", () => {
  it("puts both rows back and removes only the category it set itself", async () => {
    transferLinkFindUnique.mockResolvedValue({
      id: "link-1",
      transactions: [
        { id: "asn-1", categoryId: "cat-transfers", categorySource: "RULE" },
        { id: "pp-1", categoryId: "cat-manual", categorySource: "MANUAL" },
      ],
    });

    expect(await unlinkTransfer("link-1")).toEqual({ ok: true });
    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asn-1", "pp-1"] } },
      data: { transferLinkId: null, excludeFromSpending: false },
    });
    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asn-1"] } },
      data: { categoryId: null, categorySource: "NONE", reviewState: "UNCATEGORIZED" },
    });
    expect(transferLinkDelete).toHaveBeenCalledWith({ where: { id: "link-1" } });
  });

  it("says so when the link is already gone", async () => {
    transferLinkFindUnique.mockResolvedValue(null);
    expect(await unlinkTransfer("nope")).toEqual({ ok: false });
  });
});
