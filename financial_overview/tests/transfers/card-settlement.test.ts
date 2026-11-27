import { describe, expect, it } from "vitest";
import { cardSettlements, type BankRowInput, type CardStatementInput } from "@/lib/transfers/card-settlement";

// Numbers taken from a real ICS statement and the ASN debit that paid it: the
// charges of the cycle sum to -377,45 and the bank booked exactly that on
// 2026-10-30, four days after the last row on the statement.
const amounts = [
  -1053, -442, -4755, -6995, -1935, -1244, -10122, -11199, // charges in the cycle
  179220, // "GEINCASSEERD VORIG SALDO": the previous bill arriving as a credit
];

const statement: CardStatementInput = {
  accountId: "ics",
  accountName: "ICS card",
  statementId: "statement-1",
  periodStart: "2026-09-28",
  periodEnd: "2026-10-26",
  amounts,
};

const debit: BankRowInput = {
  id: "bank-1",
  accountId: "asn",
  accountName: "ASN",
  bookedAt: "2026-10-30",
  amountCents: -37745,
  label: "INT CARD SERVICES",
};

describe("cardSettlements", () => {
  it("sums the charges of the statement, ignoring what came back", () => {
    const [result] = cardSettlements({ statements: [statement], bankRows: [debit] });
    expect(result.chargesCents).toBe(-37745);
    expect(result.creditedCents).toBe(179220);
  });

  it("finds the one bank debit that paid it", () => {
    const [result] = cardSettlements({ statements: [statement], bankRows: [debit] });
    expect(result.paidBy?.id).toBe("bank-1");
  });

  it("reports nothing when no debit matches the total", () => {
    const mismatched = { ...debit, amountCents: -37744 };
    const [result] = cardSettlements({ statements: [statement], bankRows: [mismatched] });
    expect(result.paidBy).toBeNull();
  });

  it("ignores a debit on the card's own account", () => {
    const own = { ...debit, accountId: "ics" };
    const [result] = cardSettlements({ statements: [statement], bankRows: [own] });
    expect(result.paidBy).toBeNull();
  });

  it("respects the collection window around the statement end", () => {
    // periodEnd is 2026-10-26: 21 days after it still counts, 22 does not.
    const lastDay = { ...debit, bookedAt: "2026-11-16" };
    expect(cardSettlements({ statements: [statement], bankRows: [lastDay] })[0].paidBy?.id).toBe("bank-1");

    const tooLate = { ...debit, bookedAt: "2026-11-17" };
    expect(cardSettlements({ statements: [statement], bankRows: [tooLate] })[0].paidBy).toBeNull();

    // A collection booked a few days before the printed end is normal.
    const early = { ...debit, bookedAt: "2026-10-23" };
    expect(cardSettlements({ statements: [statement], bankRows: [early] })[0].paidBy?.id).toBe("bank-1");

    const tooEarly = { ...debit, bookedAt: "2026-10-22" };
    expect(cardSettlements({ statements: [statement], bankRows: [tooEarly] })[0].paidBy).toBeNull();
  });

  it("sorts newest statement first", () => {
    const older: CardStatementInput = {
      ...statement,
      statementId: "statement-0",
      periodStart: "2026-08-28",
      periodEnd: "2026-09-26",
    };
    const results = cardSettlements({ statements: [older, statement], bankRows: [debit] });
    expect(results.map((result) => result.statementId)).toEqual(["statement-1", "statement-0"]);
  });

  it("handles a statement without a period", () => {
    const [result] = cardSettlements({ statements: [{ ...statement, periodEnd: null }], bankRows: [debit] });
    expect(result.paidBy).toBeNull();
  });
});
