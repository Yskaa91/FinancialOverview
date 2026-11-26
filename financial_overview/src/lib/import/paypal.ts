import { parseStatementDate } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";
import type { NormalizedRow, ParseResult } from "./index";
import { type CsvRecord, cell, parseCsv } from "./csv";
import { ImportFormatError, cleanDescription, emptyToNull, extractMerchant } from "./normalize";

// PayPal localises the header to the account language. Anchors on column names,
// never positions, and keeps both language packs in one table.
const COLUMNS = {
  date: ["date", "datum"],
  time: ["time", "tijd"],
  timeZone: ["timezone", "tijdzone"],
  name: ["name", "naam"],
  type: ["type"],
  status: ["status"],
  currency: ["currency", "valuta"],
  // Newer Activity Downloads drop Gross/Net and ship Amount/Fees/Total, where
  // Total is the net cash effect. Later aliases are fallbacks, not equals.
  net: ["net", "netto", "total"],
  itemTitle: ["item title", "artikel titel", "itemtitel"],
  balance: ["balance", "saldo"],
} as const;

type Column = keyof typeof COLUMNS;
type ColumnMap = Partial<Record<Column, number>>;

// Non-final states describe money that has not moved. Filter before counting.
const SKIPPED_STATUSES = new Set(["pending", "temporary hold", "reversed", "denied"]);

export function parsePaypal(text: string): ParseResult {
  // Activity Download is comma or TAB. A tab never appears in comma prose.
  const head = text.slice(0, 2000);
  const delimiter =
    (head.match(/\t/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const records = parseCsv(text, delimiter);

  const headerAt = records.findIndex((record) => {
    const map = mapColumns(record.fields);
    return map.date !== undefined && map.net !== undefined && map.status !== undefined;
  });
  if (headerAt === -1) {
    throw new ImportFormatError(
      "PAYPAL",
      "no recognisable header row",
      records[0]?.fields.map((field) => field.trim()) ?? [],
    );
  }

  const header = records[headerAt];
  const map = mapColumns(header.fields);
  const data = records.slice(headerAt + 1);
  const monthFirst = sniffMonthFirst(data.map((record) => cell(record.fields, map.date)));

  const rows: NormalizedRow[] = [];
  const rejected: ParseResult["rejected"] = [];

  for (const record of data) {
    const { line, fields } = record;
    const status = cell(fields, map.status).trim();
    if (SKIPPED_STATUSES.has(status.toLowerCase())) {
      rejected.push({ line, reason: `non-final status "${status}"` });
      continue;
    }

    const bookedAt = parsePaypalDate(cell(fields, map.date), monthFirst);
    if (!bookedAt) {
      rejected.push({ line, reason: `unreadable date "${cell(fields, map.date)}"` });
      continue;
    }

    // Net is the cash effect; Gross and Fee stay in rawJson for later analysis.
    const amountCents = parseAmountToCents(cell(fields, map.net));
    if (amountCents === null) {
      rejected.push({ line, reason: `unreadable amount "${cell(fields, map.net)}"` });
      continue;
    }

    const counterparty = emptyToNull(cell(fields, map.name));
    const itemTitle = cell(fields, map.itemTitle).trim();
    // The item title is the human text; a plain payment only has its type.
    const description = cleanDescription(itemTitle || cell(fields, map.type).trim());

    rows.push({
      bookedAt,
      amountCents,
      currency: cell(fields, map.currency).trim().toUpperCase() || "EUR",
      description: description || counterparty || "",
      counterparty,
      // PayPal has no IBAN; identity is the email columns, kept in rawJson.
      counterpartyIban: null,
      // Never the type: "Express Checkout Payment" is a payment method, and taking
      // its first words as the merchant lumped every shop that used that method
      // into one review group named after whichever row came first. The other
      // party is the merchant, the item title when PayPal supplies one.
      merchant: extractMerchant(itemTitle, counterparty),
      balanceAfterCents:
        map.balance === undefined ? null : parseAmountToCents(cell(fields, map.balance)),
      rawJson: JSON.stringify(rawRecord(header, record)),
    });
  }

  return { source: "PAYPAL", rows, rejected };
}

function mapColumns(fields: string[]): ColumnMap {
  const map: ColumnMap = {};
  const rank: ColumnMap = {};
  fields.forEach((field, at) => {
    const name = field.trim().toLowerCase().replace(/\s+/g, " ");
    for (const key of Object.keys(COLUMNS) as Column[]) {
      const aliases = COLUMNS[key] as readonly string[];
      const aliasAt = aliases.indexOf(name);
      if (aliasAt === -1) continue;
      // Prefer the alias listed first, not the column that comes first in the
      // file: a header carrying both Net and Total must still read Net.
      if (rank[key] === undefined || aliasAt < rank[key]!) {
        map[key] = at;
        rank[key] = aliasAt;
      }
    }
  });
  return map;
}

/**
 * DD/MM/YYYY or MM/DD/YYYY, sniffed per file. A part above 12 can only be a
 * day, which settles it; otherwise the NL export order wins.
 */
function sniffMonthFirst(dates: string[]): boolean {
  let dayFirst = false;
  let monthFirst = false;

  for (const value of dates) {
    const match = /^(\d{1,2})[/-](\d{1,2})[/-]\d{4}$/.exec(value.trim());
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirst = true;
    if (Number(match[2]) > 12) monthFirst = true;
  }

  return monthFirst && !dayFirst;
}

function parsePaypalDate(value: string, monthFirst: boolean): Date | null {
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value.trim());
  if (!match) return parseStatementDate(value); // ISO and other shapes
  const [, first, second, year] = match;
  return parseStatementDate(monthFirst ? `${year}-${first}-${second}` : `${year}-${second}-${first}`);
}

function rawRecord(header: CsvRecord, record: CsvRecord): Record<string, string> {
  const raw: Record<string, string> = {};
  header.fields.forEach((field, at) => {
    raw[field.trim()] = record.fields[at] ?? "";
  });
  return raw;
}
