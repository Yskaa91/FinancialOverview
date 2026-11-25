import { prisma } from "@/lib/db";
import { daysAgo } from "@/lib/dates";
import type { AccountType, Institution } from "@/lib/types";

export type AccountSummary = {
  id: string;
  name: string;
  type: AccountType;
  institution: Institution;
  currency: string;
  /** Everything the edit form needs to prefill itself from the create form. */
  iban: string | null;
  archived: boolean;
  openingBalanceCents: number;
  balanceCents: number;
  change30dCents: number;
  lastImportAt: Date | null;
};

/**
 * Balance = opening balance + sum of transactions.
 * shortcut: broker accounts report cash only until phase 5 adds holdings value,
 * so a BROKER balance here is deliberately labelled "cash" in the UI.
 */
export async function listAccounts(includeArchived = false): Promise<AccountSummary[]> {
  const accounts = await prisma.account.findMany({
    where: includeArchived ? {} : { archived: false },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  if (accounts.length === 0) return [];

  const since = daysAgo(30);
  const [totals, recent, imports] = await Promise.all([
    prisma.transaction.groupBy({ by: ["accountId"], _sum: { amountCents: true } }),
    prisma.transaction.groupBy({
      by: ["accountId"],
      where: { bookedAt: { gte: since } },
      _sum: { amountCents: true },
    }),
    prisma.statement.groupBy({ by: ["accountId"], _max: { importedAt: true } }),
  ]);

  const totalBy = new Map(totals.map((t) => [t.accountId, t._sum.amountCents ?? 0]));
  const recentBy = new Map(recent.map((t) => [t.accountId, t._sum.amountCents ?? 0]));
  const importBy = new Map(imports.map((i) => [i.accountId, i._max.importedAt]));

  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as AccountType,
    institution: a.institution as Institution,
    currency: a.currency,
    iban: a.iban,
    archived: a.archived,
    openingBalanceCents: a.openingBalanceCents,
    balanceCents: a.openingBalanceCents + (totalBy.get(a.id) ?? 0),
    change30dCents: recentBy.get(a.id) ?? 0,
    lastImportAt: importBy.get(a.id) ?? null,
  }));
}

export async function getAccount(id: string) {
  return prisma.account.findUnique({ where: { id } });
}
