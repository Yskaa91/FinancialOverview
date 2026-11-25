import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIN_HITS_FOR_RULE,
  dominantAmountCents,
  displayLabel,
  groupLabel,
  isRecurring,
  keyMatchesRow,
  loadMerchantHistory,
  merchantKeyOf,
  redactLabel,
} from "@/lib/categorize/recurrence";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { transaction: { findMany } } }));

describe("merchantKeyOf", () => {
  it("drops digits so one shop is one key", () => {
    expect(merchantKeyOf({ merchant: "ALBERT HEIJN 1234", description: "" })).toBe("ALBERT HEIJN");
    expect(merchantKeyOf({ merchant: "Albert Heijn 9876", description: "" })).toBe("ALBERT HEIJN");
    expect(merchantKeyOf({ merchant: null, description: "LIDL 4411 AMSTERDAM" })).toBe("LIDL AMSTERDAM");
  });

  it("prefers the merchant over the description", () => {
    expect(
      merchantKeyOf({ merchant: "JUMBO", description: "BEA 1234 JUMBO 9876 PASVOLGNR 5" }),
    ).toBe("JUMBO");
  });

  it("strips payment-processor noise", () => {
    expect(merchantKeyOf({ merchant: null, description: "BETAALPASS 1234 TERMINAL 9" })).toBe("TERMINAL");
    expect(merchantKeyOf({ merchant: null, description: "CONTACTLOOS KAARTNR 1234567" })).toBe("UNKNOWN");
    expect(merchantKeyOf({ merchant: null, description: "POS IDEAL 9931" })).toBe("UNKNOWN");
  });

  it("strips IBAN-ish tokens and falls back to the description", () => {
    const key = merchantKeyOf({ merchant: "NL91ABNA0417164300", description: "Jane Doe" });
    expect(key).toBe("JANE DOE");
  });

  it("removes accents and punctuation, collapses whitespace", () => {
    expect(merchantKeyOf({ merchant: "  Café   de Vries!! ", description: "" })).toBe("CAFE DE VRIES");
    expect(merchantKeyOf({ merchant: "H&M", description: "" })).toBe("H M");
  });

  it("is stable for unidentifiable rows", () => {
    expect(merchantKeyOf({ merchant: null, description: "1234 5678" })).toBe("UNKNOWN");
  });
});

describe("groupLabel", () => {
  it("keeps digits, because the statement's own label is what the user picks from", () => {
    expect(groupLabel({ merchant: "LIDL", description: "LIDL 1234" })).toBe("LIDL");
    expect(groupLabel({ merchant: null, description: "Albert Heijn 1234" })).toBe("Albert Heijn 1234");
  });

  it("prefers the other party's name for the UI, falling back to merchant then description", () => {
    expect(displayLabel({ counterparty: "ODIDO NETHERLANDS B.V.", merchant: "EUROPESE INCASSO", description: "Europese incasso: NL-Klant" })).toBe(
      "ODIDO NETHERLANDS B.V.",
    );
    expect(displayLabel({ counterparty: "  ", merchant: "LIDL", description: "LIDL 1234" })).toBe("LIDL");
    expect(displayLabel({ counterparty: null, merchant: null, description: "Albert Heijn 1234" })).toBe("Albert Heijn 1234");
  });

  it("truncates long labels", () => {
    const label = groupLabel({ merchant: null, description: "x".repeat(50) });
    expect(label).toHaveLength(32);
  });

  it("collapses whitespace so the AI line stays one line", () => {
    expect(groupLabel({ merchant: null, description: "  SHELL \n STATION  " })).toBe("SHELL STATION");
  });

  it("redacts account numbers before the label leaves the machine", () => {
    expect(groupLabel({ merchant: null, description: "SEPA NL91ABNA0417164300 J DOE" })).toBe("SEPA [account] J DOE");
  });
});

