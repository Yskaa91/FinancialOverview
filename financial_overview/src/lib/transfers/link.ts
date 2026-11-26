// Storing what the pairing found. The rules that keep this honest:
//
// - Both rows survive. A link says "same money", it never deletes a leg: the bank
//   needs its row for the balance chain, the wallet needs its row for the shop.
// - Only the leg the pairing did not pick as carrier is excluded from income and
//   expense, and it also gets the Transfers category so the user sees why.
// - A MANUAL category is never overwritten. The exclusion still applies: two legs
//   of one movement cannot both be spending, whatever we call them.
// - Re-running changes nothing: linked rows are not candidates again.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { findTransfersCategoryId } from "@/lib/categorize/transfers";
import {
  accountHints,
  describePair,
  pairTransfers,
  type PairingAccount,
  type PairingRow,
  type TransferLinkKind,
} from "./pairing";

/** Rows cannot be linked across more than this when a human does it by hand. */
export const MANUAL_WINDOW_DAYS = 45;

export type AccountSlice = {
  id: string;
  name: string;
  iban: string | null;
  institution: string;
  type: string;
};

/** What an account means to the pairing: how it is named, and what it can tell us. */
export function pairingAccount(account: AccountSlice): PairingAccount {
  return {
    id: account.id,
    hints: accountHints(account),
    settlesMonthly: account.type === "CREDIT_CARD",
    carriesDetail:
      account.institution === "PAYPAL" || account.institution === "ICS" || account.type === "CREDIT_CARD",
  };
}

type RowSource = {
  id: string;
  accountId: string;
  bookedAt: Date;
  amountCents: number;
  currency: string;
  description: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  merchant: string | null;
};

export function pairingRow(row: RowSource): PairingRow {
  return {
    id: row.id,
    accountId: row.accountId,
    bookedAt: row.bookedAt.toISOString().slice(0, 10),
    amountCents: row.amountCents,
    currency: row.currency,
    // Everything the other statement prints about itself, in one string.
    text: [row.description, row.counterparty, row.counterpartyIban].filter(Boolean).join(" "),
    hasMerchant: row.merchant !== null,
  };
}

const ROW_SELECT = {
  id: true,
  accountId: true,
  transferLinkId: true,
  bookedAt: true,
  amountCents: true,
  currency: true,
  description: true,
  counterparty: true,
  counterpartyIban: true,
  merchant: true,
} satisfies Prisma.TransactionSelect;

export async function loadPairingAccounts(): Promise<PairingAccount[]> {
  const accounts = await prisma.account.findMany({
    select: { id: true, name: true, iban: true, institution: true, type: true },
  });
  return accounts.map(pairingAccount);
}

/**
 * Match everything unlinked inside a window. Returns how many links were created,
 * so the caller can tell the user rather than silently changing the books.
 */
export async function linkTransfers(
  window: { from?: Date; to?: Date } = {},
  options: { method?: "AUTO" | "MANUAL" } = {},
): Promise<{ created: number }> {
  const [accounts, transfersId] = await Promise.all([loadPairingAccounts(), findTransfersCategoryId()]);
  const where: Prisma.TransactionWhereInput = { transferLinkId: null };
  if (window.from || window.to) {
    where.bookedAt = { ...(window.from ? { gte: window.from } : {}), ...(window.to ? { lte: window.to } : {}) };
  }

  const rows = await prisma.transaction.findMany({ where, select: ROW_SELECT, orderBy: { id: "asc" } });
  if (rows.length < 2) return { created: 0 };

  const pairs = pairTransfers({ rows: rows.map(pairingRow), accounts });
  if (pairs.length === 0) return { created: 0 };

  const categoryData = transfersId
    ? { categoryId: transfersId, categorySource: "RULE", reviewState: "OK" }
    : {};

  let created = 0;
  for (const pair of pairs) {
    const excluded = pair.transactionIds.filter((id) => id !== pair.carrierId);
    try {
      await prisma.$transaction(async (tx) => {
        const link = await tx.transferLink.create({
          data: { kind: pair.kind, method: options.method ?? "AUTO" },
        });
        await tx.transaction.updateMany({
          where: { id: { in: pair.transactionIds } },
          data: { transferLinkId: link.id },
        });
        if (excluded.length > 0) {
          await tx.transaction.updateMany({
            where: { id: { in: excluded } },
            data: { excludeFromSpending: true },
          });
          if (transfersId) {
            // The user's own choice wins; the exclusion itself already applies.
            await tx.transaction.updateMany({
              where: { id: { in: excluded }, categorySource: { not: "MANUAL" } },
              data: categoryData,
            });
          }
        }
      });
      created += 1;
    } catch {
      // A pair that fails must not take the rest of the run with it: the rows are
      // still valid, they are just not linked yet.
      continue;
    }
  }

  return { created };
}

