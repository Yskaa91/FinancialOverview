import { prisma } from "@/lib/db";
import { notTransfer } from "./filters";
import { currentMonthRange, daysAgo } from "@/lib/dates";
import { listAccounts } from "@/lib/queries/accounts";

export type DashboardData = {
  netWorthCents: number;
  assetsCents: number;
  liabilitiesCents: number;
  change30dCents: number;
  monthIncomeCents: number;
  monthExpenseCents: number;
  uncategorizedCount: number;
  topCategories: { name: string; color: string | null; totalCents: number }[];
  accounts: Awaited<ReturnType<typeof listAccounts>>;
  recent: {
    id: string;
    bookedAt: Date;
    amountCents: number;
    description: string;
    merchant: string | null;
    accountName: string;
    categoryName: string | null;
  }[];
};

export async function getDashboard(): Promise<DashboardData> {
  const { start, end } = currentMonthRange();
  const accounts = await listAccounts();

  const [monthIncome, monthExpense, uncategorized, expenseByCategory, recent] =
    await Promise.all([
      prisma.transaction.aggregate({
        where: { bookedAt: { gte: start, lt: end }, amountCents: { gt: 0 }, ...notTransfer },
        _sum: { amountCents: true },
      }),
      prisma.transaction.aggregate({
        where: { bookedAt: { gte: start, lt: end }, amountCents: { lt: 0 }, ...notTransfer },
        _sum: { amountCents: true },
      }),
      prisma.transaction.count({ where: { categoryId: null, ...notTransfer } }),
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { bookedAt: { gte: start, lt: end }, amountCents: { lt: 0 }, ...notTransfer },
        _sum: { amountCents: true },
      }),
      prisma.transaction.findMany({
        orderBy: [{ bookedAt: "desc" }, { id: "desc" }],
        take: 8,
        include: { account: { select: { name: true } }, category: { select: { name: true } } },
      }),
    ]);

  const categoryIds = expenseByCategory
    .map((row) => row.categoryId)
    .filter((id): id is string => id !== null);
  const categories = await prisma.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true, color: true },
  });
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const topCategories = expenseByCategory
    .map((row) => ({
      name: row.categoryId ? (categoryById.get(row.categoryId)?.name ?? "Unknown") : "Uncategorised",
      color: row.categoryId ? (categoryById.get(row.categoryId)?.color ?? null) : null,
      totalCents: Math.abs(row._sum.amountCents ?? 0),
    }))
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, 6);

  const assetsCents = accounts
    .filter((a) => a.type !== "CREDIT_CARD")
    .reduce((sum, a) => sum + a.balanceCents, 0);
  const liabilitiesCents = accounts
    .filter((a) => a.type === "CREDIT_CARD")
    .reduce((sum, a) => sum + a.balanceCents, 0);

  return {
    netWorthCents: assetsCents + liabilitiesCents,
    assetsCents,
    liabilitiesCents,
    change30dCents: accounts.reduce((sum, a) => sum + a.change30dCents, 0),
    monthIncomeCents: monthIncome._sum.amountCents ?? 0,
    monthExpenseCents: Math.abs(monthExpense._sum.amountCents ?? 0),
    uncategorizedCount: uncategorized,
    topCategories,
    accounts,
    recent: recent.map((t) => ({
      id: t.id,
      bookedAt: t.bookedAt,
      amountCents: t.amountCents,
      description: t.description,
      merchant: t.merchant,
      accountName: t.account.name,
      categoryName: t.category?.name ?? null,
    })),
  };
}

/** Uncategorised rows from the last 90 days, for the review queue on /transactions. */
export async function getReviewQueue(limit = 50) {
  return prisma.transaction.findMany({
    where: { reviewState: { in: ["SUGGESTED", "UNCATEGORIZED"] }, bookedAt: { gte: daysAgo(90) } },
    orderBy: { bookedAt: "desc" },
    take: limit,
    include: { account: { select: { name: true } }, category: { select: { name: true } } },
  });
}
