import { describe, expect, it } from "vitest";
import {
  formatCents,
  formatCentsSigned,
  parseAmountToCents,
  quantityToMicro,
  toBaseCents,
} from "@/lib/money";

// The parsers trust these functions with every amount in the app, so the odd
// inputs get the tests, not the happy path alone.
describe("parseAmountToCents", () => {
  it("reads Dutch decimals", () => {
    expect(parseAmountToCents("1.234,56")).toBe(123456);
    expect(parseAmountToCents("12,5")).toBe(1250);
    expect(parseAmountToCents("-12,50")).toBe(-1250);
  });

  it("reads dot decimals and ASN's dot-decimal format", () => {
    expect(parseAmountToCents("12.50")).toBe(1250);
    expect(parseAmountToCents("-54.16")).toBe(-5416);
    expect(parseAmountToCents("1234.56")).toBe(123456);
  });

  it("strips currency symbols and thousands separators", () => {
    expect(parseAmountToCents("€ 1.234,56")).toBe(123456);
    expect(parseAmountToCents("1 234,56")).toBe(123456);
    expect(parseAmountToCents("1,234.56")).toBe(123456);
  });

  it("rounds half up on the third decimal", () => {
    expect(parseAmountToCents("0,005")).toBe(1);
    expect(parseAmountToCents("0,004")).toBe(0);
    expect(parseAmountToCents("-0,005")).toBe(-1);
  });

  it("treats a lone dot with three digits as a thousands group", () => {
    expect(parseAmountToCents("1.234")).toBe(123400);
    expect(parseAmountToCents("1.234.567")).toBe(123456700);
    expect(parseAmountToCents("1234.567")).toBeNull(); // neither grouping nor cents
  });

  it("returns null instead of 0 for junk", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("-")).toBeNull();
    expect(parseAmountToCents("1,2,3")).toBeNull();
  });

  it("round trips through the formatter", () => {
    for (const cents of [0, 5, -5, 123456, -987654]) {
      expect(parseAmountToCents(formatCents(cents).replace("€", ""))).toBe(cents);
    }
  });
});

describe("formatCentsSigned", () => {
  it("marks the sign on both sides", () => {
    expect(formatCentsSigned(-1250)).toContain("−");
    expect(formatCentsSigned(1250)).toContain("+");
  });
});

describe("toBaseCents", () => {
  it("converts with a micro rate", () => {
    expect(toBaseCents(1000, 1_080_000)).toBe(1080);
    expect(toBaseCents(1000, null)).toBe(1000);
  });
});

describe("quantityToMicro", () => {
  it("keeps six decimals", () => {
    expect(quantityToMicro("1,234567")).toBe(1234567);
    expect(quantityToMicro("10")).toBe(10_000_000);
    expect(quantityToMicro("nope")).toBeNull();
  });
});
