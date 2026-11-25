import { prisma } from "@/lib/db";
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

/**
 * Net worth per month end. Cash accounts derive the balance from opening balance
 * plus transactions; broker accounts add holdings valued with the newest price at
 * that date (forward-filled). Positions come from FIFO over the trades up to the
 * date, so a sale or a buy shows up in the right month.
 */
export async function netWorthSeries(months = 12): Promise<NetWorthPoint[]> {
  const ends = monthEnds(months);

  const [accounts, transactions, trades, prices] = await Promise.all([
    prisma.account.findMany({ where: { archived: false } }),
    prisma.transaction.findMany({
      where: { bookedAt: { lte: ends[ends.length - 1] } },
      select: { accountId: true, bookedAt: true, amountCents: true },
      orderBy: { bookedAt: "asc" },
    }),
    prisma.trade.findMany({
      where: { tradedAt: { lte: ends[ends.length - 1] } },
      orderBy: { tradedAt: "asc" },
    }),
    prisma.price.findMany({ orderBy: { fetchedAt: "asc" } }),
  ]);

  const brokerIds = new Set(accounts.filter((a) => a.type === "BROKER").map((a) => a.id));

  return ends.map((end) => {
    let total = 0;

    for (const account of accounts) {
      if (brokerIds.has(account.id)) continue;
      const movement = transactions
        .filter((t) => t.accountId === account.id && t.bookedAt <= end)
        .reduce((sum, t) => sum + t.amountCents, 0);
      total += account.openingBalanceCents + movement;
    }

    // Broker holdings: FIFO over trades up to this date, priced with the newest
    // price known at the time.
    const byInstrument = new Map<string, TradeInput[]>();
    for (const trade of trades) {
      if (trade.tradedAt > end || !brokerIds.has(trade.accountId)) continue;
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
    const { positions } = fifo(byInstrument);
    for (const [instrumentId, position] of positions) {
      const price = [...prices].reverse().find((p) => p.instrumentId === instrumentId && p.fetchedAt <= end);
      const fallback = [...prices].reverse().find((p) => p.instrumentId === instrumentId);
      const cents = price?.priceCents ?? fallback?.priceCents ?? position.averageCostCents;
      total += positionValueCents(position, cents);
    }

    // Broker cash: snapshots when present, else the account's own movement.
    for (const account of accounts) {
      if (!brokerIds.has(account.id)) continue;
      const movement = transactions
        .filter((t) => t.accountId === account.id && t.bookedAt <= end)
        .reduce((sum, t) => sum + t.amountCents, 0);
      total += account.openingBalanceCents + movement;
    }

    return { date: end.toISOString().slice(0, 10), cents: total };
  });
}

/** Income and expense per month, transfers excluded so they never count twice. */
export async function cashflowSeries(months = 12): Promise<CashflowPoint[]> {
  const ends = monthEnds(months);
  const rows = await prisma.transaction.findMany({
    where: {
      bookedAt: { gte: new Date(Date.UTC(ends[0].getUTCFullYear(), ends[0].getUTCMonth(), 1)) },
      transferGroupId: null,
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
