import { parseStatementDate } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";
import type { NormalizedRow, ParseResult } from "./index";
import { parseCsv, sniffDelimiter } from "./csv";
import { ImportFormatError, cleanDescription, emptyToNull, extractMerchant } from "./normalize";

const FIELD_COUNT = 20;
// ASN appended Categorie silently (18 → 19 → 20 fields), so the head of the row
// is positional and only a short row is an error.
const MIN_FIELDS = 18;

const ACCOUNT_CURRENCY = 7;
const BALANCE_BEFORE = 8;
const MUTATION_CURRENCY = 9;
const AMOUNT = 10;
const COUNTERPARTY_IBAN = 2;
const COUNTERPARTY = 3;
const DESCRIPTION = 17;

export function parseAsn(text: string): ParseResult {
  const delimiter = sniffDelimiter(text, [",", ";"], FIELD_COUNT);
  const records = parseCsv(text, delimiter);
  const first = records[0];
  if (!first) throw new ImportFormatError("ASN", "no rows in file", []);

  // Older ASN exports ship no header row at all. If one appears, the format
  // changed: stop here.
  if (first.fields.some((field) => /^(boekingsdatum|transactiebedrag)$/i.test(field.trim()))) {
    throw new ImportFormatError("ASN", "unexpected header row in a header-less format", first.fields);
  }

  // Recent exports label the same 20 positions, so drop that row and keep going.
  const labelled = /^(datum|boekingsdatum)$/i.test(first.fields[0]?.trim() ?? "");

  const rows: NormalizedRow[] = [];
  const rejected: ParseResult["rejected"] = [];

  for (const { line, fields } of labelled ? records.slice(1) : records) {
    if (fields.length < MIN_FIELDS) {
      rejected.push({ line, reason: `expected ${FIELD_COUNT} fields, got ${fields.length}` });
      continue;
    }

    const bookedAt = parseStatementDate(fields[0]);
    if (!bookedAt) {
      rejected.push({ line, reason: `unreadable date "${fields[0]}"` });
      continue;
    }

    const amountCents = parseAmountToCents(fields[AMOUNT]);
    if (amountCents === null) {
      rejected.push({ line, reason: `unreadable amount "${fields[AMOUNT]}"` });
      continue;
    }

    const accountCurrency = fields[ACCOUNT_CURRENCY].trim() || "EUR";
    const currency = fields[MUTATION_CURRENCY].trim() || accountCurrency;
    const balanceBefore = parseAmountToCents(fields[BALANCE_BEFORE]);
    const counterparty = emptyToNull(fields[COUNTERPARTY]);
    const description = cleanDescription(fields[DESCRIPTION]);

    rows.push({
      bookedAt,
      amountCents,
      currency,
      description,
      counterparty,
      counterpartyIban: emptyToNull(fields[COUNTERPARTY_IBAN]),
      merchant: extractMerchant(description, counterparty),
      // Field 9 is the balance *before* the mutation and in the account
      // currency; on an FX row the amount is in another currency, so no guess.
      balanceAfterCents:
        balanceBefore !== null && currency === accountCurrency ? balanceBefore + amountCents : null,
      rawJson: JSON.stringify(fields),
    });
  }

  return { source: "ASN", rows, rejected };
}
