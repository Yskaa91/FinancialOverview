import { prisma } from "@/lib/db";
import { notTransfer } from "./filters";
import { daysAgo } from "@/lib/dates";
import { listAccounts } from "@/lib/queries/accounts";
import { accountBalancesAt, type AccountBalance } from "@/lib/queries/history";
import { propertyTotalCents } from "@/lib/queries/property";
import {
  comparisonRows,
  type CategoryTotal,
  type CompareRow,
  type Period,
  type PeriodTotals,
} from "@/lib/periods";

export type DashboardData = {
  netWorthCents: number;
  assetsCents: number;
  liabilitiesCents: number;
  /** Estimated value of the homes; part of assets and net worth, not of an account. */
  propertyCents: number;
  /** The period the page is showing. */
  period: PeriodTotals;
  /** The period it is measured against, with the category difference. Null when off. */
  comparison: { period: PeriodTotals; rows: CompareRow[] } | null;
  uncategorizedCount: number;
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

/**
 * Income, spending and the category split for one period. Transfers are filtered
 * out exactly as everywhere else, so the two figures answer "what did I earn and
 * what did I spend", not "what moved".
 */
export async function totalsForPeriod(period: Period): Promise<PeriodTotals> {
  const bookedAt = { gte: period.start, lt: period.end };

  const [income, expense, grouped] = await Promise.all([
    prisma.transaction.aggregate({
      where: { bookedAt, amountCents: { gt: 0 }, ...notTransfer },
      _sum: { amountCents: true },
    }),
    prisma.transaction.aggregate({
      where: { bookedAt, amountCents: { lt: 0 }, ...notTransfer },
      _sum: { amountCents: true },
    }),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { bookedAt, amountCents: { lt: 0 }, ...notTransfer },
      _sum: { amountCents: true },
    }),
  ]);

  const ids = grouped
    .map((row) => row.categoryId)
    .filter((id): id is string => id !== null);
  const categories =
    ids.length === 0
      ? []
      : await prisma.category.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, color: true },
        });
  const byId = new Map(categories.map((c) => [c.id, c]));

  const categoryTotals: CategoryTotal[] = grouped
    .map((row) => {
      const category = row.categoryId ? byId.get(row.categoryId) : undefined;
      return {
        id: row.categoryId,
        name: row.categoryId ? (category?.name ?? "Unknown") : "Uncategorised",
        color: category?.color ?? null,
        cents: Math.abs(row._sum.amountCents ?? 0),
      };
    })
    .sort((a, b) => b.cents - a.cents);

  return {
    period,
    incomeCents: income._sum.amountCents ?? 0,
    expenseCents: Math.abs(expense._sum.amountCents ?? 0),
    categories: categoryTotals,
  };
}

export async function getDashboard(
  period: Period,
  compareWith: Period | null = null,
): Promise<DashboardData> {
  const [accounts, propertyCents, periodTotals, comparedTotals, uncategorized, recent] =
    await Promise.all([
      listAccounts(),
      propertyTotalCents(),
      totalsForPeriod(period),
      compareWith ? totalsForPeriod(compareWith) : Promise.resolve(null),
      prisma.transaction.count({ where: { categoryId: null, ...notTransfer } }),
      prisma.transaction.findMany({
        orderBy: [{ bookedAt: "desc" }, { id: "desc" }],
        take: 8,
        include: { account: { select: { name: true } }, category: { select: { name: true } } },
      }),
    ]);

  const assetsCents =
    accounts
      .filter((a) => a.type !== "CREDIT_CARD")
      .reduce((sum, a) => sum + a.balanceCents, 0) + propertyCents;
  const liabilitiesCents = accounts
    .filter((a) => a.type === "CREDIT_CARD")
    .reduce((sum, a) => sum + a.balanceCents, 0);

  return {
    netWorthCents: assetsCents + liabilitiesCents,
    assetsCents,
    propertyCents,
    liabilitiesCents,
    period: periodTotals,
    comparison: comparedTotals
      ? {
          period: comparedTotals,
          rows: comparisonRows(periodTotals.categories, comparedTotals.categories),
        }
      : null,
    uncategorizedCount: uncategorized,
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


export type AccountChange = {
  id: string;
  name: string;
  type: string;
  currentCents: number;
  otherCents: number;
  deltaCents: number;
};

export type BalanceSides = { assetsCents: number; liabilitiesCents: number; netCents: number };

export type BalanceComparison = {
  rows: AccountChange[];
  current: BalanceSides;
  other: BalanceSides;
};

/** Assets are everything that is not a credit card; the card is the liability. */
function sidesOf(balances: AccountBalance[]): BalanceSides {
  const sum = (wanted: (row: AccountBalance) => boolean) =>
    balances.filter(wanted).reduce((total, row) => total + row.cents, 0);
  const assetsCents = sum((row) => row.type !== "CREDIT_CARD");
  const liabilitiesCents = sum((row) => row.type === "CREDIT_CARD");
  return { assetsCents, liabilitiesCents, netCents: assetsCents + liabilitiesCents };
}

/**
 * What every account was worth at the end of two periods, and how far it moved
 * between them. Houses are left out on purpose: they are valued at today's
 * estimate, so a historical figure would be invented.
 */
export async function accountChanges(
  current: Period,
  other: Period,
): Promise<BalanceComparison> {
  const [currentBalances, otherBalances] = await Promise.all([
    accountBalancesAt(current.end),
    accountBalancesAt(other.end),
  ]);
  const otherBy = new Map(otherBalances.map((row) => [row.id, row.cents]));

  const rows = currentBalances.map((row) => {
    const otherCents = otherBy.get(row.id) ?? 0;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      currentCents: row.cents,
      otherCents,
      deltaCents: row.cents - otherCents,
    };
  });

  return { rows, current: sidesOf(currentBalances), other: sidesOf(otherBalances) };
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
