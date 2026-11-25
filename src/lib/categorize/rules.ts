import { prisma } from "@/lib/db";
import type { RuleMatchOn, RuleOperator } from "@/lib/types";

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
    case "REGEX":
      // A user-supplied pattern: an invalid regex must not break an import.
      try {
        return new RegExp(rule.pattern, "i").test(value);
      } catch {
        return false;
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
    prisma.merchantMap.findMany(),
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
