// ICS publishes its card statements as PDF only, so this parses the extracted
// text of that PDF (src/lib/import/pdf.ts) rather than a CSV. The layout is a
// table: transaction date, booking date, description, an optional foreign amount,
// the euro amount and Af/Bij. Column positions are gone by the time we get here,
// so every rule below anchors on the line as a whole.

import { parseAmountToCents } from "@/lib/money";
import { utcDate } from "@/lib/dates";
import type { NormalizedRow, ParseResult } from "./index";
import { ImportFormatError, cleanDescription, extractMerchant } from "./normalize";

/** The statement spells months out; the rows abbreviate them with a full stop. */
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januari: 1,
  feb: 2, februari: 2,
  mrt: 3, maart: 3,
  apr: 4, april: 4,
  mei: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augustus: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

// "24 okt.  25 okt.  OCTOPUS ELECTROVERSE LONDON GB  18,41  Af"
const ROW =
  /^(\d{1,2})\s+([a-z]+)\.?\s+\d{1,2}\s+[a-z]+\.?\s+(.+?)\s+([\d.,]+)\s+(af|bij)$/i;
// A foreign amount sits in front of the euro amount: "99,99 USD".
const FOREIGN = /^(.*?)\s+([\d.,]+)\s+([A-Z]{3})$/;
// The statement date shares its line with the customer number and page numbers.
const STATEMENT_DATE = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/i;
const CARD = /laatste vier cijfers\s+\d{4}/i;

export function parseIcsPdf(lines: string[]): ParseResult {
  const statement = findStatementDate(lines);
  if (!statement) {
    throw new ImportFormatError("ICS", "no statement date on the PDF", lines.slice(0, 3));
  }

  const rows: NormalizedRow[] = [];
  const rejected: ParseResult["rejected"] = [];
  let card: string | null = null;

  lines.forEach((line, at) => {
    const lineNumber = at + 1;

    if (CARD.test(line)) {
      // Only ever the last four digits, the same mask the CSV export uses.
      card = `****${line.match(/(\d{4})/)?.[1] ?? ""}`;
      return;
    }

    const match = ROW.exec(line);
    if (!match) return;

    const [, day, month, middle, amount, direction] = match;
    const monthNumber = MONTHS[month.toLowerCase()];
    const bookedAt = utcDate(rowYear(statement, monthNumber), monthNumber, Number(day));
    if (!bookedAt) {
      rejected.push({ line: lineNumber, reason: `unreadable date "${day} ${month}"` });
      return;
    }

    // The row's middle is description plus an optional original amount and
    // currency, which must not become part of the merchant name.
    const foreign = FOREIGN.exec(middle);
    const description = cleanDescription(foreign ? foreign[1] : middle);
    if (description === "") {
      rejected.push({ line: lineNumber, reason: "empty description" });
      return;
    }

    const euroCents = parseAmountToCents(amount);
    if (euroCents === null) {
      rejected.push({ line: lineNumber, reason: `unreadable amount "${amount}"` });
      return;
    }

    // ICS prints Af for money leaving the card and Bij for money coming back, and
    // states both as magnitudes: the direction is the sign.
    const amountCents = direction.toLowerCase() === "af" ? -Math.abs(euroCents) : Math.abs(euroCents);

    rows.push({
      bookedAt,
      amountCents,
      // The euro amount is what the card balance moves by; the original amount
      // and rate stay in rawJson.
      currency: "EUR",
      description,
      // The file names only the cardholder, who is us.
      counterparty: null,
      counterpartyIban: card,
      merchant: extractMerchant(description, null),
      balanceAfterCents: null,
      rawJson: JSON.stringify({
        line,
        card,
        direction,
        foreignAmount: foreign ? foreign[2] : null,
        foreignCurrency: foreign ? foreign[3] : null,
      }),
    });
  });

  return { source: "ICS", rows, rejected };
}

/**
 * The statement date decides the year of every row, which the rows themselves
 * never spell out. A statement issued in January lists December rows, so a month
 * ahead of the statement's own month belongs to the year before.
 */
function findStatementDate(lines: string[]): { year: number; month: number } | null {
  for (const line of lines.slice(0, 40)) {
    const match = STATEMENT_DATE.exec(line.trim());
    if (!match) continue;
    const month = MONTHS[match[2].toLowerCase()];
    if (month === undefined) continue;
    return { year: Number(match[3]), month };
  }
  return null;
}

/** Rows carry no year: take the statement's, stepping back over a year boundary. */
export function rowYear(statement: { year: number; month: number }, month: number): number {
  return month > statement.month ? statement.year - 1 : statement.year;
}
