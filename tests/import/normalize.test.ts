import { describe, expect, it } from "vitest";
import {
  ImportFormatError,
  cleanDescription,
  dedupeHash,
  extractMerchant,
} from "@/lib/import/normalize";

// The narrative arrives with terminal noise glued to it. Everything here is
// about keeping the money-relevant words and the merchant key intact.
describe("cleanDescription", () => {
  it("strips the terminal noise around the shop name", () => {
    expect(
      cleanDescription(
        "BP EXPRESS 10.10.2024 11U32 KV004x x11207xx MCC:5542 Contactloze betaling NLNEDERLAND",
      ),
    ).toBe("BP EXPRESS");
    expect(cleanDescription("AH TO GO 28.03.2025 08U41 BEA NR:4X2K8 BETAALPAS")).toBe(
      "AH TO GO",
    );
  });

  it("keeps a narrative that has nothing to strip", () => {
    expect(cleanDescription("MUSICBOX.COM/BILL CORK IRL")).toBe("MUSICBOX.COM/BILL CORK IRL");
  });

  it("collapses whitespace and drops the wrapping quotes", () => {
    expect(cleanDescription("'ALBERT   HEIJN\n AMSTERDAM'")).toBe("ALBERT HEIJN AMSTERDAM");
    expect(cleanDescription("  ")).toBe("");
  });
});

describe("extractMerchant", () => {
  it("uppercases the first two words", () => {
    expect(extractMerchant("ALBERT HEIJN 1234 AMSTERDAM", null)).toBe("ALBERT HEIJN");
    expect(extractMerchant("ACME* CLOUD PLAN SAN FRANCISCO", null)).toBe("ACME CLOUD");
  });

  it("uses the counterparty for generic bank wording", () => {
    expect(extractMerchant("SEPA Overboeking Loon maart 2025", "ACME BV")).toBe("ACME BV");
    expect(extractMerchant("Betaling ontvangen", "M. de Vries")).toBe("M. DE VRIES");
  });

  it("returns null instead of guessing", () => {
    expect(extractMerchant("1234 SHOP ONKNOWN", null)).toBeNull();
    expect(extractMerchant("GEINCASSEERD VORIG SALDO", null)).toBeNull();
    expect(extractMerchant("", null)).toBeNull();
    expect(extractMerchant("--", null)).toBeNull();
  });

  it("falls back to the counterparty when the description is empty", () => {
    expect(extractMerchant("", "J. Jansen")).toBe("J. JANSEN");
  });
});

describe("dedupeHash", () => {
  const bookedAt = new Date("2025-03-25T00:00:00.000Z");
  const base = {
    accountId: "acc-1",
    bookedAt,
    amountCents: -3215,
    currency: "EUR",
    merchant: "ALBERT HEIJN",
    occurrence: 0,
  };

  it("is stable for the same row", () => {
    expect(dedupeHash(base)).toBe(dedupeHash({ ...base }));
    expect(dedupeHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("dates by calendar day, not by time", () => {
    expect(dedupeHash({ ...base, bookedAt: new Date("2025-03-25T18:00:00.000Z") })).toBe(
      dedupeHash(base),
    );
  });

  it("separates rows that only differ in one field", () => {
    const hashes = new Set([
      dedupeHash(base),
      dedupeHash({ ...base, occurrence: 1 }),
      dedupeHash({ ...base, amountCents: -3216 }),
      dedupeHash({ ...base, currency: "USD" }),
      dedupeHash({ ...base, merchant: null }),
      dedupeHash({ ...base, accountId: "acc-2" }),
      dedupeHash({ ...base, bookedAt: new Date("2025-03-26T00:00:00.000Z") }),
    ]);
    expect(hashes.size).toBe(7);
  });
});

describe("ImportFormatError", () => {
  it("carries the header it saw", () => {
    const error = new ImportFormatError("ICS", "header is missing bedrag", ["Foo", "Bar"]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ImportFormatError");
    expect(error.source).toBe("ICS");
    expect(error.detail).toBe("header is missing bedrag");
    expect(error.headersSeen).toEqual(["Foo", "Bar"]);
    expect(error.message).toContain("Foo | Bar");
  });

  it("says so when no header was seen", () => {
    expect(new ImportFormatError("ASN", "no rows in file", []).message).toContain("(none)");
  });
});
