"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseAmountToCents } from "@/lib/money";
import { ACCOUNT_TYPES, INSTITUTIONS } from "@/lib/types";

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

export async function archiveAccount(id: string, archived: boolean) {
  await prisma.account.update({ where: { id }, data: { archived } });
  revalidatePath("/accounts");
  revalidatePath("/");
}
