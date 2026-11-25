import { createHash } from "node:crypto";

// Parsers never throw bare errors: the caller shows the header it saw instead of
// importing garbage, and the fix stays in one file plus one fixture.
export class ImportFormatError extends Error {
  constructor(
    readonly source: string,
    readonly detail: string,
    readonly headersSeen: string[],
  ) {
    super(`${source}: ${detail}. Headers seen: ${headersSeen.join(" | ") || "(none)"}`);
    this.name = "ImportFormatError";
  }
}

// Card terminals append machine noise to the narrative. It says nothing about
// who got the money, so it goes before the merchant key is derived.
const NOISE: RegExp[] = [
  /\bBETAALPAS\b/gi,
  /\bBetaalautomaat\b/gi,
  /\bPASVOLGNR\S*/gi,
  /\bcontactloze betaling\b/gi,
  /\bBEA\b/gi,
  /\bNR:\S*/gi,
  /\bMCC:\d+/gi,
  /\bx\d+x*\b/gi, // masked card, "x11207xx"
  /\bKV[0-9A-Z]{2,}\b/gi, // terminal id
  /\b\d{1,2}[.-]\d{1,2}[.-]\d{2,4}\b/g, // transaction date
  /\b\d{1,2}[U:]\d{2}(?::\d{2})?\b/g, // transaction time, "11U32"
  /\bNLNEDERLAND\b/g,
];

// Bank and payment-provider wording that names no shop: there the counterparty
// is the only usable key, and a settlement row gets none at all.
const TRANSFER_WORDING =
  /^(SEPA|OVERBOEKING|OVERSCHRIJVING|INCASSO|IDEAL|BETAALVERZOEK|ACCEPTGIRO|TRANSFER|GEA|GEINCASSEERD|PAYMENT|BETALING|WEBSITEBETALING)\b/i;

export function cleanDescription(raw: string): string {
  let text = raw.replace(/^['"]+|['"]+$/g, "");
  for (const pattern of NOISE) text = text.replace(pattern, "");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Two leading description words, or the counterparty for bank wording. Null
 * when the text does not look like a name: a wrong merchant key poisons the
 * learning map, so no guess.
 */
export function extractMerchant(description: string, counterparty: string | null): string | null {
  const cleaned = cleanDescription(description);
  const fromCounterparty = normalizeMerchant(counterparty);

  if (cleaned === "" || TRANSFER_WORDING.test(cleaned)) return fromCounterparty;
  return firstWords(cleaned, 2) ?? fromCounterparty;
}

export function dedupeHash(input: {
  accountId: string;
  bookedAt: Date;
  amountCents: number;
  currency: string;
  merchant: string | null;
  occurrence: number;
}): string {
  const key = [
    input.accountId,
    input.bookedAt.toISOString().slice(0, 10),
    String(input.amountCents),
    input.currency,
    input.merchant ?? "",
    String(input.occurrence),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeMerchant(value: string | null | undefined): string | null {
  const text = cleanDescription(value ?? "").toUpperCase();
  return /[A-Z]{2}/.test(text) ? text : null;
}

function firstWords(text: string, count: number): string | null {
  const words: string[] = [];

  for (const raw of text.split(" ")) {
    if (words.length === count) break;
    // "*ACME*" and "-Shop-" carry the same name as their plain form.
    const word = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (word === "") continue;
    if (/\d/.test(word)) break; // a code, a date or a card number, not a name
    if (!/[A-Za-z]{2}/.test(word)) continue;
    words.push(word);
  }

  return words.length === 0 ? null : words.join(" ").toUpperCase();
}
