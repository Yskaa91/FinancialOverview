import { prisma } from "@/lib/db";
import { fifo, positionValueCents, unrealizedCents, type TradeInput } from "@/lib/portfolio/trades";
import { latestPriceCents } from "@/lib/portfolio/prices";

export type HoldingRow = {
  instrumentId: string;
  symbol: string;
  name: string;
  kind: string;
  quantityMicro: number;
  averageCostCents: number;
  costBasisCents: number;
  priceCents: number;
  valueCents: number;
  unrealizedCents: number;
  priceFetchedAt: Date | null;
};

export type PortfolioView = {
  holdings: HoldingRow[];
  realizedCents: number;
  holdingsValueCents: number;
  costBasisCents: number;
  unrealizedCents: number;
  cashCents: number;
  totalCents: number;
  trades: {
    id: string;
    side: string;
    tradedAt: Date;
    symbol: string;
    quantityMicro: number;
    priceCents: number;
    feeCents: number;
    note: string | null;
  }[];
};

/** Positions come from the trade log, priced with the newest price per instrument. */
export async function getPortfolio(accountId: string): Promise<PortfolioView> {
  const [account, trades, instruments, prices, snapshots, transactions] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId } }),
    prisma.trade.findMany({
      where: { accountId },
      orderBy: [{ tradedAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.instrument.findMany(),
    prisma.price.findMany(),
    prisma.snapshot.findMany({ where: { accountId }, orderBy: { takenAt: "desc" }, take: 1 }),
    prisma.transaction.aggregate({ where: { accountId }, _sum: { amountCents: true } }),
  ]);

  const instrumentById = new Map(instruments.map((i) => [i.id, i]));
  const pricesByInstrument = new Map<string, { fetchedAt: Date; priceCents: number }[]>();
  for (const price of prices) {
    const list = pricesByInstrument.get(price.instrumentId) ?? [];
    list.push({ fetchedAt: price.fetchedAt, priceCents: price.priceCents });
    pricesByInstrument.set(price.instrumentId, list);
  }

  const byInstrument = new Map<string, TradeInput[]>();
  for (const trade of trades) {
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

  const { positions, realizedCents } = fifo(byInstrument);

  const holdings: HoldingRow[] = [];
  for (const [instrumentId, position] of positions) {
    if (position.quantityMicro <= 0) continue;
    const instrument = instrumentById.get(instrumentId);
    if (!instrument) continue;
    const priceList = pricesByInstrument.get(instrumentId) ?? [];
    const priceCents = latestPriceCents(priceList) ?? position.averageCostCents;
    const latest = priceList.reduce<Date | null>(
      (newest, p) => (!newest || p.fetchedAt > newest ? p.fetchedAt : newest),
      null,
    );
    holdings.push({
      instrumentId,
      symbol: instrument.symbol,
      name: instrument.name,
      kind: instrument.kind,
      quantityMicro: position.quantityMicro,
      averageCostCents: position.averageCostCents,
      costBasisCents: position.costBasisCents,
      priceCents,
      valueCents: positionValueCents(position, priceCents),
      unrealizedCents: unrealizedCents(position, priceCents),
      priceFetchedAt: latest,
    });
  }
  holdings.sort((a, b) => b.valueCents - a.valueCents);

  const holdingsValueCents = holdings.reduce((sum, h) => sum + h.valueCents, 0);
  const costBasis = holdings.reduce((sum, h) => sum + h.costBasisCents, 0);
  const cashCents =
    snapshots[0]?.balanceCents ??
    (account?.openingBalanceCents ?? 0) + (transactions._sum.amountCents ?? 0);

  return {
    holdings,
    realizedCents,
    holdingsValueCents,
    costBasisCents: costBasis,
    unrealizedCents: holdingsValueCents - costBasis,
    cashCents,
    totalCents: holdingsValueCents + cashCents,
    trades: trades
      .slice()
      .reverse()
      .map((t) => ({
        id: t.id,
        side: t.side,
        tradedAt: t.tradedAt,
        symbol: instrumentById.get(t.instrumentId)?.symbol ?? "?",
        quantityMicro: t.quantityMicro,
        priceCents: t.priceCents,
        feeCents: t.feeCents,
        note: t.note,
      })),
  };
}

/** Instruments known to the app, for the trade form's picker. */
export async function listInstruments() {
  return prisma.instrument.findMany({ orderBy: { symbol: "asc" } });
}
