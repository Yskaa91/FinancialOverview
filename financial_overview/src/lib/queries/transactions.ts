import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentMonthRange, daysAgo, parseStatementDate } from "@/lib/dates";

export type TransactionFilters = {
  accountId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  /** Review mode: only rows that still need a decision. */
  review?: boolean;
};

const PAGE_SIZE = 50;

export type TransactionListItem = {
  id: string;
  bookedAt: Date;
  amountCents: number;
  description: string;
  merchant: string | null;
  counterparty: string | null;
  accountName: string;
  categoryName: string | null;
  categoryId: string | null;
  categorySource: string;
  reviewState: string;
  /** True on the leg of a transfer pair that no longer counts as income or expense. */
  excludeFromSpending: boolean;
  sameMerchantOpen: number;
  /** The other account's row, when this one is half of a movement between own accounts. */
  transferPartner: {
    id: string;
    bookedAt: Date;
    amountCents: number;
    accountName: string;
    label: string;
  } | null;
};

export async function listTransactions(filters: TransactionFilters) {
  const where = buildWhere(filters);
  const page = Math.max(1, filters.page ?? 1);

  const [rows, count, sums] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ bookedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { account: { select: { name: true } }, category: { select: { name: true } } },
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.aggregate({ where, _sum: { amountCents: true } }),
  ]);

  const items: TransactionListItem[] = rows.map((t) => ({
    id: t.id,
    bookedAt: t.bookedAt,
    amountCents: t.amountCents,
    description: t.description,
    merchant: t.merchant,
    counterparty: t.counterparty,
    accountName: t.account.name,
    categoryName: t.category?.name ?? null,
    categoryId: t.categoryId,
    categorySource: t.categorySource,
    reviewState: t.reviewState,
    excludeFromSpending: t.excludeFromSpending,
    sameMerchantOpen: 0,
    transferPartner: null,
  }));

  // One extra query, only for rows that can be bulk-applied, so the button can
  // promise a number ("apply to 4 similar") instead of a vague action.
  const openByMerchant = new Map<string, number>();
  const merchants = [...new Set(items.map((t) => t.merchant).filter((m): m is string => !!m))];
  if (merchants.length > 0) {
    const grouped = await prisma.transaction.groupBy({
      by: ["merchant"],
      where: { merchant: { in: merchants }, categoryId: null },
      _count: { _all: true },
    });
    for (const row of grouped) {
      if (row.merchant) openByMerchant.set(row.merchant, row._count._all);
    }
  }
  for (const item of items) {
    item.sameMerchantOpen = item.merchant ? (openByMerchant.get(item.merchant) ?? 0) : 0;
  }

  await attachTransferPartners(items);

  return { items, count, page, pageCount: Math.max(1, Math.ceil(count / PAGE_SIZE)), sumCents: sums._sum.amountCents ?? 0 };
}

/**
 * One extra query per page: which other statement row is the same money. Without
 * this a PayPal purchase and the bank's direct debit look like two expenses.
 */
async function attachTransferPartners(items: TransactionListItem[]): Promise<void> {
  const ids = items.map((item) => item.id);
  if (ids.length === 0) return;

  const linked = await prisma.transaction.findMany({
    where: { id: { in: ids }, transferLinkId: { not: null } },
    select: { id: true, transferLinkId: true },
  });
  const linkByRow = new Map(linked.map((row) => [row.id, row.transferLinkId as string]));
  const linkIds = [...new Set(linkByRow.values())];
  if (linkIds.length === 0) return;

  const partners = await prisma.transaction.findMany({
    where: { transferLinkId: { in: linkIds } },
    select: {
      id: true,
      transferLinkId: true,
      bookedAt: true,
      amountCents: true,
      description: true,
      merchant: true,
      counterparty: true,
      account: { select: { name: true } },
    },
  });

  const byLink = new Map<string, typeof partners>();
  for (const partner of partners) {
    const key = partner.transferLinkId as string;
    byLink.set(key, [...(byLink.get(key) ?? []), partner]);
  }

  for (const item of items) {
    const linkId = linkByRow.get(item.id);
    if (!linkId) continue;
    const other = (byLink.get(linkId) ?? []).find((row) => row.id !== item.id);
    if (!other) continue;
    item.transferPartner = {
      id: other.id,
      bookedAt: other.bookedAt,
      amountCents: other.amountCents,
      accountName: other.account.name,
      label: other.merchant ?? other.counterparty ?? other.description,
    };
  }
}

function buildWhere(filters: TransactionFilters): Prisma.TransactionWhereInput {
  // Review mode looks back 90 days: a queue that hides last month's uncategorised
  // rows is not a queue.
  const from = filters.from
    ? parseStatementDate(filters.from)
    : filters.review
      ? daysAgo(90)
      : currentMonthRange().start;
  const to = filters.to ? parseStatementDate(filters.to) : undefined;

  const where: Prisma.TransactionWhereInput = {
    bookedAt: { gte: from ?? undefined, lte: to ?? undefined },
  };
  if (filters.review) where.reviewState = { in: ["SUGGESTED", "UNCATEGORIZED"] };
  if (filters.accountId) where.accountId = filters.accountId;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.q) {
    where.OR = [
      { description: { contains: filters.q } },
      { merchant: { contains: filters.q } },
      { counterparty: { contains: filters.q } },
    ];
  }
  return where;
}

export async function listCategories() {
  return prisma.category.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] });
}
