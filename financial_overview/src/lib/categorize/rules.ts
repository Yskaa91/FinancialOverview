import { prisma } from "@/lib/db";
import type { RuleMatchOn, RuleOperator } from "@/lib/types";

/** Longest pattern we accept; longer ones are refused at write time and at match time. */
export const MAX_PATTERN_LENGTH = 120;
/** Longest input a user regex is ever run against. */
export const MAX_REGEX_INPUT = 256;

/**
 * Rejects the constructs that cause catastrophic backtracking: nested or stacked
 * quantifiers, a quantified group that itself contains a quantifier, and
 * backreferences under a quantifier. Deliberately conservative: a false positive
 * costs the user an EQUALS/CONTAINS rule, a false negative costs the event loop.
 *
 * A quantified group is also refused when it contains an alternation, because
 * `(a|aa)+` backtracks exponentially even though no inner quantifier is present.
 */
export function isSafePattern(pattern: string): { safe: boolean; reason?: string } {
  const text = pattern ?? "";
  if (text.trim() === "") return { safe: false, reason: "empty" };
  if (text.length > MAX_PATTERN_LENGTH) return { safe: false, reason: "too long" };

  const groups: { alternation: boolean; quantified: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // Escapes: `\(` is a literal, `\1` is a backreference.
    if (ch === "\\") {
      if (/\d/.test(text[i + 1] ?? "") && isRepeater(text, quantifierEnd(text, i + 2))) {
        return { safe: false, reason: "quantified backreference" };
      }
      i += 2;
      continue;
    }

    // A character class: quantifiers and parens inside it are literal.
    if (ch === "[") {
      i = classEnd(text, i);
      continue;
    }

    if (ch === "(") {
      groups.push({ alternation: false, quantified: false });
      // `(?:` / `(?=` / `(?<name>`: the `?` is group syntax, not a quantifier.
      i += text[i + 1] === "?" ? 2 : 1;
      continue;
    }

    if (ch === ")") {
      const group = groups.pop();
      i += 1;
      if (!group || !isRepeater(text, quantifierEnd(text, i))) continue;
      if (group.quantified) return { safe: false, reason: "nested quantifier" };
      if (group.alternation) return { safe: false, reason: "quantified alternation" };
      continue;
    }

    if (ch === "|") {
      for (const group of groups) group.alternation = true;
      i += 1;
      continue;
    }

    const end = quantifierEnd(text, i);
    if (end < 0) {
      i += 1;
      continue;
    }
    // `a+*` / `a{2,}+`: two quantifiers on one atom.
    if (isRepeater(text, quantifierEnd(text, end))) return { safe: false, reason: "stacked quantifier" };
    for (const group of groups) group.quantified = true;
    i = end;
  }

  return { safe: true };
}

/** End index of a quantifier token at `start`, or -1 when there is none. */
function quantifierEnd(text: string, start: number): number {
  const ch = text[start];
  if (ch === "*" || ch === "+" || ch === "?") return start + 1;
  if (ch !== "{") return -1;
  const match = /^\{\d+(?:,\d*)?\}/.exec(text.slice(start));
  return match ? start + match[0].length : -1;
}

/** True for a real repeater: `?` on its own is lazy when it follows a quantifier. */
function isRepeater(text: string, end: number): boolean {
  return end > 0 && text[end - 1] !== "?";
}

/** Index just past the character class starting at `start`. */
function classEnd(text: string, start: number): number {
  let i = start + 1;
  if (text[i] === "^") i += 1;
  if (text[i] === "]") i += 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === "]") return i + 1;
    i += 1;
  }
  return text.length;
}

export type RuleLike = {
  id: string;
  name: string;
  matchOn: RuleMatchOn;
  operator: RuleOperator;
  pattern: string;
  accountId: string | null;
  amountMinCents: number | null;
  amountMaxCents: number | null;
  categoryId: string;
  priority: number;
  enabled: boolean;
};

export type TxnForRules = {
  accountId: string;
  amountCents: number;
  description: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  merchant: string | null;
};

/** Which field a rule looks at, as the transaction presents it. */
export function ruleValue(txn: TxnForRules, matchOn: RuleMatchOn): string | null {
  switch (matchOn) {
    case "DESCRIPTION":
      return txn.description;
    case "COUNTERPARTY":
      return txn.counterparty;
    case "IBAN":
      return txn.counterpartyIban;
    case "MERCHANT":
      return txn.merchant;
  }
}

