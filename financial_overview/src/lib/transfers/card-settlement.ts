// A credit card is collected once a month: the bank sees one direct debit, the
// card statement sees dozens of purchases. Nothing pairs row by row — that is why
// individual card rows used to sit in the reconciliation list forever, looking
// like unresolved facts when there was nothing to resolve.
//
// What can be checked is the total: the charges of one statement against the one
// bank debit that paid it. Pure, so the arithmetic is testable without a database.

/** Long enough for a collection that runs after the statement date. */
export const SETTLEMENT_WINDOW_DAYS = 21;
/** A collection can be booked a couple of days before the printed statement end. */
export const SETTLEMENT_EARLY_DAYS = 3;

export type CardStatementInput = {
  accountId: string;
  accountName: string;
  statementId: string;
  /** yyyy-mm-dd, as stored. */
  periodStart: string | null;
  periodEnd: string | null;
  /** Every amount on that statement, in cents, signs as booked. */
  amounts: number[];
};

export type BankRowInput = {
  id: string;
  accountId: string;
  accountName: string;
  bookedAt: string;
  amountCents: number;
  label: string;
};

export type CardSettlement = {
  accountId: string;
  accountName: string;
  statementId: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  /** Sum of the statement's charges (negative). */
  chargesCents: number;
  /** Sum of what came back to the card: payments and refunds (positive). */
  creditedCents: number;
  /** The bank debit that paid this statement, if one is in the imported rows. */
  paidBy: BankRowInput | null;
};

function toDay(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * One entry per card statement, with the bank debit that paid it.
 *
 * The claim being checked is exact: the collection equals the statement's charges
 * to the cent. When it does not, either the statement is incomplete or the debit
 * belongs to a different period, and both are worth seeing.
 */
export function cardSettlements({
  statements,
  bankRows,
  windowDays = SETTLEMENT_WINDOW_DAYS,
  earlyDays = SETTLEMENT_EARLY_DAYS,
}: {
  statements: CardStatementInput[];
  bankRows: BankRowInput[];
  windowDays?: number;
  earlyDays?: number;
}): CardSettlement[] {
  return statements
    .map((statement) => {
      const chargesCents = statement.amounts.filter((amount) => amount < 0).reduce((sum, amount) => sum + amount, 0);
      const creditedCents = statement.amounts.filter((amount) => amount > 0).reduce((sum, amount) => sum + amount, 0);

      const end = toDay(statement.periodEnd);
      const paidBy =
        end === null || chargesCents >= 0
          ? null
          : (bankRows.find((row) => {
              if (row.accountId === statement.accountId) return false;
              if (row.amountCents !== chargesCents) return false;
              const booked = toDay(row.bookedAt);
              if (booked === null) return false;
              const days = (booked - end) / 86_400_000;
              return days >= -earlyDays && days <= windowDays;
            }) ?? null);

      return {
        accountId: statement.accountId,
        accountName: statement.accountName,
        statementId: statement.statementId,
        periodStart: statement.periodStart ? new Date(`${statement.periodStart}T00:00:00.000Z`) : null,
        periodEnd: statement.periodEnd ? new Date(`${statement.periodEnd}T00:00:00.000Z`) : null,
        chargesCents,
        creditedCents,
        paidBy,
      };
    })
    .sort((a, b) => (b.periodEnd?.getTime() ?? 0) - (a.periodEnd?.getTime() ?? 0));
}
