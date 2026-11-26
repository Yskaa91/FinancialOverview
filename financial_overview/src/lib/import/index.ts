import type { StatementSource } from "@/lib/types";
import { parseAsn } from "./asn";
import { parseIcs } from "./ics";
import { parseIcsPdf } from "./ics-pdf";
import { parsePaypal } from "./paypal";
import { ImportFormatError } from "./normalize";

export { ImportFormatError } from "./normalize";

export type NormalizedRow = {
  bookedAt: Date;
  amountCents: number;
  currency: string;
  description: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  merchant: string | null;
  balanceAfterCents: number | null;
  rawJson: string;
};

export type ParseResult = {
  source: StatementSource;
  rows: NormalizedRow[];
  rejected: { line: number; reason: string }[];
};

/**
 * Sniffs the source from the file name and the first lines. The header wins
 * over the name: a renamed file is more likely than a wrong header.
 */
export function detectSource(filename: string, text: string): StatementSource | null {
  const clean = text.replace(/^\uFEFF/, "");
  const name = filename.toLowerCase();
  const head = clean.split(/\r?\n/).slice(0, 4).join("\n");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";

  if (/transactiedatum/i.test(head) && /debit\s*\/\s*credit/i.test(head)) return "ICS";

  // PayPal's Activity Download always carries a header row, so sniff it in that
  // row alone: "Bruto" also appears in the free text of an ASN narrative.
  if (
    /\b(date|datum)\b/i.test(firstLine) &&
    /\b(net|netto|bruto|gross|total|amount|bedrag)\b/i.test(firstLine) &&
    /\b(status|tijd|time)\b/i.test(firstLine)
  ) {
    return "PAYPAL";
  }

  // ASN: a dd-mm-yyyy first field in a full-width row, or the header row that
  // recent exports put above it (positions unchanged).
  if (/^(datum|boekingsdatum),/i.test(firstLine) && /je rekening/i.test(firstLine)) return "ASN";
  if (/^\d{1,2}-\d{1,2}-\d{4}/.test(firstLine) && (firstLine.match(/[,;]/g)?.length ?? 0) >= 17) {
    return "ASN";
  }

  if (/paypal/i.test(name)) return "PAYPAL";
  if (/ics/i.test(name)) return "ICS";
  if (/asn/i.test(name)) return "ASN";
  return null;
}

export function parseStatement(source: StatementSource, text: string): ParseResult {
  const clean = text.replace(/^\uFEFF/, "");
  switch (source) {
    case "ASN":
      return parseAsn(clean);
    case "PAYPAL":
      return parsePaypal(clean);
    case "ICS":
      return parseIcs(clean);
    default:
      throw new ImportFormatError(String(source), "unknown statement source", []);
  }
}

/**
 * A PDF has no header row to read, so the letterhead identifies it. ICS is the
 * only source that ships PDF, and its first line names the company.
 */
export function detectPdfSource(lines: string[]): StatementSource | null {
  const head = lines.slice(0, 40).join("\n");
  if (/international card services/i.test(head) || /ics-klantnummer/i.test(head)) return "ICS";
  return null;
}

/** PDF counterpart of parseStatement. Only ICS publishes one. */
export function parsePdfStatement(source: StatementSource, lines: string[]): ParseResult {
  if (source === "ICS") return parseIcsPdf(lines);
  throw new ImportFormatError(String(source), "no PDF support for this source", lines.slice(0, 3));
}

/**
 * ASN exports cp1252, ICS utf-8 with BOM. Callers read bytes, so the decoding
 * decision lives here and never in a parser.
 */
export function decodeStatementBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("\uFFFD")) return utf8;
  return new TextDecoder("windows-1252").decode(bytes);
}
