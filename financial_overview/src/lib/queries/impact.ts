// What a delete would cost, computed before the user is asked to confirm one.
// Both maps are keyed by id so a page can look up every row it renders without a
// round trip when a dialog opens.

import { prisma } from "@/lib/db";

export type AccountImpact = {
  /** Cascade-deleted with the account, not orphaned. */
  transactions: number;
  statements: number;
  trades: number;
  snapshots: number;
  /** Rules scoped to this account; they go too. */
  rules: number;
};

export type CategoryImpact = {
  /** These are kept but lose their category: they become uncategorised. */
  transactions: number;
  /** Cascade-deleted. */
  rules: number;
  /** Children move up to the top level rather than disappearing. */
  children: number;
  /** Merchant memory pointing at this category is removed. */
  merchantMemory: number;
};

export async function loadAccountImpact(): Promise<Map<string, AccountImpact>> {
  const [transactions, statements, trades, snapshots, rules] = await Promise.all([
    prisma.transaction.groupBy({ by: ["accountId"], _count: { _all: true } }),
    prisma.statement.groupBy({ by: ["accountId"], _count: { _all: true } }),
    prisma.trade.groupBy({ by: ["accountId"], _count: { _all: true } }),
    prisma.snapshot.groupBy({ by: ["accountId"], _count: { _all: true } }),
    prisma.rule.groupBy({ by: ["accountId"], _count: { _all: true } }),
  ]);

  const impact = new Map<string, AccountImpact>();
  const touch = (id: string | null) => {
    if (!id) return null;
    const current = impact.get(id) ?? {
      transactions: 0,
      statements: 0,
      trades: 0,
      snapshots: 0,
      rules: 0,
    };
    impact.set(id, current);
    return current;
  };

  for (const row of transactions) {
    const entry = touch(row.accountId);
    if (entry) entry.transactions = row._count._all;
  }
  for (const row of statements) {
    const entry = touch(row.accountId);
    if (entry) entry.statements = row._count._all;
  }
  for (const row of trades) {
    const entry = touch(row.accountId);
    if (entry) entry.trades = row._count._all;
  }
  for (const row of snapshots) {
    const entry = touch(row.accountId);
    if (entry) entry.snapshots = row._count._all;
  }
  for (const row of rules) {
    const entry = touch(row.accountId);
    if (entry) entry.rules = row._count._all;
  }

  return impact;
}

export async function loadCategoryImpact(): Promise<Map<string, CategoryImpact>> {
  const [transactions, rules, children, merchantMemory] = await Promise.all([
    prisma.transaction.groupBy({ by: ["categoryId"], _count: { _all: true } }),
    prisma.rule.groupBy({ by: ["categoryId"], _count: { _all: true } }),
    prisma.category.groupBy({ by: ["parentId"], _count: { _all: true } }),
    prisma.merchantMap.groupBy({ by: ["categoryId"], _count: { _all: true } }),
  ]);

  const impact = new Map<string, CategoryImpact>();
  const touch = (id: string | null) => {
    if (!id) return null;
    const current = impact.get(id) ?? { transactions: 0, rules: 0, children: 0, merchantMemory: 0 };
    impact.set(id, current);
    return current;
  };

  for (const row of transactions) {
    const entry = touch(row.categoryId);
    if (entry) entry.transactions = row._count._all;
  }
  for (const row of rules) {
    const entry = touch(row.categoryId);
    if (entry) entry.rules = row._count._all;
  }
  for (const row of children) {
    const entry = touch(row.parentId);
    if (entry) entry.children = row._count._all;
  }
  for (const row of merchantMemory) {
    const entry = touch(row.categoryId);
    if (entry) entry.merchantMemory = row._count._all;
  }

  return impact;
}
