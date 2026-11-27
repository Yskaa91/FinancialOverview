// What still does not add up. Every row here is a fact the app cannot resolve on
// its own: a bank debit whose PayPal statement was never imported, a wallet row
// nothing paid for, or two rows that are the same money but were not linked.

import { prisma } from "@/lib/db";
import { daysAgo } from "@/lib/dates";
import { textNamesHint, type PairingAccount } from "@/lib/transfers/pairing";
import { pairingAccount } from "@/lib/transfers/link";
import { cardSettlements, type BankRowInput, type CardSettlement } from "@/lib/transfers/card-settlement";

/** Looking back this far covers a year of statements without scanning everything. */
const LOOKBACK_DAYS = 400;
/** How wide a manual suggestion may be. Wider than the automatic window on purpose. */
const SUGGESTION_DAYS = 14;

export type ReconRow = {
  id: string;
  bookedAt: Date;
  amountCents: number;
  accountId: string;
  accountName: string;
  label: string;
  description: string;
  excluded: boolean;
};

export type ReconPair = {
  linkId: string;
  kind: string;
  method: string;
  left: ReconRow;
  right: ReconRow;
};

export type ReconCandidate = {
  id: string;
  bookedAt: Date;
  amountCents: number;
  accountName: string;
  label: string;
};

export type ReconUnmatched = ReconRow & {
  /** Equal amount, close in date, other account: what a human would try first. */
  candidates: ReconCandidate[];
};

export type ReconCoverage = {
  accountId: string;
  accountName: string;
  institution: string;
  statements: number;
  lastImport: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
};

export type Reconciliation = {
  pairs: ReconPair[];
  pairsTotal: number;
  unmatched: ReconUnmatched[];
  /**
   * Card statements, checked as totals. A card is collected once a month, so its
   * individual rows never have a partner; the statement sum is what settles.
   */
  cardStatements: CardSettlement[];
  coverage: ReconCoverage[];
};

