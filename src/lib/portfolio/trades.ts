// Positions are always derived from the trade log, never stored
// (docs/ARCHITECTURE.md §4). Pure: no Prisma import here, so the numbers can be
// tested without a database.
//
// Money is integer cents, quantities are integer micro-units (x1e6).

export type TradeInput = {
  id: string;
  side: "BUY" | "SELL";
  tradedAt: Date;
  quantityMicro: number;
  priceCents: number;
  feeCents: number;
};

export type Position = {
  instrumentId: string;
  quantityMicro: number; // open quantity
  averageCostCents: number; // per unit, weighted, fees included
  costBasisCents: number; // open cost basis
  lots: { tradedAt: Date; quantityMicro: number; priceCents: number }[];
};

export type FifoResult = {
  positions: Map<string, Position>;
  realizedCents: number;
  oversold: { instrumentId: string; quantityMicro: number }[];
};

const MICRO = 1_000_000;

// An open lot carries its own remaining cost, so a partial sale takes exactly
// its share and repeated rounding never drifts away from the original cost.
type Lot = { tradedAt: Date; quantityMicro: number; priceCents: number; costCents: number };

function quantityValueCents(quantityMicro: number, priceCents: number): number {
  return Math.round((quantityMicro * priceCents) / MICRO);
}

function toPosition(instrumentId: string, lots: Lot[]): Position {
  const quantityMicro = lots.reduce((sum, lot) => sum + lot.quantityMicro, 0);
  const costBasisCents = lots.reduce((sum, lot) => sum + lot.costCents, 0);
  return {
    instrumentId,
    quantityMicro,
    averageCostCents:
      quantityMicro === 0 ? 0 : Math.round((costBasisCents * MICRO) / quantityMicro),
    costBasisCents,
    lots: lots.map((lot) => ({
      tradedAt: lot.tradedAt,
      quantityMicro: lot.quantityMicro,
      priceCents: lot.priceCents,
    })),
  };
}

export function fifo(tradesByInstrument: Map<string, TradeInput[]>): FifoResult {
  const positions = new Map<string, Position>();
  const oversold: { instrumentId: string; quantityMicro: number }[] = [];
  let realizedCents = 0;

  for (const [instrumentId, trades] of tradesByInstrument) {
    // Oldest first: FIFO is a property of the dates, not of the row order the
    // query happened to return.
    const sorted = [...trades].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
    const lots: Lot[] = [];

    for (const trade of sorted) {
      // A trade for zero units buys or sells nothing; there is no unit to carry
      // its fee on, so it contributes nothing at all.
      if (trade.quantityMicro <= 0) continue;

      if (trade.side === "BUY") {
        lots.push({
          tradedAt: trade.tradedAt,
          quantityMicro: trade.quantityMicro,
          priceCents: trade.priceCents,
          costCents: quantityValueCents(trade.quantityMicro, trade.priceCents) + trade.feeCents,
        });
        continue;
      }

      let toSell = trade.quantityMicro;
      let costSoldCents = 0;
      for (const lot of lots) {
        if (toSell <= 0) break;
        const take = Math.min(lot.quantityMicro, toSell);
        const costPart =
          take === lot.quantityMicro
            ? lot.costCents
            : Math.round((lot.costCents * take) / lot.quantityMicro);
        lot.quantityMicro -= take;
        lot.costCents -= costPart;
        costSoldCents += costPart;
        toSell -= take;
      }

      if (toSell > 0) {
        // The log claims a sale bigger than the holdings. Clamp at zero and
        // report the gap: a negative position would poison every total.
        oversold.push({ instrumentId, quantityMicro: toSell });
      }

      const soldMicro = trade.quantityMicro - toSell;
      // The fee was paid whatever quantity the holdings could cover.
      realizedCents +=
        quantityValueCents(soldMicro, trade.priceCents) - trade.feeCents - costSoldCents;
    }

    positions.set(
      instrumentId,
      toPosition(
        instrumentId,
        lots.filter((lot) => lot.quantityMicro > 0),
      ),
    );
  }

  return { positions, realizedCents, oversold };
}

export function positionValueCents(position: Position, priceCents: number): number {
  return quantityValueCents(position.quantityMicro, priceCents);
}

export function unrealizedCents(position: Position, priceCents: number): number {
  return positionValueCents(position, priceCents) - position.costBasisCents;
}
