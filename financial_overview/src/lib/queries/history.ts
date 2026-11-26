import { prisma } from "@/lib/db";
import { notTransfer } from "./filters";
import { propertySeriesCents } from "./property";
import { fifo, positionValueCents, type TradeInput } from "@/lib/portfolio/trades";

export type NetWorthPoint = { date: string; cents: number };
export type CashflowPoint = { month: string; incomeCents: number; expenseCents: number };

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Last day of each of the past `months` months, oldest first, ending this month. */
function monthEnds(months: number, now = new Date()): Date[] {
  const ends: Date[] = [];
  for (let i = months - 1; i >= 0; i--) {
    ends.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0)));
  }
  return ends;
}

type AccountRow = { id: string; name: string; type: string; openingBalanceCents: number };
type TxnRow = { accountId: string; bookedAt: Date; amountCents: number };
type TradeRow = {
  id: string;
  accountId: string;
  instrumentId: string;
  side: string;
  tradedAt: Date;
  quantityMicro: number;
  priceCents: number;
  feeCents: number;
};
type PriceRow = { instrumentId: string; fetchedAt: Date; priceCents: number };

/**
 * Cash plus holdings per account, as of `end`. Cash is opening balance plus the
 * movements up to that date; a broker's holdings come from FIFO over its trades,
 * priced with the newest price known at the time (forward-filled, so a quiet
 * instrument keeps its last quote).
 */
function balancesAtDate(
  accounts: AccountRow[],
  transactions: TxnRow[],
  trades: TradeRow[],
  prices: PriceRow[],
  end: Date,
): Map<string, number> {
  const balances = new Map<string, number>();

  for (const account of accounts) {
    const movement = transactions
      .filter((t) => t.accountId === account.id && t.bookedAt <= end)
      .reduce((sum, t) => sum + t.amountCents, 0);
    balances.set(account.id, account.openingBalanceCents + movement);
  }

  for (const account of accounts) {
    if (account.type !== "BROKER") continue;

    const byInstrument = new Map<string, TradeInput[]>();
    for (const trade of trades) {
      if (trade.accountId !== account.id || trade.tradedAt > end) continue;
      const list = byInstrument.get(trade.instrumentId) ?? [];
      list.push({
        id: trade.id,
        side: trade.side as "BUY" | "SELL",
        tradedAt: trade.tradedAt,
        quantityMicro: trade.quantityMicro,
        priceCents: trade.priceCents,
        feeCents: trade.feeCents,
      });
      byInstrument.set(trade.instrumentId, list);
    }
    if (byInstrument.size === 0) continue;

    const { positions } = fifo(byInstrument);
    let holdings = 0;
    for (const [instrumentId, position] of positions) {
      const price = [...prices]
        .reverse()
        .find((p) => p.instrumentId === instrumentId && p.fetchedAt <= end);
      // A price quoted after the date still beats the purchase cost.
      const fallback = [...prices].reverse().find((p) => p.instrumentId === instrumentId);
      holdings += positionValueCents(
        position,
        price?.priceCents ?? fallback?.priceCents ?? position.averageCostCents,
      );
    }
    balances.set(account.id, (balances.get(account.id) ?? 0) + holdings);
  }

  return balances;
}

/** Everything `balancesAtDate` needs, bounded by one date. */
async function loadBalanceInputs(before: Date, inclusive: boolean) {
  const bookedAt = inclusive ? { lte: before } : { lt: before };
  const tradedAt = inclusive ? { lte: before } : { lt: before };

  const [accounts, transactions, trades, prices] = await Promise.all([
    prisma.account.findMany({
      where: { archived: false },
      select: { id: true, name: true, type: true, openingBalanceCents: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.transaction.findMany({
      where: { bookedAt },
      select: { accountId: true, bookedAt: true, amountCents: true },
      orderBy: { bookedAt: "asc" },
    }),
    prisma.trade.findMany({ where: { tradedAt }, orderBy: { tradedAt: "asc" } }),
    prisma.price.findMany({ orderBy: { fetchedAt: "asc" } }),
  ]);

  return { accounts, transactions, trades, prices };
}

/**
 * Net worth per month end: the accounts from `balancesAtDate`, plus the homes as
 * they were valued at that date — the same real estate the headline figure on the
 * dashboard carries.
 */
export async function netWorthSeries(months = 12): Promise<NetWorthPoint[]> {
  const ends = monthEnds(months);
  const [{ accounts, transactions, trades, prices }, propertyCents] = await Promise.all([
    loadBalanceInputs(ends[ends.length - 1], true),
    propertySeriesCents(ends),
  ]);

  return ends.map((end, index) => {
    const balances = balancesAtDate(accounts, transactions, trades, prices, end);
    const cents =
      [...balances.values()].reduce((sum, value) => sum + value, 0) + propertyCents[index];
    return { date: end.toISOString().slice(0, 10), cents };
  });
}

export type AccountBalance = { id: string; name: string; type: string; cents: number };

/**
 * Every account's balance at the end of `end`, exclusive as a period bound is:
 * a row booked on the first day of the next period does not count yet.
 */
export async function accountBalancesAt(end: Date): Promise<AccountBalance[]> {
  const { accounts, transactions, trades, prices } = await loadBalanceInputs(end, false);
  const balances = balancesAtDate(accounts, transactions, trades, prices, end);
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    cents: balances.get(account.id) ?? 0,
  }));
}

/** Income and expense per month, transfers excluded so they never count twice. */
export async function cashflowSeries(months = 12): Promise<CashflowPoint[]> {
  const ends = monthEnds(months);
  const rows = await prisma.transaction.findMany({
    where: {
      bookedAt: { gte: new Date(Date.UTC(ends[0].getUTCFullYear(), ends[0].getUTCMonth(), 1)) },
      ...notTransfer,
    },
    select: { bookedAt: true, amountCents: true },
  });

  const buckets = new Map<string, { incomeCents: number; expenseCents: number }>();
  for (const end of ends) buckets.set(monthKey(end), { incomeCents: 0, expenseCents: 0 });

  for (const row of rows) {
    const bucket = buckets.get(monthKey(row.bookedAt));
    if (!bucket) continue;
    if (row.amountCents >= 0) bucket.incomeCents += row.amountCents;
    else bucket.expenseCents += Math.abs(row.amountCents);
  }

  return [...buckets.entries()].map(([month, sums]) => ({ month, ...sums }));
}
