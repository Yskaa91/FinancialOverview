// Account-to-account movements get one system category and no balancing: the
// PayPal "-X to ASN" and the ASN "+X from PayPal" are two rows of one transfer,
// and hiding both from spending reports is all the user wants.
//
// Detection is deliberately conservative: a wrong transfer silently removes real
// spending from every report, so a word like "overboeking" alone proves nothing.

import { prisma } from "@/lib/db";

export const TRANSFER_CATEGORY_NAME = "Transfers";

export type OwnAccount = { id: string; name: string; iban: string | null };

/** Money moving between the user's own accounts. */
const MOVEMENT = /\b(naar|van|transfer|overboeking|opname|storting)\b/i;
/** A card settlement line: money moving between the card and the bank. */
const CARD_SETTLEMENT = /GEINCASSEERD|VORIG SALDO/i;

/** The one system category every account-to-account movement lands in. */
export async function ensureTransfersCategory(): Promise<string> {
  const existing = await findTransfersCategoryId();
  if (existing) return existing;
  const created = await prisma.category.create({
    data: { name: TRANSFER_CATEGORY_NAME, kind: "TRANSFER", isSystem: true },
    select: { id: true },
  });
  return created.id;
}

/** Read-only lookup: null when the category does not exist yet. */
export async function findTransfersCategoryId(): Promise<string | null> {
  const category = await prisma.category.findFirst({
    where: { name: TRANSFER_CATEGORY_NAME, kind: "TRANSFER" },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  return category?.id ?? null;
}

export async function loadOwnAccounts(): Promise<OwnAccount[]> {
  return prisma.account.findMany({ select: { id: true, name: true, iban: true }, orderBy: { sortOrder: "asc" } });
}

/**
 * Hard signals only: an own IBAN in the counterparty field, an own IBAN or own
 * account name inside the description, or a card settlement line.
 */
export function isAccountTransfer(
  row: {
    accountId?: string;
    description: string;
    counterparty?: string | null;
    counterpartyIban?: string | null;
  },
  own: OwnAccount[],
): { transfer: true; reason: string } | null {
  // The row's own account is never its counterparty.
  const others = own.filter((account) => account.id !== row.accountId);

  const counterpartyText = [row.counterpartyIban, row.counterparty].filter(Boolean).join(" ");
  for (const account of others) {
    if (textHasIban(counterpartyText, account.iban)) return { transfer: true, reason: "own-iban-counterparty" };
  }

  for (const account of others) {
    if (textHasIban(row.description, account.iban)) return { transfer: true, reason: "own-iban-description" };
  }

  const description = collapse(row.description);
  for (const account of others) {
    const name = collapse(account.name);
    if (name.length >= 4 && description.includes(name) && MOVEMENT.test(description)) {
      return { transfer: true, reason: "own-account-name" };
    }
  }

  if (CARD_SETTLEMENT.test(row.description)) return { transfer: true, reason: "card-settlement" };
  return null;
}

function collapse(value: string): string {
  return value.toUpperCase().replace(/\s+/g, " ").trim();
}

/** Uppercase alphanumerics only: "NL91 ABNA 0417 1643 00" -> "NL91ABNA0417164300". */
function ibanKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function textHasIban(text: string, iban: string | null): boolean {
  if (!text || !iban) return false;
  const key = ibanKey(iban);
  if (!iban.includes("*") && key.length >= 8 && ibanKey(text).includes(key)) return true;

  // A masked card number ("****4321") names the account by its last digits, so
  // one side masked is enough: the other side still has the digits.
  const digits = key.replace(/\D/g, "");
  if (digits.length < 4) return false;
  for (const match of text.matchAll(/\*+\s*(\d{4,})/g)) {
    if (digits.endsWith(match[1])) return true;
  }
  return false;
}
