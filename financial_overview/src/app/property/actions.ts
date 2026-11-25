"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { parseAmountToCents } from "@/lib/money";
import { resolveRegion } from "@/lib/property/cbs";
import { refreshPropertyValues } from "@/lib/queries/property";

const propertySchema = z.object({
  address: z.string().trim().min(3).max(200),
  region: z.string().trim().min(2).max(80),
  label: z.string().trim().max(60).optional(),
  purchasePrice: z.string().trim().min(1),
  purchasedAt: z.string().min(1),
});

/** Adds a home. The region is resolved to a CBS code; the address never leaves. */
export async function addProperty(formData: FormData): Promise<void> {
  await requireSession();
  const parsed = propertySchema.safeParse({
    address: formData.get("address"),
    region: formData.get("region"),
    label: formData.get("label") || undefined,
    purchasePrice: formData.get("purchasePrice"),
    purchasedAt: formData.get("purchasedAt"),
  });
  if (!parsed.success) redirect("/property?error=invalid");

  const purchasePriceCents = parseAmountToCents(parsed.data.purchasePrice);
  if (purchasePriceCents === null || purchasePriceCents <= 0) {
    redirect("/property?error=price");
  }

  const purchasedAt = new Date(`${parsed.data.purchasedAt}T00:00:00.000Z`);
  if (Number.isNaN(purchasedAt.getTime())) redirect("/property?error=date");

  const region = await resolveRegion(parsed.data.region);
  if (!region) redirect("/property?error=unknown-region");

  await prisma.property.create({
    data: {
      label: parsed.data.label ?? null,
      address: parsed.data.address,
      regionCode: region.code,
      regionName: region.name,
      purchasePriceCents,
      purchasedAt,
    },
  });

  await refreshPropertyValues();
  revalidatePath("/property");
  revalidatePath("/");
  redirect("/property?done=1");
}

export async function deleteProperty(formData: FormData): Promise<void> {
  await requireSession();
  const id = formData.get("id");
  if (typeof id !== "string") return;
  await prisma.property.delete({ where: { id } });
  revalidatePath("/property");
  revalidatePath("/");
}

/** Manual refresh, ignoring the one-day window. */
export async function refreshProperties(): Promise<void> {
  await requireSession();
  await refreshPropertyValues({ force: true });
  revalidatePath("/property");
  revalidatePath("/");
}
