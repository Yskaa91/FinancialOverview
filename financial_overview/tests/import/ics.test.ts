import { describe, expect, it } from "vitest";
import { detectSource, parseStatement } from "@/lib/import";
import { ImportFormatError } from "@/lib/import/normalize";
import { fixtureText, hashSequence, parseFixture } from "./support";

// ICS publishes no spec: the header, the semicolon delimiter, comma decimals
// and the inverted sign are all observations. The file has a UTF-8 BOM.
describe("ICS card export", () => {
  const result = parseFixture("ics.csv");

  it("is detected from the header", () => {
    expect(result.source).toBe("ICS");
    expect(detectSource("transacties.csv", fixtureText("ics.csv"))).toBe("ICS");
  });

  it("keeps every readable row and rejects the one without an amount", () => {
    expect(result.rows).toHaveLength(9);
    expect(result.rejected).toEqual([{ line: 11, reason: 'unreadable amount ""' }]);
  });

  it("negates D rows so a purchase is negative and a refund positive", () => {
    expect(result.rows[0].amountCents).toBe(-429); // D, 4,29 in the file
    expect(result.rows[2].amountCents).toBe(-999);
    expect(result.rows[7].amountCents).toBe(999); // C, refund
    expect(result.rows[1].amountCents).toBe(16394); // C, settlement
  });

  it("reads comma decimals and dd-mm-yyyy dates", () => {
    expect(result.rows[5].amountCents).toBe(-5218);
    expect(result.rows[5].bookedAt.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("puts the masked card number in the iban field and nothing else", () => {
    expect(result.rows[0].counterpartyIban).toBe("****1234");
    expect(result.rows[1].counterpartyIban).toBeNull(); // "****null" on a settlement
    expect(result.rows[0].counterparty).toBeNull();
    expect(result.rows[0].balanceAfterCents).toBeNull();
  });

  it("bills in EUR and keeps the original currency in rawJson", () => {
    const usd = result.rows[0];
    expect(usd.currency).toBe("EUR");
    const raw = JSON.parse(usd.rawJson);
    expect(raw.Valuta).toBe("USD");
    expect(raw["Bedrag in oorspronkelijke valuta"]).toBe("4,85");
    expect(raw.Bedrag).toBe("4,29");
  });

  it("extracts the merchant and leaves a settlement without one", () => {
    expect(result.rows[0].merchant).toBe("ACME CLOUD");
    expect(result.rows[2].merchant).toBe("MUSICBOX.COM/BILL CORK");
    expect(result.rows[1].merchant).toBeNull();
    expect(result.rows[1].description).toBe("GEINCASSEERD VORIG SALDO");
  });

  it("keeps two identical rows apart by occurrence", () => {
    const [first, second] = [result.rows[3], result.rows[4]];
    expect(first.amountCents).toBe(second.amountCents);
    expect(first.description).toBe(second.description);

    const hashes = hashSequence(result.rows);
    expect(hashes[3]).not.toBe(hashes[4]);
    expect(hashes).toEqual(hashSequence(parseFixture("ics.csv").rows));
  });
});

describe("ICS header", () => {
  it("fails loudly on a header it does not know", () => {
    expect(() => parseStatement("ICS", "a;b\n1;2")).toThrow(ImportFormatError);
    expect(() => parseStatement("ICS", "a;b\n1;2")).toThrow(/header is missing/);
  });

  it("refuses an empty file", () => {
    expect(() => parseStatement("ICS", "")).toThrow(/no rows in file/);
  });

  it("rejects a row with an unknown Debit/Credit", () => {
    const text =
      "Transactiedatum;Boekingsdatum;Omschrijving;Naam Card-houder;Card nummer;Debit/Credit;Bedrag;Merchant categorie;Land;Valuta;Bedrag in oorspronkelijke valuta;Type transactie;Wallet provider\n" +
      '01-10-2026;02-10-2026;SHOP;"Jansen, J";****1234;X;9,99;;NLD;EUR;9,99;Transaction;null';
    expect(parseStatement("ICS", text).rejected).toEqual([
      { line: 2, reason: 'unknown Debit/Credit "X"' },
    ]);
  });
});
