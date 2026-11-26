import { describe, expect, it } from "vitest";
import {
  comparePeriod,
  comparisonRows,
  dayBounds,
  formatChangePercent,
  isFuture,
  parsePeriod,
  periodOf,
  previousPeriod,
  shiftPeriod,
  tryParsePeriod,
  withKind,
  yearAgoPeriod,
  type CategoryTotal,
} from "@/lib/periods";

const NOW = new Date("2026-11-25T12:00:00.000Z");

describe("parsePeriod", () => {
  it("parses a month key", () => {
    const period = parsePeriod("2026-11", NOW);
    expect(period.kind).toBe("month");
    expect(period.key).toBe("2026-11");
    expect(period.label).toBe("November 2026");
    expect(period.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("parses a quarter key", () => {
    const period = parsePeriod("2026-Q4", NOW);
    expect(period.kind).toBe("quarter");
    expect(period.key).toBe("2026-Q4");
    expect(period.label).toBe("Q4 2026");
    expect(period.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("parses a year key", () => {
    const period = parsePeriod("2025", NOW);
    expect(period.kind).toBe("year");
    expect(period.label).toBe("2025");
    expect(period.start.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("round-trips its own key", () => {
    for (const key of ["2026-11", "2026-Q4", "2024"]) {
      expect(parsePeriod(parsePeriod(key, NOW).key, NOW).key).toBe(key);
    }
  });

  it("falls back to the current month on anything unrecognised", () => {
    for (const raw of [undefined, "", "nonsense", "2026-13", "2026-Q5", "26-11", "2026-11-25"]) {
      const period = parsePeriod(raw, NOW);
      expect(period.key).toBe("2026-11");
    }
  });

  it("accepts a single-digit month and an array from searchParams", () => {
    expect(parsePeriod("2026-1", NOW).key).toBe("2026-01");
    expect(parsePeriod(["2026-03", "2026-04"], NOW).key).toBe("2026-03");
  });
});

describe("tryParsePeriod", () => {
  it("returns null instead of guessing", () => {
    expect(tryParsePeriod("2026-11")?.key).toBe("2026-11");
    expect(tryParsePeriod("nonsense")).toBeNull();
    expect(tryParsePeriod("2026-13")).toBeNull();
    expect(tryParsePeriod(undefined)).toBeNull();
  });
});

describe("comparePeriod", () => {
  const month = parsePeriod("2026-11", NOW);
  const quarter = parsePeriod("2026-Q4", NOW);
  const year = parsePeriod("2026", NOW);

  it("defaults to the period right before the shown one", () => {
    expect(comparePeriod(undefined, month)?.key).toBe("2026-10");
    expect(comparePeriod("", quarter)?.key).toBe("2026-Q3");
    expect(comparePeriod("nonsense", year)?.key).toBe("2025");
  });

  it("switches the comparison off", () => {
    expect(comparePeriod("off", month)).toBeNull();
    expect(comparePeriod("OFF", quarter)).toBeNull();
  });

  it("takes a picked period in the length of the shown one", () => {
    expect(comparePeriod("2025-11", month)?.key).toBe("2025-11");
    expect(comparePeriod("2025-11", quarter)?.key).toBe("2025-Q4");
    expect(comparePeriod("2024-Q2", year)?.key).toBe("2024");
    expect(comparePeriod("2024", month)?.key).toBe("2024-01");
  });

  it("steps back rather than compare a period with itself", () => {
    expect(comparePeriod("2026-11", month)?.key).toBe("2026-10");
    expect(comparePeriod("2026-q4", quarter)?.key).toBe("2026-Q3");
    expect(comparePeriod("2026", year)?.key).toBe("2025");
  });
});

describe("shiftPeriod", () => {
  it("walks months across the year boundary", () => {
    expect(previousPeriod(parsePeriod("2026-01", NOW)).key).toBe("2025-12");
    expect(shiftPeriod(parsePeriod("2026-12", NOW), 1).key).toBe("2027-01");
    expect(shiftPeriod(parsePeriod("2026-11", NOW), -11).key).toBe("2025-12");
  });

  it("walks quarters and years by their own step", () => {
    expect(previousPeriod(parsePeriod("2026-Q1", NOW)).key).toBe("2025-Q4");
    expect(shiftPeriod(parsePeriod("2026-Q4", NOW), 1).key).toBe("2027-Q1");
    expect(shiftPeriod(parsePeriod("2026", NOW), 1).key).toBe("2027");
    expect(shiftPeriod(parsePeriod("2026", NOW), -1).key).toBe("2025");
  });

  it("keeps the period length, never half a month", () => {
    const month = parsePeriod("2026-02", NOW);
    expect(previousPeriod(month).label).toBe("January 2026");
    expect(month.end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("periodOf", () => {
  it("finds the month, quarter and year holding a date", () => {
    const ref = new Date("2026-11-25T00:00:00.000Z");
    expect(periodOf("month", ref).key).toBe("2026-11");
    expect(periodOf("quarter", ref).key).toBe("2026-Q4");
    expect(periodOf("year", ref).key).toBe("2026");
  });

  it("puts the first and last day of a quarter on the right side", () => {
    expect(periodOf("quarter", new Date("2026-07-01T00:00:00.000Z")).key).toBe("2026-Q3");
    expect(periodOf("quarter", new Date("2026-09-30T00:00:00.000Z")).key).toBe("2026-Q3");
    expect(periodOf("quarter", new Date("2026-10-01T00:00:00.000Z")).key).toBe("2026-Q4");
  });
});

describe("yearAgoPeriod", () => {
  it("compares the same calendar slot a year earlier", () => {
    expect(yearAgoPeriod(parsePeriod("2026-11", NOW)).key).toBe("2025-11");
    expect(yearAgoPeriod(parsePeriod("2026-Q4", NOW)).key).toBe("2025-Q4");
    expect(yearAgoPeriod(parsePeriod("2026", NOW)).key).toBe("2025");
    expect(yearAgoPeriod(parsePeriod("2024-02", NOW)).label).toBe("February 2023");
  });
});

describe("withKind", () => {
  it("keeps the anchor date and changes the length", () => {
    const november = parsePeriod("2026-11", NOW);
    expect(withKind(november, "quarter").key).toBe("2026-Q4");
    expect(withKind(november, "year").key).toBe("2026");
    expect(withKind(parsePeriod("2026-Q2", NOW), "month").key).toBe("2026-04");
  });
});

describe("isFuture", () => {
  it("is true only for a period that has not started", () => {
    expect(isFuture(parsePeriod("2026-12", NOW), NOW)).toBe(true);
    expect(isFuture(parsePeriod("2026-11", NOW), NOW)).toBe(false);
    expect(isFuture(parsePeriod("2025", NOW), NOW)).toBe(false);
  });
});

describe("dayBounds", () => {
  it("gives inclusive from/to dates for a transaction filter", () => {
    expect(dayBounds(parsePeriod("2026-11", NOW))).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });

  it("handles February in a leap year", () => {
    expect(dayBounds(parsePeriod("2028-02", NOW)).to).toBe("2028-02-29");
    expect(dayBounds(parsePeriod("2023", NOW)).to).toBe("2023-12-31");
  });
});

const total = (
  id: string | null,
  name: string,
  cents: number,
): CategoryTotal => ({ id, name, color: null, cents });

describe("comparisonRows", () => {
  it("lines up categories that appear in both periods", () => {
    const rows = comparisonRows(
      [total("g", "Groceries", 30_000), total("r", "Rent", 100_000)],
      [total("g", "Groceries", 20_000), total("r", "Rent", 100_000)],
    );
    expect(rows.map((row) => [row.name, row.currentCents, row.otherCents, row.deltaCents])).toEqual([
      ["Rent", 100_000, 100_000, 0],
      ["Groceries", 30_000, 20_000, 10_000],
    ]);
  });

  it("keeps a category that only one period has, signed by the difference", () => {
    const started = comparisonRows([total("s", "Streaming", 1_299)], []);
    expect(started).toEqual([
      {
        id: "s",
        name: "Streaming",
        color: null,
        currentCents: 1_299,
        otherCents: 0,
        deltaCents: 1_299,
      },
    ]);

    const cancelled = comparisonRows([], [total("s", "Streaming", 1_299)]);
    expect(cancelled[0].deltaCents).toBe(-1_299);
  });

  it("keeps uncategorised separate and takes the current side's label", () => {
    const rows = comparisonRows(
      [total(null, "Uncategorised", 5_000)],
      [total("m", "Misc", 1_000), total(null, "Uncategorised", 2_000)],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === null)?.deltaCents).toBe(3_000);
    expect(rows.find((row) => row.id === "m")?.name).toBe("Misc");
  });

  it("orders by the current period, then by the other one, then by name", () => {
    const rows = comparisonRows(
      [total("a", "Alpha", 100), total("b", "Beta", 900), total("c", "Gamma", 900)],
      [total("d", "Delta", 5_000)],
    );
    expect(rows.map((row) => row.name)).toEqual(["Beta", "Gamma", "Alpha", "Delta"]);
  });
});

describe("formatChangePercent", () => {
  it("signs the change against the earlier period", () => {
    expect(formatChangePercent(1_800, 10_000)).toBe("+18%");
    expect(formatChangePercent(-400, 10_000)).toBe("−4%");
    expect(formatChangePercent(0, 10_000)).toBe("0%");
  });

  it("keeps one decimal so a small change does not read as zero", () => {
    expect(formatChangePercent(-316, 429_794)).toBe("−0,1%");
    expect(formatChangePercent(-3_700, 100_000)).toBe("−3,7%");
    expect(formatChangePercent(2, 1_000_000)).toBe("0%");
  });

  it("does not invent a percentage without a base", () => {
    expect(formatChangePercent(0, 0)).toBe("—");
    expect(formatChangePercent(1_299, 0)).toBe("new");
    expect(formatChangePercent(-1_299, 0)).toBe("new");
  });
});
