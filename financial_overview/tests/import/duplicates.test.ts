import { describe, expect, it } from "vitest";
import { findDuplicateCandidates, type ExistingRow, type IncomingRow } from "@/lib/import/duplicates";


function incoming(over: Partial<IncomingRow> = {}): IncomingRow {
  return {
    index: 0,
    bookedAt: "2026-03-10",
    amountCents: -1250,
    description: "LIDL 1234",
    merchant: "LIDL",
    dedupeHash: "h-in-1",
    ...over,
  };
}

function existing(over: Partial<ExistingRow> = {}): ExistingRow {
  return {
    id: "e1",
    bookedAt: "2026-03-10",
    amountCents: -1250,
    description: "LIDL 1234",
    merchant: "LIDL",
    dedupeHash: "h-old-1",
    ...over,
  };
}

describe("findDuplicateCandidates", () => {
  it("flags an exact hash as EXACT and skips it by default", () => {
    const [candidate] = findDuplicateCandidates([incoming({ dedupeHash: "same" })], [existing({ dedupeHash: "same" })]);

    expect(candidate.kind).toBe("EXACT");
    expect(candidate.reason).toBe("same-hash");
    expect(candidate.defaultDecision).toBe("skip");
    expect(candidate.hash).toBe("same");
    expect(candidate.existing.id).toBe("e1");
    expect(candidate.row).toEqual({
      bookedAt: "2026-03-10",
      amountCents: -1250,
      description: "LIDL 1234",
      merchant: "LIDL",
    });
  });

  it("flags the same amount two days apart as LIKELY and imports it by default", () => {
    const [candidate] = findDuplicateCandidates(
      [incoming({ bookedAt: "2026-03-12", merchant: "JUMBO" })],
      [existing({ bookedAt: "2026-03-10" })],
    );

    expect(candidate.kind).toBe("LIKELY");
    expect(candidate.reason).toBe("same-amount-near-date");
    expect(candidate.defaultDecision).toBe("import");
  });

  it("does not flag the same amount and merchant 20 days apart", () => {
    const found = findDuplicateCandidates(
      [incoming({ bookedAt: "2026-03-30" })],
      [existing({ bookedAt: "2026-03-10" })],
    );
    expect(found).toHaveLength(0);
  });

  it("does not flag the same amount at a different shop 20 days apart", () => {
    const found = findDuplicateCandidates(
      [incoming({ bookedAt: "2026-03-30", merchant: "JUMBO" })],
      [existing({ bookedAt: "2026-03-10", merchant: "LIDL" })],
    );
    expect(found).toHaveLength(0);
  });

  it("flags the same amount and merchant within 14 days as LIKELY", () => {
    const [candidate] = findDuplicateCandidates(
      [incoming({ bookedAt: "2026-03-21" })],
      [existing({ bookedAt: "2026-03-10" })],
    );
    expect(candidate.reason).toBe("same-amount-same-merchant");
    expect(candidate.defaultDecision).toBe("import");
  });

  it("gives one candidate per row and lets EXACT win", () => {
    const rows = findDuplicateCandidates(
      [incoming({ dedupeHash: "same" })],
      [existing({ dedupeHash: "same", bookedAt: "2026-03-09" }), existing({ id: "e2" })],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("EXACT");
    expect(rows[0].reason).toBe("same-hash");
  });

  it("sorts EXACT first, then by date", () => {
    const rows = findDuplicateCandidates(
      [
        incoming({ index: 0, bookedAt: "2026-03-11", amountCents: -777, dedupeHash: "a" }),
        incoming({ index: 1, bookedAt: "2026-03-19", amountCents: -500, dedupeHash: "b" }),
        incoming({ index: 2, bookedAt: "2026-03-05", amountCents: -900, dedupeHash: "c" }),
      ],
      [
        existing({ id: "e-a", dedupeHash: "b" }),
        existing({ id: "e-c", bookedAt: "2026-03-04", amountCents: -900, dedupeHash: "old-c" }),
      ],
    );

    expect(rows.map((row) => row.hash)).toEqual(["b", "c"]);
  });

  it("ignores zero amounts on both sides", () => {
    expect(findDuplicateCandidates([incoming({ amountCents: 0 })], [existing({ amountCents: 0 })])).toHaveLength(0);
    expect(
      findDuplicateCandidates([incoming({ amountCents: 0, dedupeHash: "same" })], [existing({ dedupeHash: "same" })]),
    ).toHaveLength(0);
    expect(findDuplicateCandidates([incoming()], [existing({ amountCents: 0 })])).toHaveLength(0);
  });

  it("compares dates as UTC days, not as strings", () => {
    // Same two-day gap, different month lengths and a time suffix on one side.
    const [candidate] = findDuplicateCandidates(
      [incoming({ bookedAt: "2026-03-01T00:00:00.000Z" })],
      [existing({ bookedAt: "2026-02-27" })],
    );
    expect(candidate.reason).toBe("same-amount-near-date");
  });

  it("prefers the nearest existing row", () => {
    const [candidate] = findDuplicateCandidates(
      [incoming({ bookedAt: "2026-03-10", merchant: null })],
      [
        existing({ id: "far", bookedAt: "2026-03-07" }),
        existing({ id: "near", bookedAt: "2026-03-10" }),
      ],
    );
    expect(candidate.existing.id).toBe("near");
  });

  it("indexes the existing rows instead of scanning them (20k x 20k)", () => {
    const iso = (offsetDays: number) => new Date(Date.UTC(2025, 0, 1 + offsetDays)).toISOString().slice(0, 10);

    const existingRows: ExistingRow[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      existingRows.push({
        id: `e${i}`,
        bookedAt: iso(i % 360),
        amountCents: -(i % 5_000) - 100,
        description: `HISTORIC ${i}`,
        merchant: `SHOP ${i % 500}`,
        dedupeHash: `old-${i}`,
      });
    }
    const incomingRows: IncomingRow[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      incomingRows.push({
        index: i,
        bookedAt: iso((i % 360) + 500),
        amountCents: -(i % 5_000) - 100,
        description: `INCOMING ${i}`,
        merchant: `SHOP ${i % 500}`,
        dedupeHash: `new-${i}`,
      });
    }

    // A pair that must still be found after the rewrite.
    existingRows.push({
      id: "known-existing",
      bookedAt: "2025-06-01",
      amountCents: -999_999,
      description: "BLOEMIST ROOS",
      merchant: "BLOEMIST ROOS",
      dedupeHash: "known-old",
    });
    incomingRows.push({
      index: 20_000,
      bookedAt: "2025-06-03",
      amountCents: -999_999,
      description: "BLOEMIST ROOS",
      merchant: "BLOEMIST ROOS",
      dedupeHash: "known-new",
    });

    const started = performance.now();
    const found = findDuplicateCandidates(incomingRows, existingRows);
    const elapsed = performance.now() - started;

    // The old nested scan needed 400M comparisons here and took seconds.
    expect(elapsed).toBeLessThan(1_000);
    const known = found.find((row) => row.hash === "known-new");
    expect(known).toMatchObject({
      kind: "LIKELY",
      reason: "same-amount-near-date",
      defaultDecision: "import",
      existing: { id: "known-existing" },
    });
  });
});
