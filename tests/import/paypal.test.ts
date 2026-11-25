import { describe, expect, it } from "vitest";
import { detectSource, parseStatement } from "@/lib/import";
import { ImportFormatError } from "@/lib/import/normalize";
import { fixtureText, hashSequence, parseFixture } from "./support";

// The Dutch header pack, NL decimal commas and three non-final statuses.
describe("PayPal Dutch export", () => {
  const result = parseFixture("paypal-nl.csv");

  it("is detected from the localised header", () => {
    expect(result.source).toBe("PAYPAL");
    expect(detectSource("download.csv", fixtureText("paypal-nl.csv"))).toBe("PAYPAL");
  });

  it("imports the final rows and reports the non-final statuses", () => {
    expect(result.rows).toHaveLength(8);
    expect(result.rejected).toEqual([
      { line: 3, reason: 'non-final status "Pending"' },
      { line: 7, reason: 'non-final status "Reversed"' },
      { line: 11, reason: 'non-final status "Denied"' },
    ]);
  });

  it("takes Net as the cash effect and flips nothing", () => {
    expect(result.rows.map((row) => row.amountCents)).toEqual([
      -1199, -1099, -5999, 2426, -2000, 7252, -1675, -13190,
    ]);
  });

  it("sniffs DD/MM/YYYY from a day above 12", () => {
    expect(result.rows[0].bookedAt.toISOString()).toBe("2025-03-03T00:00:00.000Z");
    expect(result.rows[4].bookedAt.toISOString()).toBe("2025-03-17T00:00:00.000Z");
  });

  it("takes the item title as the description and the payer as the counterparty", () => {
    expect(result.rows[0].description).toBe("Steam Games");
    expect(result.rows[0].counterparty).toBe("Steam Games");
    expect(result.rows[0].merchant).toBe("STEAM GAMES");
    // No item title: the type stays generic, so the counterparty is the key.
    expect(result.rows[3].description).toBe("Betaling ontvangen");
    expect(result.rows[3].counterparty).toBe("M. de Vries");
    expect(result.rows[3].merchant).toBe("M. DE VRIES");
  });

  it("keeps the balance, the fee and the time zone in rawJson", () => {
    expect(result.rows[0].balanceAfterCents).toBe(-1199);
    const raw = JSON.parse(result.rows[0].rawJson);
    expect(raw.Tijdzone).toBe("Europe/Amsterdam");
    expect(raw.Kosten).toBe("0,00");
    expect(raw.Netto).toBe("-11,99");
  });

  it("has no iban to give", () => {
    expect(result.rows[0].counterpartyIban).toBeNull();
  });

  it("hashes the same file twice to the same sequence", () => {
    expect(hashSequence(result.rows)).toEqual(hashSequence(parseFixture("paypal-nl.csv").rows));
  });
});

describe("PayPal date order", () => {
  const header =
    "Date,Time,TimeZone,Name,Type,Status,Currency,Gross,Fee,Net,Balance\n";

  function parse(rows: string) {
    return parseStatement("PAYPAL", header + rows + "\n");
  }

  it("reads MM/DD/YYYY when a second part is above 12", () => {
    const result = parse(
      '03/17/2025,09:00:00,Europe/Amsterdam,Shop,Payment,Completed,EUR,"-1,00","0,00","-1,00","-1,00"\n' +
        '03/05/2025,09:00:00,Europe/Amsterdam,Shop,Payment,Completed,EUR,"-2,00","0,00","-2,00","-3,00"',
    );
    expect(result.rows.map((row) => row.bookedAt.toISOString())).toEqual([
      "2025-03-17T00:00:00.000Z",
      "2025-03-05T00:00:00.000Z",
    ]);
  });

  it("defaults to DD/MM/YYYY when the file stays ambiguous", () => {
    const result = parse(
      '05/03/2025,09:00:00,Europe/Amsterdam,Shop,Payment,Completed,EUR,"-1,00","0,00","-1,00","-1,00"',
    );
    expect(result.rows[0].bookedAt.toISOString()).toBe("2025-03-05T00:00:00.000Z");
  });
});

describe("PayPal header handling", () => {
  it("finds the header below a preamble", () => {
    const text =
      "Activity Download\nAccount: jan.jansen@example.com\n\n" +
      "Date,Time,TimeZone,Name,Type,Status,Currency,Gross,Fee,Net,Balance\n" +
      '01/04/2025,10:00:00,Europe/Amsterdam,Shop,Payment,Completed,EUR,"-3,50","0,00","-3,50","-3,50"';
    const result = parseStatement("PAYPAL", text);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amountCents).toBe(-350);
  });

  it("rejects a row with an unreadable amount", () => {
    const text =
      "Date,Time,TimeZone,Name,Type,Status,Currency,Gross,Fee,Net,Balance\n" +
      "01/04/2025,10:00:00,Europe/Amsterdam,Shop,Payment,Completed,EUR,-,-,n/a,-";
    expect(parseStatement("PAYPAL", text).rejected).toEqual([
      { line: 2, reason: 'unreadable amount "n/a"' },
    ]);
  });

  it("fails loudly when the header changed", () => {
    expect(() => parseStatement("PAYPAL", "Foo,Bar\n1,2")).toThrow(ImportFormatError);
    expect(() => parseStatement("PAYPAL", "Foo,Bar\n1,2")).toThrow(/Foo \| Bar/);
  });
});
