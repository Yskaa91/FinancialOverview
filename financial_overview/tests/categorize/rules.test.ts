import { describe, expect, it, vi } from "vitest";
import { MAX_PATTERN_LENGTH, MAX_REGEX_INPUT, isSafePattern, ruleMatches, type RuleLike } from "@/lib/categorize/rules";

vi.mock("@/lib/db", () => ({ prisma: {} }));

function regexRule(pattern: string): RuleLike {
  return {
    id: "r1",
    name: "test",
    matchOn: "DESCRIPTION",
    operator: "REGEX",
    pattern,
    accountId: null,
    amountMinCents: null,
    amountMaxCents: null,
    categoryId: "c1",
    priority: 100,
    enabled: true,
  };
}

function txn(description: string) {
  return {
    accountId: "a1",
    amountCents: -1250,
    description,
    counterparty: null,
    counterpartyIban: null,
    merchant: null,
  };
}

describe("isSafePattern", () => {
  it("accepts the patterns the app actually creates", () => {
    for (const pattern of ["WONINGSTICHTING", "NS ", "ALBERT HEIJN", "^(SEPA )?Incasso", "A{2,5}"]) {
      expect(isSafePattern(pattern), pattern).toEqual({ safe: true });
    }
  });

  it("accepts ordinary regex structure", () => {
    for (const pattern of ["^ALBERT", "HEIJN$", "[0-9]{2}-[0-9]{2}", "ALBERT|JUMBO", "(JUMBO|LIDL)", "(?:ALBERT|JUMBO)", "(?=ALBERT)", "(?<!X)ALBERT", "\\(test\\)", "[.+*]", "A{2,}"]) {
      expect(isSafePattern(pattern), pattern).toEqual({ safe: true });
    }
  });

  it("rejects the patterns that cause catastrophic backtracking", () => {
    const unsafe = [
      "(a+)+$",
      "(a*)*",
      "(\\w+\\s?)*",
      "(a|aa)+",
      // a quantified alternation, even without inner quantifiers
      "(?:ALBERT|JUMBO)+",
      "a+*",
      "(\\w+)\\1+",
      "a{2,}+",
      "x(a+){2,}",
    ];
    for (const pattern of unsafe) {
      expect(isSafePattern(pattern), pattern).toMatchObject({ safe: false });
    }
  });

  it("rejects empty and over-long patterns", () => {
    expect(isSafePattern("")).toMatchObject({ safe: false, reason: "empty" });
    expect(isSafePattern("   ")).toMatchObject({ safe: false, reason: "empty" });
    expect(isSafePattern("a".repeat(MAX_PATTERN_LENGTH))).toEqual({ safe: true });
    expect(isSafePattern("a".repeat(MAX_PATTERN_LENGTH + 1))).toMatchObject({ safe: false, reason: "too long" });
  });
});

describe("ruleMatches with REGEX", () => {
  it("matches a safe pattern against statement text", () => {
    expect(ruleMatches(regexRule("^ALBERT"), txn("Albert Heijn 1234"))).toBe(true);
    expect(ruleMatches(regexRule("^(SEPA )?Incasso"), txn("SEPA Incasso Jumbo"))).toBe(true);
    expect(ruleMatches(regexRule("^ALBERT"), txn("Jumbo 1234"))).toBe(false);
  });

  it("returns false for a dangerous pattern instead of running it", () => {
    const started = performance.now();
    // 30 characters is enough to hang this pattern for over 30 s when it runs.
    expect(ruleMatches(regexRule("(a+)+$"), txn("a".repeat(30)))).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("returns false for a pattern that does not compile", () => {
    expect(ruleMatches(regexRule("(unclosed"), txn("anything"))).toBe(false);
  });

  it("only shows a long value the first MAX_REGEX_INPUT characters", () => {
    const long = `${"x".repeat(MAX_REGEX_INPUT - 4)}LIDL${"y".repeat(10_000)}`;

    // A match inside the window still works, and the regex never sees the rest.
    expect(ruleMatches(regexRule("LIDL"), txn(long))).toBe(true);
    expect(ruleMatches(regexRule("yyyy"), txn(long))).toBe(false);
    expect(ruleMatches(regexRule("^x{252}LIDL"), txn(long))).toBe(true);
  });
});
