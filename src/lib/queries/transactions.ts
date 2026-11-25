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
  sameMerchantOpen: number;
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
    sameMerchantOpen: 0,
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

  return { items, count, page, pageCount: Math.max(1, Math.ceil(count / PAGE_SIZE)), sumCents: sums._sum.amountCents ?? 0 };
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