export async function loadReconciliation(): Promise<Reconciliation> {
  const accounts = await prisma.account.findMany({
    select: { id: true, name: true, iban: true, institution: true, type: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  });
  const pairingAccounts = new Map<string, PairingAccount>(
    accounts.map((account) => [account.id, pairingAccount(account)]),
  );

  const [links, pairsTotal, unlinked, statements] = await Promise.all([
    prisma.transferLink.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        transactions: {
          select: {
            id: true,
            bookedAt: true,
            amountCents: true,
            description: true,
            merchant: true,
            counterparty: true,
            excludeFromSpending: true,
            account: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.transferLink.count(),
    prisma.transaction.findMany({
      where: { transferLinkId: null, bookedAt: { gte: daysAgo(LOOKBACK_DAYS) } },
      orderBy: { bookedAt: "desc" },
      select: {
        id: true,
        accountId: true,
        bookedAt: true,
        amountCents: true,
        currency: true,
        description: true,
        merchant: true,
        counterparty: true,
        counterpartyIban: true,
        excludeFromSpending: true,
        account: { select: { id: true, name: true } },
      },
    }),
    prisma.statement.findMany({
      select: {
        id: true,
        accountId: true,
        importedAt: true,
        periodStart: true,
        periodEnd: true,
        transactions: { select: { amountCents: true } },
      },
      orderBy: { importedAt: "desc" },
    }),
  ]);

  const pairs: ReconPair[] = [];
  for (const link of links) {
    const [left, right] = link.transactions.map(toReconRow);
    if (!left || !right) continue;
    pairs.push({ linkId: link.id, kind: link.kind, method: link.method, left, right });
  }

  // A row is "unmatched" when it names another account the user owns: that is the
  // half of a settlement whose other statement is missing or unlinked.
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const unmatched: ReconUnmatched[] = [];
  for (const row of unlinked) {
    // A card's own rows are never expected to find a partner row: the card is
    // collected as one monthly debit. They are checked per statement below, so
    // listing them here only buries the rows that do need attention.
    if (pairingAccounts.get(row.accountId)?.settlesMonthly) continue;

    const text = [row.description, row.counterparty, row.counterpartyIban].filter(Boolean).join(" ");
    const namesAnother = [...pairingAccounts.entries()].some(
      ([id, account]) => id !== row.accountId && account.hints.some((hint) => textNamesHint(text, hint)),
    );
    const isWallet = pairingAccounts.get(row.accountId)?.carriesDetail ?? false;
    if (!namesAnother && !isWallet) continue;

    unmatched.push({
      ...toReconRow(row),
      candidates: candidatesFor(row.id, row.amountCents, row.bookedAt, row.accountId, unlinked, accountById),
    });
  }

  const coverage: ReconCoverage[] = accounts.map((account) => {
    const own = statements.filter((statement) => statement.accountId === account.id);
    const starts = own.map((statement) => statement.periodStart).filter((value): value is Date => !!value);
    const ends = own.map((statement) => statement.periodEnd).filter((value): value is Date => !!value);
    return {
      accountId: account.id,
      accountName: account.name,
      institution: account.institution,
      statements: own.length,
      lastImport: own[0]?.importedAt ?? null,
      periodStart: starts.length > 0 ? new Date(Math.min(...starts.map((value) => value.getTime()))) : null,
      periodEnd: ends.length > 0 ? new Date(Math.max(...ends.map((value) => value.getTime()))) : null,
    };
  });

  const cardStatements = cardSettlements({
    statements: statements
      .filter((statement) => pairingAccounts.get(statement.accountId)?.settlesMonthly)
      .map((statement) => ({
        accountId: statement.accountId,
        accountName: accountById.get(statement.accountId)?.name ?? statement.accountId,
        statementId: statement.id,
        periodStart: statement.periodStart?.toISOString().slice(0, 10) ?? null,
        periodEnd: statement.periodEnd?.toISOString().slice(0, 10) ?? null,
        amounts: statement.transactions.map((transaction) => transaction.amountCents),
      })),
    bankRows: [
      ...unlinked.map((row) => toBankRow(row, row.accountId, accountById)),
      // A bill that was linked by hand must not look unpaid.
      ...links.flatMap((link) =>
        link.transactions.map((transaction) => toBankRow(transaction, transaction.account.id, accountById)),
      ),
    ],
  });

  return { pairs, pairsTotal, unmatched: unmatched.slice(0, 60), cardStatements, coverage };
}

/** The bank side of a card collection, in the shape the settlement check wants. */
function toBankRow(
  row: {
    id: string;
    bookedAt: Date;
    amountCents: number;
    description: string;
    merchant: string | null;
    counterparty: string | null;
  },
  accountId: string,
  accounts: Map<string, { name: string }>,
): BankRowInput {
  return {
    id: row.id,
    accountId,
    accountName: accounts.get(accountId)?.name ?? accountId,
    bookedAt: row.bookedAt.toISOString().slice(0, 10),
    amountCents: row.amountCents,
    label: row.merchant ?? row.counterparty ?? row.description,
  };
}

function toReconRow(row: {
  id: string;
  bookedAt: Date;
  amountCents: number;
  description: string;
  merchant: string | null;
  counterparty: string | null;
  excludeFromSpending: boolean;
  account: { id: string; name: string };
}): ReconRow {
  return {
    id: row.id,
    bookedAt: row.bookedAt,
    amountCents: row.amountCents,
    accountId: row.account.id,
    accountName: row.account.name,
    label: row.merchant ?? row.counterparty ?? row.description,
    description: row.description,
    excluded: row.excludeFromSpending,
  };
}

function candidatesFor(
  id: string,
  amountCents: number,
  bookedAt: Date,
  accountId: string,
  rows: {
    id: string;
    accountId: string;
    bookedAt: Date;
    amountCents: number;
    description: string;
    merchant: string | null;
    counterparty: string | null;
    currency: string;
    account: { name: string };
  }[],
  accounts: Map<string, { name: string }>,
): ReconCandidate[] {
  const limit = SUGGESTION_DAYS * 86_400_000;
  return rows
    .filter(
      (row) =>
        row.id !== id &&
        row.accountId !== accountId &&
        (row.amountCents === amountCents || row.amountCents === -amountCents) &&
        Math.abs(row.bookedAt.getTime() - bookedAt.getTime()) <= limit,
    )
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      bookedAt: row.bookedAt,
      amountCents: row.amountCents,
      accountName: accounts.get(row.accountId)?.name ?? row.account.name,
      label: row.merchant ?? row.counterparty ?? row.description,
    }));
}
