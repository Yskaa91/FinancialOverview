import { describe, expect, it } from "vitest";
import { eurostatPeriod, parseEurostatSeries } from "@/lib/property/eurostat";
import { COUNTRIES, findCountry, hasMunicipalities } from "@/lib/property/countries";
import { toIndexMicro } from "@/lib/property/valuation";

describe("eurostatPeriod", () => {
  it("maps a Eurostat quarter to the code the rest of the app compares", () => {
    expect(eurostatPeriod("2024-Q1")).toBe("2024KW01");
    expect(eurostatPeriod("2024-Q4")).toBe("2024KW04");
  });

  it("ignores anything that is not a quarter", () => {
    expect(eurostatPeriod("2024")).toBeNull();
    expect(eurostatPeriod("2024-Q5")).toBeNull();
    expect(eurostatPeriod("2024-KW02")).toBeNull();
  });
});

describe("parseEurostatSeries", () => {
  // Shape of a real prc_hpi_q answer with purchase, unit, geo and freq pinned.
  const payload = {
    id: ["freq", "purchase", "unit", "geo", "time"],
    size: [1, 1, 1, 1, 3],
    dimension: {
      time: { category: { index: { "2025-Q1": 0, "2025-Q2": 1, "2025-Q3": 2 } } },
    },
    value: { "0": 151.5, "1": 153.0, "2": 154.2 },
  };

  it("turns the flat value map into quarterly points", () => {
    expect(parseEurostatSeries(payload)).toEqual([
      { period: "2025KW01", indexMicro: toIndexMicro(151.5) },
      { period: "2025KW02", indexMicro: toIndexMicro(153) },
      { period: "2025KW03", indexMicro: toIndexMicro(154.2) },
    ]);
  });

  it("sorts oldest first whatever order the rows arrive in", () => {
    const shuffled = {
      ...payload,
      dimension: { time: { category: { index: { "2025-Q3": 0, "2025-Q1": 1, "2025-Q2": 2 } } } },
      value: { "0": 154.2, "1": 151.5, "2": 153.0 },
    };
    expect(parseEurostatSeries(shuffled).map((p) => p.period)).toEqual([
      "2025KW01",
      "2025KW02",
      "2025KW03",
    ]);
  });

  it("finds the time axis even when it is not last", () => {
    const reordered = {
      id: ["time", "geo"],
      size: [2, 1],
      dimension: { time: { category: { index: { "2025-Q1": 0, "2025-Q2": 1 } } } },
      value: { "0": 151.5, "1": 153.0 },
    };
    expect(parseEurostatSeries(reordered).map((p) => p.period)).toEqual(["2025KW01", "2025KW02"]);
  });

  it("skips junk values instead of writing a broken estimate", () => {
    const junk = { ...payload, value: { "0": null, "1": 153.0, "2": 0 } };
    expect(parseEurostatSeries(junk).map((p) => p.period)).toEqual(["2025KW02"]);
  });

  it("returns an empty series for a payload without a time axis", () => {
    expect(parseEurostatSeries(null)).toEqual([]);
    expect(parseEurostatSeries({ value: { "0": 1 } })).toEqual([]);
  });
});

describe("countries", () => {
  it("covers Europe beyond the Netherlands", () => {
    expect(COUNTRIES.length).toBeGreaterThan(20);
    expect(findCountry("DE")?.name).toBe("Germany");
    expect(findCountry(" de ")?.name).toBe("Germany");
    expect(findCountry("XX")).toBeNull();
  });

  it("only the Netherlands is valued per municipality", () => {
    expect(hasMunicipalities("NL")).toBe(true);
    expect(hasMunicipalities("DE")).toBe(false);
  });
});
