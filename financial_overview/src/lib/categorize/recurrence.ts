// Recurrence is the only thing that decides whether a merchant earns a rule.
// The AI may pick a category, never a rule: a florist visited twice a year gets
// a category for those rows, Amazon visited every week gets a rule.

import { prisma } from "@/lib/db";

export const RECURRENCE_WINDOW_MONTHS = 12;
export const MIN_HITS_FOR_RULE = Number(process.env.MIN_HITS_FOR_RULE ?? 3);

export type MerchantHistory = { hits: number; distinctMonths: number; lastBookedAt: Date | null };

// Payment-processor wording: it names no shop and differs per statement.
const NOISE = /\b(?:BEA|BETAALPASS|BETAALPAS|BETAALAUTOMAAT|IDEAL|POS|CONTACTLOOS|CONTACTLOZE|KAARTNR|PASNR|PASVOLGNR|IBAN)\b/g;
// "NL91ABNA0417164300": an account number attached to a name is noise too.
const IBANISH = /\b[A-Z]{2}\d{2}[A-Z0-9]{6,}\b/g;
const DIACRITICS = /[\u0300-\u036f]/g;

/** Uppercase, no accents, no digits, no processor noise, single spaces. */
function normalise(input: string): string {
  const text = input
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ");
  return text
    .replace(IBANISH, " ")
    .replace(NOISE, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable group key: uppercased merchant, else a normalised description. */
export function merchantKeyOf(row: { merchant: string | null; description: string }): string {
  const fromMerchant = row.merchant ? normalise(row.merchant) : "";
  return fromMerchant || normalise(row.description) || "UNKNOWN";
}

/** Short display label for a group ("LIDL", "Albert Heijn 1234"). */
export function groupLabel(row: { merchant: string | null; description: string }): string {
  const raw = (row.merchant?.trim() || row.description).replace(/\s+/g, " ").trim();
  return raw.slice(0, 32);
}

/** The amount most rows of a group share (first one wins a tie). */
export function dominantAmountCents(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0] ?? 0;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** The only place that decides whether a merchant earns a rule. */
export function isRecurring(historyHits: number, batchHits: number): boolean {
  return historyHits + batchHits >= MIN_HITS_FOR_RULE;
}

/** Counts rows already in the database, inside RECURRENCE_WINDOW_MONTHS. */
export async function loadMerchantHistory(keys: string[]): Promise<Map<string, MerchantHistory>> {
  const wanted = new Set(keys);
  const result = new Map<string, MerchantHistory>();
  if (wanted.size === 0) return result;

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RECURRENCE_WINDOW_MONTHS, 1));
  const rows = await prisma.transaction.findMany({
    where: { merchant: { not: null }, bookedAt: { gte: start } },
    select: { merchant: true, description: true, bookedAt: true },
  });

  const months = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = merchantKeyOf(row);
    if (!wanted.has(key)) continue;
    const entry = result.get(key) ?? { hits: 0, distinctMonths: 0, lastBookedAt: null };
    entry.hits += 1;
    if (!entry.lastBookedAt || row.bookedAt > entry.lastBookedAt) entry.lastBookedAt = row.bookedAt;
    result.set(key, entry);

    const seen = months.get(key) ?? new Set<string>();
    seen.add(row.bookedAt.toISOString().slice(0, 7));
    months.set(key, seen);
  }

  for (const [key, seen] of months) {
    const entry = result.get(key);
    if (entry) entry.distinctMonths = seen.size;
  }
  return result;
}

/** True when a transaction's own merchant/description maps to this key. */
export function keyMatchesRow(key: string, row: { merchant: string | null; description: string }): boolean {
  if (!key) return false;
  return [row.merchant, row.description].some((value) => (value ? normalise(value) || "UNKNOWN" : "") === key);
}