describe("redactLabel", () => {
  it("replaces an IBAN", () => {
    expect(redactLabel("NL91ABNA0417164300")).toBe("[account]");
    expect(redactLabel("SEPA NL91ABNA0417164300 J DOE")).toBe("SEPA [account] J DOE");
  });

  it("replaces an account number written in four-digit groups", () => {
    expect(redactLabel("NL91 ABNA 0417 1643 00")).toBe("[account]");
    expect(redactLabel("BETALING 0417 1643 0012")).toBe("BETALING [account]");
    // The spaces must be handled before whitespace is collapsed, or "0417 1643 0012"
    // becomes one long number the digit rule would only partly catch.
    expect(redactLabel("0417 1643 0012")).toBe("[account]");
  });

  it("replaces a long card or account number", () => {
    expect(redactLabel("KAART 123456789012")).toBe("KAART [number]");
    expect(redactLabel("PASVOLGNR 123456789")).toBe("PASVOLGNR [number]");
    expect(redactLabel("LIDL 1234")).toBe("LIDL 1234"); // a store number is not a secret
  });

  it("replaces an e-mail address", () => {
    expect(redactLabel("BETALING jan.devries@example.nl")).toBe("BETALING [email]");
  });

  it("keeps a masked card number, which is already masked", () => {
    expect(redactLabel("PRIMARK ****4321")).toBe("PRIMARK ****4321");
  });

  it("collapses whitespace and caps at 32 characters after redaction", () => {
    const label = redactLabel(`  NL91ABNA0417164300   ${"X".repeat(40)}  `);
    expect(label).toHaveLength(32);
    expect(label.startsWith("[account] X")).toBe(true);
    expect(redactLabel("A\n\nB")).toBe("A B");
  });
});

describe("isRecurring", () => {
  it(`needs ${MIN_HITS_FOR_RULE} hits in total`, () => {
    expect(isRecurring(2, 0)).toBe(false);
    expect(isRecurring(0, 2)).toBe(false);
    expect(isRecurring(2, 1)).toBe(true);
    expect(isRecurring(3, 0)).toBe(true);
    expect(isRecurring(0, 3)).toBe(true);
  });

  it("counts history plus the preview batch", () => {
    expect(isRecurring(11, 1)).toBe(true);
    expect(isRecurring(1, 1)).toBe(false);
  });
});

describe("dominantAmountCents", () => {
  it("picks the amount most rows share", () => {
    expect(dominantAmountCents([-500, -1250, -1250, -900])).toBe(-1250);
    expect(dominantAmountCents([-900])).toBe(-900);
    expect(dominantAmountCents([])).toBe(0);
  });
});

describe("keyMatchesRow", () => {
  it("matches the merchant or the description", () => {
    expect(keyMatchesRow("JUMBO", { merchant: "Jumbo 9876", description: "" })).toBe(true);
    expect(keyMatchesRow("LIDL", { merchant: null, description: "LIDL 1234" })).toBe(true);
    expect(keyMatchesRow("LIDL", { merchant: "JUMBO", description: "JUMBO 1" })).toBe(false);
    expect(keyMatchesRow("", { merchant: "JUMBO", description: "" })).toBe(false);
  });
});

describe("loadMerchantHistory", () => {
  beforeEach(() => findMany.mockReset());

  it("counts hits, distinct months and the last booking, and ignores unrelated keys", async () => {
    findMany.mockResolvedValue([
      { merchant: "LIDL", description: "LIDL 1", bookedAt: new Date("2026-01-04T00:00:00Z") },
      { merchant: "LIDL", description: "LIDL 2", bookedAt: new Date("2026-01-18T00:00:00Z") },
      { merchant: "LIDL", description: "LIDL 3", bookedAt: new Date("2026-03-02T00:00:00Z") },
      { merchant: "FLORIST", description: "FLORIST", bookedAt: new Date("2025-06-02T00:00:00Z") },
    ]);

    const history = await loadMerchantHistory(["LIDL"]);

    expect(history.get("LIDL")).toEqual({
      hits: 3,
      distinctMonths: 2,
      lastBookedAt: new Date("2026-03-02T00:00:00Z"),
    });
    expect(history.has("FLORIST")).toBe(false);
  });

  it("queries the window and never asks for rows without a merchant", async () => {
    findMany.mockResolvedValue([]);
    await loadMerchantHistory(["LIDL"]);

    const query = findMany.mock.calls[0][0] as {
      where: { merchant: { not: null }; bookedAt: { gte: Date } };
    };
    expect(query.where.merchant).toEqual({ not: null });
    expect(query.where.bookedAt.gte).toBeInstanceOf(Date);
    expect(query.where.bookedAt.gte.getTime()).toBeLessThan(Date.now());
  });

  it("does not query at all without keys", async () => {
    expect((await loadMerchantHistory([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
