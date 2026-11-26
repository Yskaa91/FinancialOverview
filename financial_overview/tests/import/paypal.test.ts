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

// PayPal's newer Activity Download: Amount/Fees/Total instead of Gross/Fee/Net,
// a quirk-free English header, and a filename that says nothing at all.
describe("PayPal Activity Download with Amount/Fees/Total", () => {
  const text = fixtureText("paypal-activity-total.csv");
  const result = parseStatement("PAYPAL", text);

  it("is detected from the header alone, without a telling filename", () => {
    expect(detectSource("Download.CSV", text)).toBe("PAYPAL");
  });

  it("imports the final rows and reports the pending deposit", () => {
    expect(result.rows).toHaveLength(5);
    expect(result.rejected).toEqual([{ line: 3, reason: 'non-final status "Pending"' }]);
  });

  it("takes Total as the cash effect, so fees are included", () => {
    expect(result.rows.map((row) => row.amountCents)).toEqual([
      -1800, -9379, 585, -585, -10350,
    ]);
    const raw = JSON.parse(result.rows[4].rawJson);
    expect(raw.Amount).toBe("-100.00");
    expect(raw.Fees).toBe("-3.50");
    expect(raw.Total).toBe("-103.50");
  });

  it("keeps a withdrawal that is still processing", () => {
    expect(result.rows[3].description).toBe("User Initiated Withdrawal");
  });

  it("defaults to DD/MM/YYYY when nothing in the file proves otherwise", () => {
    expect(result.rows[0].bookedAt.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(result.rows[4].bookedAt.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
});

describe("PayPal column preference", () => {
  it("reads Net rather than Total when a header carries both", () => {
    const text =
      "Date,Time,TimeZone,Name,Type,Status,Currency,Amount,Net,Total\n" +
      "01/04/2025,10:00:00,CET,Shop,Payment,Completed,EUR,-1.00,-2.00,-3.00";
    expect(parseStatement("PAYPAL", text).rows[0].amountCents).toBe(-200);
  });
});

// PayPal's "Type" is how the money moved, not who received it. Taking its first
// words as the merchant merged every shop that used that method into one review
// group named after whichever row came first.
describe("PayPal merchant identity", () => {
  const header =
    "Date,Time,TimeZone,Name,Type,Status,Currency,Amount,Fees,Total,Transaction ID,Item Title\n";

  it("takes the other party, not the payment method", () => {
    const text =
      header +
      '05/10/2026,14:34:38,GMT+02:00,Servicecenter Windhorn,Express Checkout Payment,Completed,EUR,-93.79,0.00,-93.79,T1,""\n' +
      '10/10/2026,22:59:01,GMT+02:00,K4G LTD,Express Checkout Payment,Completed,EUR,-4.72,0.00,-4.72,T2,""\n' +
      '11/10/2026,17:43:48,GMT+02:00,Valve Corporation,Express Checkout Payment,Completed,EUR,-8.99,0.00,-8.99,T3,""';
    expect(parseStatement("PAYPAL", text).rows.map((row) => row.merchant)).toEqual([
      "SERVICECENTER WINDHORN",
      "K4G LTD",
      "VALVE CORPORATION",
    ]);
  });

  it("prefers the item title when there is one", () => {
    const text =
      header +
      '05/10/2026,14:34:38,GMT+02:00,Some Shop,Shopping Cart Payment,Completed,EUR,-9.00,0.00,-9.00,T4,Steam Games';
    const row = parseStatement("PAYPAL", text).rows[0];
    expect(row.merchant).toBe("STEAM GAMES");
    expect(row.description).toBe("Steam Games");
  });

  it("invents no merchant when PayPal names nobody", () => {
    // The review group then keys off the description instead; a merchant guessed
    // from "User Initiated Withdrawal" would be a rule nobody meant to write.
    const text =
      header +
      '07/10/2026,22:33:11,GMT+02:00,,User Initiated Withdrawal,Processing,EUR,-5.85,0.00,-5.85,T5,""';
    const row = parseStatement("PAYPAL", text).rows[0];
    expect(row.merchant).toBeNull();
    expect(row.description).toBe("User Initiated Withdrawal");
  });
});
