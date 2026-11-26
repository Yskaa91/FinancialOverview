import { describe, expect, it } from "vitest";

import {
  accountHints,
  pairTransfers,
  textNamesHint,
  type PairingAccount,
  type PairingRow,
} from "@/lib/transfers/pairing";

const ASN = "acc-asn";
const PAYPAL = "acc-paypal";
const ICS = "acc-ics";

const accounts: PairingAccount[] = [
  {
    id: ASN,
    hints: accountHints({ name: "ASN Betaalrekening", iban: "NL80SNSB0339881577", institution: "ASN" }),
    settlesMonthly: false,
    carriesDetail: false,
  },
  {
    id: PAYPAL,
    hints: accountHints({ name: "PayPal", iban: null, institution: "PAYPAL" }),
    settlesMonthly: false,
    carriesDetail: true,
  },
  {
    id: ICS,
    hints: accountHints({ name: "ICS Card", iban: "****7213", institution: "ICS" }),
    settlesMonthly: true,
    carriesDetail: true,
  },
];

function row(overrides: Partial<PairingRow> & Pick<PairingRow, "id" | "accountId" | "amountCents" | "text">): PairingRow {
  return {
    bookedAt: "2026-10-05",
    currency: "EUR",
    hasMerchant: false,
    ...overrides,
  };
}

describe("accountHints", () => {
  it("names a wallet and a card, never a plain bank by its institution", () => {
    expect(accountHints({ name: "PayPal", iban: null, institution: "PAYPAL" })).toContain("paypal");
    const card = accountHints({ name: "ICS Card", iban: null, institution: "ICS" });
    expect(card).toEqual(expect.arrayContaining(["card services", "creditcard", "ics"]));
    const bank = accountHints({ name: "ASN Betaalrekening", iban: "NL80SNSB0339881577", institution: "ASN" });
    expect(bank).toContain("NL80SNSB0339881577");
    expect(bank).toContain("ASN Betaalrekening");
  });

  it("ignores names too short to be evidence", () => {
    expect(accountHints({ name: "AB", iban: null, institution: "OTHER" })).toEqual([]);
  });
});

describe("textNamesHint", () => {
  it("matches whole words only", () => {
    expect(textNamesHint("Incasso creditcard ICS-klantnummer 79787290018", "ics")).toBe(true);
    expect(textNamesHint("statistics for march", "ics")).toBe(false);
  });

  it("matches an IBAN regardless of spacing", () => {
    expect(textNamesHint("Naar NL80 SNSB 0339 8815 77", "NL80SNSB0339881577")).toBe(true);
    expect(textNamesHint("Naar NL80SNSB0339881577", "NL80SNSB0339881577")).toBe(true);
    expect(textNamesHint("Naar NL80SNSB0339881578", "NL80SNSB0339881577")).toBe(false);
  });

  it("matches a customer number hiding in a longer narrative", () => {
    expect(
      textNamesHint("Europese incasso: Incasso okt 2026 ICS-klantnummer 79787290018-06102CI001029285", "79787290018"),
    ).toBe(true);
  });

  it("does not match on nothing", () => {
    expect(textNamesHint("", "ics")).toBe(false);
    expect(textNamesHint("anything", "")).toBe(false);
  });
});