/** A window covering a freshly imported statement, with slack for settlement lag. */
export function linkWindowFor(periodStart: string | null, periodEnd: string | null) {
  const slack = 14 * 86_400_000;
  if (!periodStart || !periodEnd) return {};
  return {
    from: new Date(new Date(`${periodStart}T00:00:00.000Z`).getTime() - slack),
    to: new Date(new Date(`${periodEnd}T00:00:00.000Z`).getTime() + slack),
  };
}

export type LinkResult = { ok: true; kind: TransferLinkKind } | { ok: false; reason: string };

/**
 * Linking by hand, for what the automatic pass refuses or misses. Same validation
 * as the automatic path, minus the hint: a human is the hint.
 */
export async function linkPair(leftId: string, rightId: string): Promise<LinkResult> {
  if (leftId === rightId) return { ok: false, reason: "same-transaction" };

  const [rows, accounts, transfersId] = await Promise.all([
    prisma.transaction.findMany({ where: { id: { in: [leftId, rightId] } }, select: ROW_SELECT }),
    loadPairingAccounts(),
    findTransfersCategoryId(),
  ]);
  const [a, b] = rows;
  if (!a || !b) return { ok: false, reason: "missing-transaction" };
  if (a.accountId === b.accountId) return { ok: false, reason: "same-account" };
  if (a.transferLinkId || b.transferLinkId) return { ok: false, reason: "already-linked" };
  if (a.currency !== b.currency) return { ok: false, reason: "currency" };
  if (a.amountCents !== b.amountCents && a.amountCents !== -b.amountCents) {
    return { ok: false, reason: "amount" };
  }

  const gap = Math.abs(
    Math.round((a.bookedAt.getTime() - b.bookedAt.getTime()) / 86_400_000),
  );
  if (gap > MANUAL_WINDOW_DAYS) return { ok: false, reason: "too-far-apart" };

  const accountA = accounts.find((account) => account.id === a.accountId);
  const accountB = accounts.find((account) => account.id === b.accountId);
  if (!accountA || !accountB) return { ok: false, reason: "missing-account" };

  const described = describePair(pairingRow(a), pairingRow(b), accountA, accountB);
  if (!described) return { ok: false, reason: "same-direction-on-two-cards" };

  const excluded = [a.id, b.id].filter((id) => id !== described.carrierId);
  await prisma.$transaction(async (tx) => {
    const link = await tx.transferLink.create({ data: { kind: described.kind, method: "MANUAL" } });
    await tx.transaction.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { transferLinkId: link.id },
    });
    if (excluded.length > 0) {
      await tx.transaction.updateMany({
        where: { id: { in: excluded } },
        data: { excludeFromSpending: true },
      });
      if (transfersId) {
        await tx.transaction.updateMany({
          where: { id: { in: excluded }, categorySource: { not: "MANUAL" } },
          data: { categoryId: transfersId, categorySource: "RULE", reviewState: "OK" },
        });
      }
    }
  });

  return { ok: true, kind: described.kind };
}

/**
 * Undo a link. The rows go back to counting, and the category we assigned goes
 * back to empty — but a category the user chose is theirs to keep.
 */
export async function unlinkTransfer(linkId: string): Promise<{ ok: boolean }> {
  const transfersId = await findTransfersCategoryId();
  const link = await prisma.transferLink.findUnique({
    where: { id: linkId },
    select: { id: true, transactions: { select: { id: true, categoryId: true, categorySource: true } } },
  });
  if (!link) return { ok: false };

  const ids = link.transactions.map((row) => row.id);
  const ours = link.transactions
    .filter((row) => row.categorySource !== "MANUAL" && (!transfersId || row.categoryId === transfersId))
    .map((row) => row.id);

  await prisma.$transaction(async (tx) => {
    await tx.transaction.updateMany({
      where: { id: { in: ids } },
      data: { transferLinkId: null, excludeFromSpending: false },
    });
    if (ours.length > 0) {
      await tx.transaction.updateMany({
        where: { id: { in: ours } },
        data: { categoryId: null, categorySource: "NONE", reviewState: "UNCATEGORIZED" },
      });
    }
    await tx.transferLink.delete({ where: { id: linkId } });
  });

  return { ok: true };
}
