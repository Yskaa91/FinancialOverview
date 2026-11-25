import { parseStatementDate } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";
import type { NormalizedRow, ParseResult } from "./index";
import { type CsvRecord, cell, parseCsv } from "./csv";
import { ImportFormatError, cleanDescription, extractMerchant } from "./normalize";

// ICS publishes no format spec at all: this column list, the semicolon
// delimiter and the sign convention are observations from real files. Version
// gate on the header and fail loudly instead of importing garbage.
const REQUIRED = ["transactiedatum", "boekingsdatum", "omschrijving", "debit/credit", "bedrag"];

export function parseIcs(text: string): ParseResult {
  const records = parseCsv(text, ";");
  const header = records[0];
  if (!header) throw new ImportFormatError("ICS", "no rows in file", []);

  const map = mapColumns(header.fields);
  const missing = REQUIRED.filter((name) => map[name] === undefined);
  if (missing.length > 0) {
    throw new ImportFormatError(
      "ICS",
      `header is missing ${missing.join(", ")}`,
      header.fields.map((field) => field.trim()),
    );
  }

  const rows: NormalizedRow[] = [];
  const rejected: ParseResult["rejected"] = [];

  for (const record of records.slice(1)) {
    const { line, fields } = record;

    const bookedAt = parseStatementDate(cell(fields, map.transactiedatum));
    if (!bookedAt) {
      rejected.push({ line, reason: `unreadable date "${cell(fields, map.transactiedatum)}"` });
      continue;
    }

    const debitCredit = cell(fields, map["debit/credit"]).trim().toUpperCase();
    if (debitCredit !== "D" && debitCredit !== "C") {
      rejected.push({ line, reason: `unknown Debit/Credit "${debitCredit}"` });
      continue;
    }

    const amount = parseAmountToCents(cell(fields, map.bedrag));
    if (amount === null) {
      rejected.push({ line, reason: `unreadable amount "${cell(fields, map.bedrag)}"` });
      continue;
    }

    // ICS writes purchases positive (D) and payments negative (C). Flip it so
    // expense is negative here, and take the magnitude from Debit/Credit only.
    const amountCents = debitCredit === "D" ? -Math.abs(amount) : Math.abs(amount);
    const description = cleanDescription(cell(fields, map.omschrijving));
    const card = cell(fields, map["card nummer"]).trim();

    rows.push({
      bookedAt,
      amountCents,
      // Bedrag is the billed EUR amount that hits the card balance; the
      // original amount and currency stay in rawJson.
      currency: "EUR",
      description,
      // The file names only the cardholder, who is us, so there is no counterparty.
      counterparty: null,
      counterpartyIban: /^\*+\d+$/.test(card) ? card : null,
      merchant: extractMerchant(description, null),
      balanceAfterCents: null,
      rawJson: JSON.stringify(rawRecord(header, record)),
    });
  }

  return { source: "ICS", rows, rejected };
}

function mapColumns(fields: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  fields.forEach((field, at) => {
    const name = field.trim().toLowerCase();
    // Exact match, so "Bedrag" and "Bedrag in oorspronkelijke valuta" stay apart.
    if (map[name] === undefined) map[name] = at;
  });
  return map;
}

function rawRecord(header: CsvRecord, record: CsvRecord): Record<string, string> {
  const raw: Record<string, string> = {};
  header.fields.forEach((field, at) => {
    raw[field.trim()] = record.fields[at] ?? "";
  });
  return raw;
}