describe("pairTransfers", () => {
  // The real rows: the bank's direct debit and the PayPal purchase it paid for.
  const bankLeg = row({
    id: "asn-1",
    accountId: ASN,
    amountCents: -9379,
    bookedAt: "2026-10-07",
    text: "Europese incasso: LU-1053541659174/PAYPAL-Incassant ID: LU96ZZZ0000000000000000058 PayPal Europe S.a.r.l.",
  });
  const paypalLeg = row({
    id: "pp-1",
    accountId: PAYPAL,
    amountCents: -9379,
    bookedAt: "2026-10-05",
    text: "Express Checkout Payment Servicecenter Windhorn",
    hasMerchant: true,
  });

  it("links a bank debit to the wallet purchase it funded", () => {
    expect(pairTransfers({ rows: [bankLeg, paypalLeg], accounts })).toEqual([
      { transactionIds: ["asn-1", "pp-1"], kind: "FUNDING", dayGap: 2, carrierId: "pp-1" },
    ]);
  });

  it("links a card collection to the card credit, counting neither side", () => {
    const bank = row({
      id: "asn-2",
      accountId: ASN,
      amountCents: -37745,
      bookedAt: "2026-10-30",
      text: "Europese incasso: Incasso okt 2026 betreffende uw creditcard ICS-klantnummer 79787290018 INT CARD SERVICES",
    });
    const card = row({ id: "ics-1", accountId: ICS, amountCents: 37745, bookedAt: "2026-10-31", text: "GEINCASSEERD VORIG SALDO", hasMerchant: false });
    expect(pairTransfers({ rows: [bank, card], accounts })).toEqual([
      { transactionIds: ["asn-2", "ics-1"], kind: "SETTLEMENT", dayGap: 1, carrierId: null },
    ]);
  });

  it("refuses two rows that do not name each other", () => {
    const stranger = row({ id: "pp-2", accountId: PAYPAL, amountCents: -9379, bookedAt: "2026-10-05", text: "Some other shop", hasMerchant: true });
    const unrelated = row({ id: "asn-3", accountId: ASN, amountCents: -9379, bookedAt: "2026-10-05", text: "LIDL 1234" });
    expect(pairTransfers({ rows: [unrelated, stranger], accounts })).toEqual([]);
  });

  it("refuses a pair outside the window", () => {
    const late = { ...paypalLeg, bookedAt: "2026-10-20" };
    expect(pairTransfers({ rows: [bankLeg, late], accounts })).toEqual([]);
  });

  it("refuses two credit-card rows of the same sign", () => {
    const a = row({ id: "ics-a", accountId: ICS, amountCents: -500, bookedAt: "2026-10-05", text: "card services", hasMerchant: true });
    const b = row({ id: "ics-b", accountId: ICS, amountCents: -500, bookedAt: "2026-10-05", text: "card services", hasMerchant: true });
    expect(pairTransfers({ rows: [a, b], accounts })).toEqual([]);
  });

  it("uses each row once, even when three rows share an amount", () => {
    // 7 Oct 2026 in the real statement: a purchase, its refund, a withdrawal, one
    // direct debit, one incoming transfer.
    const rows: PairingRow[] = [
      row({ id: "asn-out", accountId: ASN, amountCents: -585, bookedAt: "2026-10-09", text: "Europese incasso PAYPAL Europe" }),
      row({ id: "asn-in", accountId: ASN, amountCents: 585, bookedAt: "2026-10-08", text: "YYW1053596351497 PayPal Europe" }),
      row({ id: "pp-buy", accountId: PAYPAL, amountCents: -585, bookedAt: "2026-10-07", text: "Express Checkout Payment Valve", hasMerchant: true }),
      row({ id: "pp-out", accountId: PAYPAL, amountCents: -585, bookedAt: "2026-10-07", text: "User Initiated Withdrawal" }),
      row({ id: "pp-refund", accountId: PAYPAL, amountCents: 585, bookedAt: "2026-10-07", text: "Payment Refund Valve", hasMerchant: true }),
    ];
    const pairs = pairTransfers({ rows, accounts });
    const used = pairs.flatMap((pair) => pair.transactionIds);
    expect(new Set(used).size).toBe(used.length);
    expect(pairs).toHaveLength(2);
    // Money arriving from the wallet is the withdrawal landing, not the refund: two
    // credits would be the same money twice. Internal either way, so neither counts.
    const landing = pairs.find((pair) => pair.transactionIds.includes("asn-in"));
    expect(landing?.transactionIds).toContain("pp-out");
    expect(landing?.carrierId).toBeNull();
    // The funded purchase keeps counting, on the PayPal side.
    const funding = pairs.find((pair) => pair.transactionIds.includes("asn-out"));
    expect(funding?.transactionIds).toContain("pp-buy");
    expect(funding?.carrierId).toBe("pp-buy");
    // The refund offsets its own purchase, which is inside PayPal: not our business.
    expect(used).not.toContain("pp-refund");
  });

  it("produces the same pairs whatever order the rows arrive in", () => {
    const rows = [bankLeg, paypalLeg];
    const first = pairTransfers({ rows, accounts });
    const second = pairTransfers({ rows: [...rows].reverse(), accounts });
    expect(second).toEqual(first);
  });

  it("never pairs a row with itself or with its own account", () => {
    const twin = { ...bankLeg, id: "asn-twin" };
    expect(pairTransfers({ rows: [bankLeg, twin], accounts })).toEqual([]);
  });
});
