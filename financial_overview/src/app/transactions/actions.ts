"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  applyMerchantToSimilar,
  categoriseUncategorised,
  confirmCategory,
} from "@/lib/categorize/rules";
import { isAiConfigured, suggestForUncategorised } from "@/lib/categorize/ai";
import { ensureTransfersCategory } from "@/lib/categorize/transfers";
import { requireSession } from "@/lib/auth";
import { redirect } from "next/navigation";

const setSchema = z.object({
  transactionId: z.string().min(1),
  categoryId: z.string().min(1),
  scope: z.enum(["one", "merchant"]).default("one"),
});

/** Confirms a category for one row; "merchant" also clears every row of that shop. */
export async function setCategory(formData: FormData): Promise<void> {
  await requireSession();
  const parsed = setSchema.safeParse({
    transactionId: formData.get("transactionId"),
    categoryId: formData.get("categoryId"),
    scope: formData.get("scope") ?? "one",
  });
  if (!parsed.success) return;

  const { transactionId, categoryId, scope } = parsed.data;
  const { learnedMerchantKey } = await confirmCategory(transactionId, categoryId);

  if (scope === "merchant" && learnedMerchantKey) {
    const txn = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (txn?.merchant) await applyMerchantToSimilar(txn.merchant, categoryId);
  }

  revalidatePath("/transactions");
  revalidatePath("/");
  revalidatePath("/settings");
}

/** Runs the rule engine over everything still uncategorised. */
export async function runRules(): Promise<void> {
  await requireSession();
  await categoriseUncategorised();
  revalidatePath("/transactions");
  revalidatePath("/");
  revalidatePath("/settings");
}

/** Moves a row out of income/expense: one transfer category, no pairing. */
export async function markAsTransfer(formData: FormData): Promise<void> {
  await requireSession();
  const id = formData.get("transactionId");
  if (typeof id !== "string" || !id) return;
  const transfersId = await ensureTransfersCategory();
  await prisma.transaction.update({
    where: { id },
    data: { categoryId: transfersId, categorySource: "RULE", reviewState: "OK" },
  });
  revalidatePath("/transactions");
  revalidatePath("/");
}

/**
 * Asks the AI provider for suggestions on rows without a category. Suggestions
 * arrive as SUGGESTED, so this button never changes a category on its own.
 */
export async function suggestWithAi(): Promise<void> {
  await requireSession();
  if (!isAiConfigured()) redirect("/transactions?ai=off");

  const run = await suggestForUncategorised();
  revalidatePath("/transactions");
  revalidatePath("/");
  redirect(
    `/transactions?review=1&suggested=${run.suggested}&calls=${run.calls}${run.error ? `&aiError=${run.error}` : ""}`,
  );
}
