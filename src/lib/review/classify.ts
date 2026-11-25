// Turns the parsed rows of an import preview into review groups: one merchant,
// one decision. Pure until the last step, where rules, merchant memory and the
// history counts are read once each.

import { prisma } from "@/lib/db";
import { loadCategoriser, resolveCategory, type RuleLike } from "@/lib/categorize/rules";
import {
  dominantAmountCents,
  groupLabel,
  isRecurring,
  loadMerchantHistory,
  merchantKeyOf,
} from "@/lib/categorize/recurrence";
import { findTransfersCategoryId, isAccountTransfer, loadOwnAccounts, type OwnAccount } from "@/lib/categorize/transfers";
import type { CategoryKind } from "@/lib/types";
import type { CategoryOption, ReviewGroup, ReviewMatch, ReviewRow } from "./types";

export type PreviewInputRow = {
  bookedAt: string;
  amountCents: number;
  description: string;
  merchant: string | null;
  /** Needed by the rule engine: COUNTERPARTY and IBAN rules match on these. */
  counterparty?: string | null;
  counterpartyIban?: string | null;
};

/** One merchant's worth of preview rows, before rules or history are consulted. */
export type PreviewGroup = {
  key: string;
  label: string;
  rows: ReviewRow[];
  /** Kept beside the review rows so rules can see what they matched in the import. */
  sources: PreviewInputRow[];
  totalCents: number;
  /** The amount most rows share: one figure per group is all the AI needs. */
  amountCents: number;
};

/** Pure grouping and totalling. The only part of this file with no database. */
export function groupRows(rows: PreviewInputRow[]): PreviewGroup[] {
  const groups = new Map<string, PreviewGroup>();
  rows.forEach((row, index) => {
    const key = merchantKeyOf(row);
    const group = groups.get(key) ?? {
      key,
      label: groupLabel(row),
      rows: [],
      sources: [],
      totalCents: 0,
      amountCents: 0,
    };
    group.sources.push(row);
    group.rows.push({
      index,
      bookedAt: row.bookedAt,
      amountCents: row.amountCents,
      description: row.description,
      merchant: row.merchant,
    });
    group.totalCents += row.amountCents;
    groups.set(key, group);
  });

  for (const group of groups.values()) {
    group.amountCents = dominantAmountCents(group.rows.map((row) => row.amountCents));
  }
  return [...groups.values()];
}

/**
 * Groups rows by merchantKey, resolves rule/merchant-memory matches, attaches
 * history. `accountId` lets account-scoped rules match; omit it and only
 * account-agnostic rules apply.
 *
 * A row that moves money between the user's own accounts matches the Transfers
 * system category instead of a rule. When that category does not exist the
 * detection is skipped: a read path must never create data.
 */
export async function classifyPreview(
  rows: PreviewInputRow[],
  previous?: ReviewGroup[],
  accountId?: string,
): Promise<ReviewGroup[]> {
  const groups = groupRows(rows);
  const [{ rules, merchantMap }, ownAccounts, transfersId] = await Promise.all([
    loadCategoriser(),
    loadOwnAccounts(),
    findTransfersCategoryId(),
  ]);
  const history = await loadMerchantHistory(groups.map((group) => group.key));
  const ruleNameById = new Map(rules.map((rule) => [rule.id, rule.name]));
  const before = new Map((previous ?? []).map((group) => [group.key, group]));

  const classified = groups.map((group): ReviewGroup => {
    const historyHits = history.get(group.key)?.hits ?? 0;
    const earlier = before.get(group.key);
    return {
      key: group.key,
      label: group.label,
      rows: group.rows,
      totalCents: group.totalCents,
      historyHits,
      recurring: isRecurring(historyHits, group.rows.length),
      match:
        transferMatch(group, ownAccounts, transfersId, accountId) ??
        groupMatch(group, rules, merchantMap, ruleNameById, accountId),
      proposedCategoryId: earlier?.proposedCategoryId ?? null,
      proposal: earlier?.proposal ?? "NONE",
    };
  });

  // Unmatched first, biggest amounts first: the dialog leads with what matters.
  return classified.sort(compareGroups);
}

export async function loadCategoryOptions(): Promise<CategoryOption[]> {
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    kind: category.kind as CategoryKind,
  }));
}

/** Any row of the group moving money between own accounts makes the group a transfer. */
function transferMatch(
  group: PreviewGroup,
  own: OwnAccount[],
  transfersId: string | null,
  accountId?: string,
): ReviewMatch | null {
  if (!transfersId) return null;
  const hit = group.sources.some((row) =>
    isAccountTransfer(
      {
        accountId,
        description: row.description,
        counterparty: row.counterparty,
        counterpartyIban: row.counterpartyIban,
      },
      own,
    ),
  );
  return hit ? { ruleId: "", ruleName: "Account transfer", categoryId: transfersId } : null;
}

/** The group's rows agree on one category, or the group has no match. */
function groupMatch(
  group: PreviewGroup,
  rules: RuleLike[],
  merchantMap: Map<string, string>,
  ruleNameById: Map<string, string>,
  accountId?: string,
): ReviewMatch | null {
  let shared: { ruleId: string; categoryId: string } | null = null;
  for (const row of group.sources) {
    const hit = resolveCategory(
      {
        accountId: accountId ?? "",
        amountCents: row.amountCents,
        description: row.description,
        counterparty: row.counterparty ?? null,
        counterpartyIban: row.counterpartyIban ?? null,
        merchant: row.merchant,
      },
      rules,
      merchantMap,
    );
    const current = hit ? { ruleId: hit.ruleId ?? "", categoryId: hit.categoryId } : null;
    if (!current) return null;
    if (shared && (shared.ruleId !== current.ruleId || shared.categoryId !== current.categoryId)) return null;
    shared = current;
  }
  if (!shared) return null;
  return {
    ruleId: shared.ruleId,
    ruleName: shared.ruleId ? (ruleNameById.get(shared.ruleId) ?? "Rule") : "Merchant memory",
    categoryId: shared.categoryId,
  };
}

function compareGroups(a: ReviewGroup, b: ReviewGroup): number {
  const matched = Number(Boolean(a.match)) - Number(Boolean(b.match));
  if (matched !== 0) return matched;
  const weight = Math.abs(b.totalCents) - Math.abs(a.totalCents);
  return weight !== 0 ? weight : a.key.localeCompare(b.key);
}
