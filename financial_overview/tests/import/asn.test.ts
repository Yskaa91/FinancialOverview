import { describe, expect, it } from "vitest";
import { decodeStatementBytes, detectSource, parseStatement } from "@/lib/import";
import { ImportFormatError } from "@/lib/import/normalize";
import { fixtureBytes, fixtureText, hashSequence, parseFixture } from "./support";

// ASN ships no header, so position is the only mapping. These fixtures carry the
// two real variants: comma with '...' narratives (one spanning two lines) and
// semicolon with every field quoted.
describe("ASN comma variant", () => {
  const result = parseFixture("asn-comma.csv");

  it("is detected from the content, without a header", () => {
    expect(result.source).toBe("ASN");
    expect(detectSource("afschrift.csv", fixtureText("asn-comma.csv"))).toBe("ASN");
  });

  it("keeps every readable row and rejects the truncated one", () => {
    expect(result.rows).toHaveLength(9);
    expect(result.rejected).toEqual([
      { line: 11, reason: "expected 20 fields, got 16" },
    ]);
  });

  it("reads dt-mm-yyyy dates that are not zero padded", () => {
    expect(result.rows[0].bookedAt.toISOString()).toBe("2025-03-25T00:00:00.000Z");
    expect(result.rows[8].bookedAt.toISOString()).toBe("2025-03-31T00:00:00.000Z");
  });

  it("takes the signed amount as cents, expense negative", () => {
    const amounts = result.rows.map((row) => row.amountCents);
    expect(amounts).toEqual([
      245000, -3215, -14500, -1199, -50000, -745, 1250, -145000, -5000,
    ]);
    expect(amounts.reduce((sum, cents) => sum + cents, 0)).toBe(26591);
  });

  it("adds the balance before to the amount", () => {
    expect(result.rows[0].balanceAfterCents).toBe(463042);
    expect(result.rows[2].balanceAfterCents).toBe(445327);
  });

  it("joins a narrative that spans two lines", () => {
    expect(result.rows[1].description).toBe("ALBERT HEIJN 1234 AMSTERDAM");
    expect(JSON.parse(result.rows[1].rawJson)).toContain(
      "ALBERT HEIJN 1234\nAMSTERDAM 25.03.2025 17U02 KV004x x11207xx MCC:5411 Betaalautomaat NLNEDERLAND",
    );
  });

  it("derives the merchant from the description, or from the counterparty on a transfer", () => {
    expect(result.rows[0].counterparty).toBe("ACME BV");
    expect(result.rows[0].counterpartyIban).toBe("NL02RABO0987654321");
    expect(result.rows[0].merchant).toBe("ACME BV");
    expect(result.rows[1].counterparty).toBeNull();
    expect(result.rows[1].counterpartyIban).toBeNull();
    expect(result.rows[1].merchant).toBe("ALBERT HEIJN");
    expect(result.rows[3].merchant).toBe("STEAM GAMES");
    expect(result.rows[7].merchant).toBe("WONINGSTICHTING NOORD");
  });

  it("hashes the same file twice to the same sequence", () => {
    expect(hashSequence(result.rows)).toEqual(hashSequence(parseFixture("asn-comma.csv").rows));
  });
});

describe("ASN semicolon variant", () => {
  const result = parseFixture("asn-semicolon.csv");

  it("sniffs the semicolon and reads the fully quoted rows", () => {
    expect(result.rows).toHaveLength(9);
    expect(result.rejected).toEqual([]);
    expect(result.rows[0].amountCents).toBe(75000);
    expect(result.rows[0].counterparty).toBe("ACME BV");
  });

  it("leaves the balance out when the mutation is in another currency", () => {
    const fx = result.rows[3];
    expect(fx.currency).toBe("USD");
    expect(fx.amountCents).toBe(-1234);
    expect(fx.balanceAfterCents).toBeNull();
    expect(result.rows[4].balanceAfterCents).toBe(201740);
  });

  it("hashes the same file twice to the same sequence", () => {
    expect(hashSequence(result.rows)).toEqual(hashSequence(parseFixture("asn-semicolon.csv").rows));
  });
});

describe("ASN encoding", () => {
  it("decodes a cp1252 export without losing the accented names", () => {
    const text = decodeStatementBytes(fixtureBytes("asn-cp1252.csv"));
    expect(text).toContain("MÜLLER BÄCKEREI");

    const result = parseStatement("ASN", text);
    expect(result.rows).toHaveLength(8);
    expect(result.rows[1].merchant).toBe("MÜLLER BÄCKEREI");
    expect(result.rows[0].merchant).toBe("CAFETARIA PLEK");
  });
});

describe("ASN header", () => {
  it("refuses a file that grew a header row", () => {
    const text = `Boekingsdatum,Opdrachtgeversrekening,Tegenrekeningnummer,Naam tegenrekening,Adres,Postcode,Plaats,Valutasoort rekening,Saldo rekening voor mutatie,Valutasoort mutatie,Transactiebedrag,Journaaldatum,Valutadatum,Interne transactiecode,Globale transactiecode,Volgnummer transactie,Betalingskenmerk,Omschrijving,Afschriftnummer,Categorie
25-3-2025,NL21ASNB0123456789,,,,,EUR,10.00,EUR,-4.00,25-3-2025,25-3-2025,7913,BEA,1,,'X Y Z',41,Eten`;

    expect(() => parseStatement("ASN", text)).toThrow(ImportFormatError);
    expect(() => parseStatement("ASN", text)).toThrow(/Boekingsdatum/);
  });

  it("refuses an empty file", () => {
    expect(() => parseStatement("ASN", "")).toThrow(/no rows in file/);
  });
});

// Newer exports put a Dutch header above the same 20 positions. One narrative
// says "Bruto", which used to be enough to sniff the whole file as PayPal.
describe("ASN labelled header", () => {
  const result = parseFixture("asn-header.csv");

  it("is detected as ASN and not as PayPal", () => {
    expect(result.source).toBe("ASN");
    expect(detectSource("afschrift.csv", fixtureText("asn-header.csv"))).toBe("ASN");
  });

  it("drops the header row instead of rejecting it", () => {
    expect(result.rows).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });

  it("keeps the signed amounts", () => {
    expect(result.rows.map((row) => row.amountCents)).toEqual([172359, -1250]);
  });
});