export function ruleMatches(rule: RuleLike, txn: TxnForRules): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId && rule.accountId !== txn.accountId) return false;
  const magnitude = Math.abs(txn.amountCents);
  if (rule.amountMinCents !== null && magnitude < rule.amountMinCents) return false;
  if (rule.amountMaxCents !== null && magnitude > rule.amountMaxCents) return false;

  const value = ruleValue(txn, rule.matchOn);
  if (!value) return false;

  switch (rule.operator) {
    case "CONTAINS":
      return value.toUpperCase().includes(rule.pattern.toUpperCase());
    case "EQUALS":
      return value.toUpperCase() === rule.pattern.toUpperCase();
    case "REGEX": {
      // A user-supplied pattern is untrusted input: refuse anything that can
      // backtrack catastrophically, and never show it more than MAX_REGEX_INPUT
      // characters, so one stored rule cannot wedge the event loop.
      if (!isSafePattern(rule.pattern).safe) return false;
      try {
        return new RegExp(rule.pattern, "i").test(value.slice(0, MAX_REGEX_INPUT));
      } catch {
        return false;
      }
    }
  }
}

/**
 * Resolution order: merchant memory first (one confirmation per shop beats any
 * rule), then rules by priority, lowest number wins.
 */
export function resolveCategory(
  txn: TxnForRules,
  rules: RuleLike[],
  merchantMap: Map<string, string>,
): { categoryId: string; source: "RULE"; ruleId?: string } | null {
  if (txn.merchant) {
    const known = merchantMap.get(txn.merchant.toUpperCase());
    if (known) return { categoryId: known, source: "RULE" };
  }

  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const hit = ordered.find((rule) => ruleMatches(rule, txn));
  return hit ? { categoryId: hit.categoryId, source: "RULE", ruleId: hit.id } : null;
}

export async function loadCategoriser() {
  const [rules, merchants] = await Promise.all([
    prisma.rule.findMany({ where: { enabled: true } }),
    // source "AI" entries are proposals, not decisions: they may fill a
    // suggestion but never apply a category on their own.
    prisma.merchantMap.findMany({ where: { NOT: { source: "AI" } } }),
  ]);
  return {
    rules: rules as RuleLike[],
    merchantMap: new Map(merchants.map((m) => [m.merchantKey.toUpperCase(), m.categoryId])),
  };
}

/**
 * Applies the categoriser to every uncategorised transaction. MANUAL is final and
 * never touched. Returns how many rows changed, per source.
 */
export async function categoriseUncategorised(): Promise<{ byRule: number; byMerchant: number }> {
  const { rules, merchantMap } = await loadCategoriser();
  const pending = await prisma.transaction.findMany({
    where: { categorySource: { in: ["NONE", "AI"] } },
  });

  let byRule = 0;
  let byMerchant = 0;
  for (const txn of pending) {
    const hit = resolveCategory(txn, rules, merchantMap);
    if (!hit) continue;
    await prisma.transaction.update({
      where: { id: txn.id },
      data: { categoryId: hit.categoryId, categorySource: "RULE", reviewState: "OK" },
    });
    if (hit.ruleId) {
      await prisma.rule.update({ where: { id: hit.ruleId }, data: { hits: { increment: 1 } } });
      byRule += 1;
    } else {
      byMerchant += 1;
    }
  }
  return { byRule, byMerchant };
}

/**
 * Records a manual correction: the transaction becomes authoritative and the
 * merchant is remembered, so the same shop never asks again.
 */
export async function confirmCategory(
  transactionId: string,
  categoryId: string,
): Promise<{ learnedMerchantKey: string | null; sameMerchant: number }> {
  const txn = await prisma.transaction.update({
    where: { id: transactionId },
    data: { categoryId, categorySource: "MANUAL", reviewState: "OK", categoryConfidence: null },
  });

  if (!txn.merchant) return { learnedMerchantKey: null, sameMerchant: 0 };
  const merchantKey = txn.merchant.toUpperCase();

  await prisma.merchantMap.upsert({
    where: { merchantKey },
    create: { merchantKey, categoryId, source: "MANUAL" },
    update: { categoryId, source: "MANUAL", hits: { increment: 1 } },
  });

  const sameMerchant = await prisma.transaction.count({
    where: { merchant: txn.merchant, categoryId: null },
  });
  return { learnedMerchantKey: merchantKey, sameMerchant };
}

/** "Apply to all N similar" — the one click that clears a whole merchant. */
export async function applyMerchantToSimilar(
  merchant: string,
  categoryId: string,
): Promise<number> {
  const result = await prisma.transaction.updateMany({
    where: { merchant, categoryId: null },
    data: { categoryId, categorySource: "RULE", reviewState: "OK", categoryConfidence: null },
  });
  await prisma.merchantMap.upsert({
    where: { merchantKey: merchant.toUpperCase() },
    create: { merchantKey: merchant.toUpperCase(), categoryId, source: "MANUAL" },
    update: { categoryId, source: "MANUAL" },
  });
  return result.count;
}
