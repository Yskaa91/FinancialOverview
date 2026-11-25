"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseAmountToCents } from "@/lib/money";
import { ACCOUNT_TYPES, INSTITUTIONS } from "@/lib/types";
import { requireSession } from "@/lib/auth";

const createAccountSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  type: z.enum(ACCOUNT_TYPES),
  institution: z.enum(INSTITUTIONS),
  iban: z.string().trim().max(34).optional(),
  openingBalance: z.string().trim().optional(),
});

export type FormState = { error?: string };

export async function createAccount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = createAccountSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    institution: formData.get("institution"),
    iban: formData.get("iban") || undefined,
    openingBalance: formData.get("openingBalance") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { openingBalance, ...rest } = parsed.data;
  const openingBalanceCents = openingBalance ? parseAmountToCents(openingBalance) : 0;
  if (openingBalanceCents === null) return { error: "Opening balance is not a number" };

  await prisma.account.create({
    data: {
      ...rest,
      iban: rest.iban || null,
      openingBalanceCents,
      currency: "EUR",
    },
  });

  revalidatePath("/accounts");
  revalidatePath("/");
  return {};
}

/**
 * The creation form plus an id. Editing an account must be able to change
 * everything the create form asks for, including the opening balance, which is
 * the only place a starting figure can be corrected.
 */
export async function updateAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Unknown account" };

  const parsed = createAccountSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    institution: formData.get("institution"),
    iban: formData.get("iban") || undefined,
    openingBalance: formData.get("openingBalance") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { openingBalance, ...rest } = parsed.data;
  const openingBalanceCents =
    openingBalance === undefined ? undefined : parseAmountToCents(openingBalance);
  if (openingBalanceCents === null) return { error: "Opening balance is not a number" };

  await prisma.account.update({
    where: { id },
    data: {
      ...rest,
      iban: rest.iban || null,
      ...(openingBalanceCents === undefined ? {} : { openingBalanceCents }),
    },
  });

  revalidatePath("/accounts");
  revalidatePath("/accounts/[id]", "page");
  revalidatePath("/");
  return {};
}

export async function archiveAccount(formData: FormData): Promise<void> {
  await requireSession();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const archived = formData.get("archived") === "true";
  await prisma.account.update({ where: { id }, data: { archived } });
  revalidatePath("/accounts");
  revalidatePath("/");
}

/**
 * Hard delete. Transactions, statements, trades, snapshots and account-scoped
 * rules go with it (Prisma cascade), which is why the UI shows the counts and
 * asks for an explicit confirmation string first.
 */
export async function deleteAccount(formData: FormData): Promise<void> {
  await requireSession();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  if (formData.get("confirm") !== "delete") return;

  await prisma.account.delete({ where: { id } });
  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidatePath("/");
}
