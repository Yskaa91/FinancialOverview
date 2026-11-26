"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { daysAgo } from "@/lib/dates";
import { requireSession } from "@/lib/auth";
import { linkPair, linkTransfers, unlinkTransfer } from "@/lib/transfers/link";

const linkSchema = z.object({
  leftId: z.string().min(1),
  rightId: z.string().min(1),
});

const unlinkSchema = z.object({ linkId: z.string().min(1) });

/**
 * Run the pairing again over the last year. Safe to press repeatedly: linked rows
 * are never candidates, so a second run finds nothing new.
 */
export async function matchTransfers(): Promise<void> {
  await requireSession();
  const { created } = await linkTransfers({ from: daysAgo(400) });

  revalidatePath("/reconcile");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect(`/reconcile?matched=${created}`);
}

/** Link two rows the automatic pass refused or missed. */
export async function linkByHand(formData: FormData): Promise<void> {
  await requireSession();
  const parsed = linkSchema.safeParse({
    leftId: formData.get("leftId"),
    rightId: formData.get("rightId"),
  });
  if (!parsed.success) redirect("/reconcile?error=missing-input");

  const result = await linkPair(parsed.data.leftId, parsed.data.rightId);
  revalidatePath("/reconcile");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect(result.ok ? "/reconcile?linked=1" : `/reconcile?error=${result.reason}`);
}

export async function breakLink(formData: FormData): Promise<void> {
  await requireSession();
  const parsed = unlinkSchema.safeParse({ linkId: formData.get("linkId") });
  if (!parsed.success) redirect("/reconcile?error=missing-input");

  await unlinkTransfer(parsed.data.linkId);
  revalidatePath("/reconcile");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect("/reconcile?unlinked=1");
}
