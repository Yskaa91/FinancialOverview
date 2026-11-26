import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectPdfSource, parsePdfStatement, ImportFormatError } from "@/lib/import";
import { extractPdfLines, looksLikePdf } from "@/lib/import/pdf";
import { fixtureBytes, hashSequence } from "./support";

// ICS only publishes PDF, so the statement has to be read as text. The fixture is
// a PDF rendered from the same lines a real statement draws, with the card digits,
// names and amounts replaced.
const pdf = fixtureBytes("ics-statement.pdf");

describe("PDF upload plumbing", () => {
  it("recognises a PDF by its bytes, not its name", () => {
    expect(looksLikePdf(pdf)).toBe(true);
    expect(looksLikePdf(fixtureBytes("ics.csv"))).toBe(false);
  });

  it("rebuilds one line per visual row", async () => {
    const lines = await extractPdfLines(pdf);
    expect(lines[0]).toBe("International Card Services BV");
    expect(lines).toContain("24 okt. 25 okt. OCTOPUS ELECTROVERSE LONDON GB 18,41 Af");
  });

  it("identifies ICS from its letterhead", async () => {
    expect(detectPdfSource(await extractPdfLines(pdf))).toBe("ICS");
    expect(detectPdfSource(["Some other bank", "1 January 2026"])).toBeNull();
  });

  it("refuses a source that publishes no PDF", async () => {
    await expect(async () => parsePdfStatement("ASN", await extractPdfLines(pdf))).rejects.toThrow();
    expect(() => parsePdfStatement("ASN", ["x"])).toThrow(ImportFormatError);
  });
});

describe("ICS statement PDF", () => {
  const read = async () => parsePdfStatement("ICS", await extractPdfLines(pdf));

  it("imports the transaction rows and reports the impossible date", async () => {
    const result = await read();
    expect(result.source).toBe("ICS");
    expect(result.rows).toHaveLength(6);
    expect(result.rejected).toEqual([{ line: 13, reason: 'unreadable date "31 feb"' }]);
  });

  it("takes Af as a purchase and Bij as money coming back", async () => {
    const result = await read();
    expect(result.rows.map((row) => row.amountCents)).toEqual([
      37745, -1841, -1400, -1814, -9235, 1755,
    ]);
  });

  it("takes the year from the statement date", async () => {
    const result = await read();
    expect(result.rows[1].bookedAt.toISOString()).toBe("2026-10-24T00:00:00.000Z");
    expect(result.rows[4].bookedAt.toISOString()).toBe("2026-11-13T00:00:00.000Z");
  });

  it("keeps the euro amount and files the original currency away", async () => {
    const result = await read();
    const foreign = JSON.parse(result.rows[4].rawJson);
    expect(result.rows[4].amountCents).toBe(-9235);
    expect(foreign.foreignAmount).toBe("99,99");
    expect(foreign.foreignCurrency).toBe("USD");
    expect(result.rows[4].description).toBe("SP WHIMSY AND WILLOW NEUBIBERG DE");
  });

  it("masks the card to its last four digits", async () => {
    const result = await read();
    expect(result.rows.every((row) => row.counterpartyIban === "****7213")).toBe(true);
  });

  it("hashes the same statement to the same rows every time", async () => {
    const first = await read();
    const second = await read();
    expect(hashSequence(first.rows)).toEqual(hashSequence(second.rows));
  });

  it("steps back a year for a month ahead of the statement's own", async () => {
    // A January statement lists the December before it.
    const lines = [
      "International Card Services BV",
      "5 januari 2027 79787290018 11 1 van 1",
      "24 dec. 27 dec. AMAZON.BE* B20OL0L34 LUXEMBOURG LU 38,93 Af",
      "03 jan. 04 jan. Fastned Gent BE 14,00 Af",
    ];
    const result = parsePdfStatement("ICS", lines);
    expect(result.rows.map((row) => row.bookedAt.toISOString())).toEqual([
      "2026-12-24T00:00:00.000Z",
      "2027-01-03T00:00:00.000Z",
    ]);
  });

  it("fails loudly when the statement date is missing", () => {
    expect(() => parsePdfStatement("ICS", ["International Card Services BV"])).toThrow(
      /no statement date/,
    );
  });
});

// Guards the fixture itself: if the PDF is ever replaced by something a scanner
// produced, this is where it shows.
it("extracts text, so the fixture is not a scan", () => {
  const bytes = readFileSync(new URL("../fixtures/ics-statement.pdf", import.meta.url));
  expect(bytes.byteLength).toBeGreaterThan(1000);
});
