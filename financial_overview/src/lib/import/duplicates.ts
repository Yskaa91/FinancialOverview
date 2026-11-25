// Overlapping imports: a statement re-imported with one extra week, or the same
// card feed twice, brings rows that are almost certainly already in the database.
// Nothing here touches the database or decides anything: it only labels rows so
// the dialog can ask, with a sane default per label.
//
// EXACT = literally the same transaction (equal dedupe hash).
// LIKELY = same amount close in time, or same amount and merchant a bit later,
//          which is also how a genuine repeat purchase looks. Hence "import" as
//          the default: silently dropping a real payment is worse.

import type { DuplicateCandidate } from "@/lib/review/types";

export type IncomingRow = {
  index: number;
  bookedAt: string;
  amountCents: number;
  description: string;
  merchant: string | null;
  dedupeHash: string;
};

export type ExistingRow = {
  id: string;
  bookedAt: string;
  amountCents: number;
  description: string;
  merchant: string | null;
  dedupeHash: string;
};

/** Same amount within 3 days: an overlapping window, a weekend booking shift. */
const NEAR_DAYS = 3;
/** Same amount and same shop within 14 days: a weekly or monthly repeat. */
const MERCHANT_DAYS = 14;

export function findDuplicateCandidates(incoming: IncomingRow[], existing: ExistingRow[]): DuplicateCandidate[] {
  const byHash = new Map(existing.map((row) => [row.dedupeHash, row]));
  const usable = existing.filter((row) => row.amountCents !== 0).map((row) => ({ row, day: utcDay(row.bookedAt) }));

  const candidates: DuplicateCandidate[] = [];
  for (const row of incoming) {
    if (row.amountCents === 0) continue;

    const exact = byHash.get(row.dedupeHash);
    if (exact) {
      candidates.push(candidate(row, exact, "EXACT", "same-hash", "skip"));
      continue;
    }

    const day = utcDay(row.bookedAt);
    let best: { row: ExistingRow; days: number; reason: DuplicateCandidate["reason"] } | null = null;
    for (const other of usable) {
      if (other.row.amountCents !== row.amountCents) continue;
      const days = Math.abs(other.day - day);
      if (Number.isNaN(days)) continue;

      const sameMerchant = row.merchant !== null && other.row.merchant !== null && sameName(row.merchant, other.row.merchant);
      const reason: DuplicateCandidate["reason"] | null =
        days <= NEAR_DAYS ? "same-amount-near-date" : sameMerchant && days <= MERCHANT_DAYS ? "same-amount-same-merchant" : null;
      if (!reason) continue;
      if (best && (best.days < days || (best.days === days && best.row.id <= other.row.id))) continue;
      best = { row: other.row, days, reason };
    }

    if (best) candidates.push(candidate(row, best.row, "LIKELY", best.reason, "import"));
  }

  return candidates.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "EXACT" ? -1 : 1;
    if (a.row.bookedAt !== b.row.bookedAt) return a.row.bookedAt < b.row.bookedAt ? -1 : 1;
    return a.hash.localeCompare(b.hash);
  });
}

function candidate(
  row: IncomingRow,
  existing: ExistingRow,
  kind: DuplicateCandidate["kind"],
  reason: DuplicateCandidate["reason"],
  defaultDecision: DuplicateCandidate["defaultDecision"],
): DuplicateCandidate {
  return {
    hash: row.dedupeHash,
    kind,
    reason,
    row: {
      bookedAt: row.bookedAt,
      amountCents: row.amountCents,
      description: row.description,
      merchant: row.merchant,
    },
    existing: {
      id: existing.id,
      bookedAt: existing.bookedAt,
      amountCents: existing.amountCents,
      description: existing.description,
      merchant: existing.merchant,
    },
    defaultDecision,
  };
}

/** Days since the epoch, so "2 days apart" means 2 calendar days, not 2 strings. */
function utcDay(value: string): number {
  const time = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(time) ? Number.NaN : Math.floor(time / 86_400_000);
}

function sameName(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}
