import { describe, expect, it } from "vitest";
import { formatDay, parseStatementDate } from "@/lib/dates";

// ASN ships "25-3-2025" (not zero padded), ICS "01-10-2026", PayPal ISO or
// DD/MM/YYYY depending on the account language.
describe("parseStatementDate", () => {
  it("parses Dutch day-first dates, padded or not", () => {
    expect(parseStatementDate("25-3-2025")?.toISOString()).toBe("2025-03-25T00:00:00.000Z");
    expect(parseStatementDate("01-10-2026")?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(parseStatementDate("1/2/2024")?.toISOString()).toBe("2024-02-01T00:00:00.000Z");
  });

  it("parses ISO dates", () => {
    expect(parseStatementDate("2026-01-31")?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("assumes 20xx for two-digit years", () => {
    expect(parseStatementDate("31-12-24")?.toISOString()).toBe("2024-12-31T00:00:00.000Z");
  });

  it("rejects impossible dates and junk", () => {
    expect(parseStatementDate("31-02-2026")).toBeNull();
    expect(parseStatementDate("2026-13-01")).toBeNull();
    expect(parseStatementDate("morgen")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
  });
});

describe("formatDay", () => {
  it("renders Dutch order", () => {
    expect(formatDay(new Date("2026-01-31T00:00:00.000Z"))).toBe("31-01-2026");
  });
});
