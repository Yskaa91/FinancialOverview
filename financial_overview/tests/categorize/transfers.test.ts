import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRANSFER_CATEGORY_NAME,
  ensureTransfersCategory,
  findTransfersCategoryId,
  isAccountTransfer,
  loadOwnAccounts,
  type OwnAccount,
} from "@/lib/categorize/transfers";

const { categoryFindFirst, categoryCreate, accountFindMany } = vi.hoisted(() => ({
  categoryFindFirst: vi.fn(),
  categoryCreate: vi.fn(),
  accountFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    category: { findFirst: categoryFindFirst, create: categoryCreate },
    account: { findMany: accountFindMany },
  },
}));

const own: OwnAccount[] = [
  { id: "a1", name: "ASN Checking", iban: "NL91ABNA0417164300" },
  { id: "a2", name: "PayPal", iban: null },
  { id: "a3", name: "ICS Credit Card", iban: "****4321" },
];

beforeEach(() => {
  vi.clearAllMocks();
  categoryFindFirst.mockResolvedValue(null);
  categoryCreate.mockResolvedValue({ id: "cat-transfers" });
  accountFindMany.mockResolvedValue([]);
});

describe("isAccountTransfer", () => {
  it("sees an own IBAN in the counterparty field", () => {
    const hit = isAccountTransfer(
      { accountId: "a2", description: "Naar rekening", counterpartyIban: "NL91 ABNA 0417 1643 00" },
      own,
    );
    expect(hit).toEqual({ transfer: true, reason: "own-iban-counterparty" });
  });

  it("sees another account's name next to a movement word", () => {
    expect(isAccountTransfer({ accountId: "a1", description: "Van PayPal" }, own)).toEqual({
      transfer: true,
      reason: "own-account-name",
    });
    expect(isAccountTransfer({ accountId: "a1", description: "Naar ASN Savings" }, own)).toBeNull();
  });

  it("sees an own IBAN inside the description", () => {
    expect(
      isAccountTransfer({ accountId: "a2", description: "Overboeking NL91ABNA0417164300 J D OEVER" }, own),
    ).toEqual({ transfer: true, reason: "own-iban-description" });
  });

  it("matches a masked card number by suffix", () => {
    expect(isAccountTransfer({ accountId: "a1", description: "Betaling kaart ****4321" }, own)).toEqual({
      transfer: true,
      reason: "own-iban-description",
    });
    expect(isAccountTransfer({ accountId: "a1", description: "Betaling kaart ****9999" }, own)).toBeNull();
  });

  it("never matches the row's own account", () => {
    expect(isAccountTransfer({ accountId: "a1", description: "Naar ASN Checking" }, own)).toBeNull();
    expect(
      isAccountTransfer({ accountId: "a1", description: "iets", counterpartyIban: "NL91ABNA0417164300" }, own),
    ).toBeNull();
  });

  it("does not guess from bank wording alone", () => {
    expect(isAccountTransfer({ accountId: "a1", description: "SEPA Overboeking Loon" }, own)).toBeNull();
    expect(isAccountTransfer({ accountId: "a1", description: "ALBERT HEIJN 1234" }, own)).toBeNull();
  });

  it("treats a card settlement line as a transfer", () => {
    expect(isAccountTransfer({ accountId: "a1", description: "GEINCASSEERD VORIG SALDO" }, own)).toEqual({
      transfer: true,
      reason: "card-settlement",
    });
    expect(isAccountTransfer({ accountId: "a1", description: "GEINCASSEERD 12,50" }, own)).toEqual({
      transfer: true,
      reason: "card-settlement",
    });
  });

  it("does nothing without accounts to compare against", () => {
    expect(isAccountTransfer({ accountId: "a1", description: "Van PayPal NL91ABNA0417164300" }, [])).toBeNull();
  });
});

describe("transfers category", () => {
  it("looks the category up without creating it", async () => {
    categoryFindFirst.mockResolvedValue({ id: "cat-transfers" });
    await expect(findTransfersCategoryId()).resolves.toBe("cat-transfers");
    expect(categoryCreate).not.toHaveBeenCalled();
  });

  it("reports a missing category as null", async () => {
    await expect(findTransfersCategoryId()).resolves.toBeNull();
  });

  it("creates the system category once", async () => {
    await expect(ensureTransfersCategory()).resolves.toBe("cat-transfers");
    expect(categoryCreate).toHaveBeenCalledWith({
      data: { name: TRANSFER_CATEGORY_NAME, kind: "TRANSFER", isSystem: true },
      select: { id: true },
    });
  });

  it("reuses an existing category", async () => {
    categoryFindFirst.mockResolvedValue({ id: "existing" });
    await expect(ensureTransfersCategory()).resolves.toBe("existing");
    expect(categoryCreate).not.toHaveBeenCalled();
  });
});

describe("loadOwnAccounts", () => {
  it("returns id, name and iban", async () => {
    accountFindMany.mockResolvedValue([{ id: "a1", name: "ASN Checking", iban: "NL91ABNA0417164300" }]);
    await expect(loadOwnAccounts()).resolves.toEqual([
      { id: "a1", name: "ASN Checking", iban: "NL91ABNA0417164300" },
    ]);
  });
});
