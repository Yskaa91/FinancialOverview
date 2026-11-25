import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentMonthRange, parseStatementDate } from "@/lib/dates";

export type TransactionFilters = {
  accountId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
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
  reviewState: string;
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
    reviewState: t.reviewState,
  }));

  return { items, count, page, pageCount: Math.max(1, Math.ceil(count / PAGE_SIZE)), sumCents: sums._sum.amountCents ?? 0 };
}

function buildWhere(filters: TransactionFilters): Prisma.TransactionWhereInput {
  const from = filters.from ? parseStatementDate(filters.from) : currentMonthRange().start;
  const to = filters.to ? parseStatementDate(filters.to) : undefined;

  const where: Prisma.TransactionWhereInput = {
    bookedAt: { gte: from ?? undefined, lte: to ?? undefined },
  };
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
