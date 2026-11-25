import { describe, expect, it } from "vitest";
import {
  INDEX_SCALE_1E6,
  estimateValueCents,
  indexAtPeriod,
  isQuarterCode,
  latestPoint,
  quarterCode,
  toIndexMicro,
  type IndexPoint,
} from "@/lib/property/valuation";

const series: IndexPoint[] = [
  { period: "2024KW01", indexMicro: toIndexMicro(120) },
  { period: "2024KW02", indexMicro: toIndexMicro(125) },
  { period: "2024KW03", indexMicro: toIndexMicro(130) },
  { period: "2025KW01", indexMicro: toIndexMicro(133.5) },
];

describe("quarterCode", () => {
  it("maps a date to the CBS quarter", () => {
    expect(quarterCode(new Date("2024-01-15T00:00:00Z"))).toBe("2024KW01");
    expect(quarterCode(new Date("2024-03-31T00:00:00Z"))).toBe("2024KW01");
    expect(quarterCode(new Date("2024-04-01T00:00:00Z"))).toBe("2024KW02");
    expect(quarterCode(new Date("2024-12-31T00:00:00Z"))).toBe("2024KW04");
  });

  it("sorts chronologically as a string", () => {
    const codes = ["2024KW10", "2024KW02", "2024KW01"].sort();
    expect(codes).toEqual(["2024KW01", "2024KW02", "2024KW10"]);
  });
});

describe("isQuarterCode", () => {
  it("accepts quarterly codes and rejects the yearly ones CBS also ships", () => {
    expect(isQuarterCode("2024KW03")).toBe(true);
    expect(isQuarterCode("2024JJ00")).toBe(false);
    expect(isQuarterCode("2024KW3")).toBe(false);
  });
});

describe("indexAtPeriod", () => {
  it("takes the newest quarter at or before the wanted one", () => {
    expect(indexAtPeriod(series, "2024KW02")?.period).toBe("2024KW02");
    expect(indexAtPeriod(series, "2024KW04")?.period).toBe("2024KW03");
  });

  it("returns null when the purchase predates the series", () => {
    expect(indexAtPeriod(series, "2019KW04")).toBeNull();
  });
});

describe("latestPoint", () => {
  it("is the newest quarter regardless of the input order", () => {
    expect(latestPoint([...series].reverse())?.period).toBe("2025KW01");
    expect(latestPoint([])).toBeNull();
  });
});

describe("estimateValueCents", () => {
  it("moves the purchase price by the index ratio", () => {
    // Bought at 4 ton in a 120.0 quarter, now 133.5: 400000 * 133.5 / 120.
    expect(estimateValueCents(40_000_000, toIndexMicro(120), toIndexMicro(133.5))).toBe(44_500_000);
  });

  it("falls back to nothing when a side of the ratio is missing", () => {
    expect(estimateValueCents(40_000_000, null, toIndexMicro(133.5))).toBeNull();
    expect(estimateValueCents(40_000_000, toIndexMicro(120), null)).toBeNull();
    expect(estimateValueCents(40_000_000, 0, toIndexMicro(133.5))).toBeNull();
  });

  it("keeps the price intact when the index did not move", () => {
    expect(estimateValueCents(40_000_000, toIndexMicro(120), toIndexMicro(120))).toBe(40_000_000);
  });

  it("stores the index scaled by a million, so cents stay integers", () => {
    expect(toIndexMicro(133.5)).toBe(133_500_000);
    expect(Number.isInteger(toIndexMicro(133.5))).toBe(true);
    expect(INDEX_SCALE_1E6).toBe(1_000_000);
  });
});
