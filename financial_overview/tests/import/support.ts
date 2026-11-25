import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type NormalizedRow, detectSource, parseStatement } from "@/lib/import";
import { dedupeHash } from "@/lib/import/normalize";

export function fixtureText(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

export function fixtureBytes(name: string): Uint8Array {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));
}

/** Sniffs and parses a fixture the way the upload path does. */
export function parseFixture(name: string) {
  const text = fixtureText(name);
  const source = detectSource(name, text);
  if (!source) throw new Error(`no source detected for ${name}`);
  return parseStatement(source, text);
}

/** Repeat rows inside one file get an occurrence, so their hashes stay distinct. */
export function hashSequence(rows: NormalizedRow[], accountId = "acc-test"): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = [row.bookedAt.toISOString(), row.amountCents, row.currency, row.merchant].join("|");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return dedupeHash({
      accountId,
      bookedAt: row.bookedAt,
      amountCents: row.amountCents,
      currency: row.currency,
      merchant: row.merchant,
      occurrence,
    });
  });
}
