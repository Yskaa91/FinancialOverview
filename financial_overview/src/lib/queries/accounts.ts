import { prisma } from "@/lib/db";
import { daysAgo } from "@/lib/dates";
import { latestPriceCents } from "@/lib/portfolio/prices";
import { holdingsValueByAccount } from "@/lib/portfolio/trades";
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
  /** Cash plus the value of the holdings; only a BROKER has the second part. */
  balanceCents: number;
  holdingsValueCents: number;
  change30dCents: number;
  lastImportAt: Date | null;
};

/**
 * Balance = opening balance + sum of transactions, plus the holdings value for a
 * BROKER account (FIFO over its trades, newest price per instrument). Net worth
 * and the account cards read this, so a broker is never reported as cash only.
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

  const brokerIds = accounts.filter((a) => a.type === "BROKER").map((a) => a.id);
  const holdingsBy = await holdingsValueFor(brokerIds);

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
    balanceCents: a.openingBalanceCents + (totalBy.get(a.id) ?? 0) + (holdingsBy.get(a.id) ?? 0),
    holdingsValueCents: holdingsBy.get(a.id) ?? 0,
    change30dCents: recentBy.get(a.id) ?? 0,
    lastImportAt: importBy.get(a.id) ?? null,
  }));
}

export async function getAccount(id: string) {
  return prisma.account.findUnique({ where: { id } });
}

/** Open-position value per account, priced with the newest row per instrument. */
async function holdingsValueFor(accountIds: string[]): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();
  const [trades, prices] = await Promise.all([
    prisma.trade.findMany({ where: { accountId: { in: accountIds } } }),
    prisma.price.findMany(),
  ]);

  const pricesByInstrument = new Map<string, { fetchedAt: Date; priceCents: number }[]>();
  for (const price of prices) {
    const list = pricesByInstrument.get(price.instrumentId) ?? [];
    list.push({ fetchedAt: price.fetchedAt, priceCents: price.priceCents });
    pricesByInstrument.set(price.instrumentId, list);
  }
  const priceByInstrument = new Map<string, number>();
  for (const [instrumentId, list] of pricesByInstrument) {
    const priceCents = latestPriceCents(list);
    if (priceCents !== null) priceByInstrument.set(instrumentId, priceCents);
  }

  return holdingsValueByAccount(
    trades.map((trade) => ({
      id: trade.id,
      accountId: trade.accountId,
      instrumentId: trade.instrumentId,
      side: trade.side as "BUY" | "SELL",
      tradedAt: trade.tradedAt,
      quantityMicro: trade.quantityMicro,
      priceCents: trade.priceCents,
      feeCents: trade.feeCents,
    })),
    priceByInstrument,
  );
}
