"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { CATEGORY_KINDS, RULE_MATCH_ON, RULE_OPERATORS } from "@/lib/types";

const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(CATEGORY_KINDS),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export async function createCategory(formData: FormData): Promise<void> {
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    color: formData.get("color") || undefined,
  });
  if (!parsed.success) return;

  // Two levels are enough for a personal ledger; a child never gets children.
  const parentId = formData.get("parentId");
  const existing = await prisma.category.findFirst({
    where: { name: parsed.data.name, kind: parsed.data.kind },
  });
  if (existing) return;

  await prisma.category.create({
    data: {
      name: parsed.data.name,
      kind: parsed.data.kind,
      color: parsed.data.color ?? null,
      parentId: typeof parentId === "string" && parentId ? parentId : null,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/transactions");
  revalidatePath("/");
}

/** Deleting a category is refused while transactions or rules point at it. */
export async function deleteCategory(formData: FormData): Promise<void> {
  const id = formData.get("categoryId");
  if (typeof id !== "string" || !id) return;

  const [used, rules, children] = await Promise.all([
    prisma.transaction.count({ where: { categoryId: id } }),
    prisma.rule.count({ where: { categoryId: id } }),
    prisma.category.count({ where: { parentId: id } }),
  ]);
  if (used > 0 || rules > 0 || children > 0) return;

  await prisma.category.delete({ where: { id } });
  revalidatePath("/settings");
  revalidatePath("/transactions");
}

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  matchOn: z.enum(RULE_MATCH_ON),
  operator: z.enum(RULE_OPERATORS),
  pattern: z.string().trim().min(1).max(120),
  categoryId: z.string().min(1),
  priority: z.coerce.number().int().min(1).max(999),
});

export async function createRule(formData: FormData): Promise<void> {
  const parsed = ruleSchema.safeParse({
    name: formData.get("name"),
    matchOn: formData.get("matchOn"),
    operator: formData.get("operator"),
    pattern: formData.get("pattern"),
    categoryId: formData.get("categoryId"),
    priority: formData.get("priority") ?? 100,
  });
  if (!parsed.success) return;

  await prisma.rule.create({ data: { ...parsed.data, origin: "MANUAL" } });
  revalidatePath("/settings");
  revalidatePath("/transactions");
}

export async function toggleRule(formData: FormData): Promise<void> {
  const id = formData.get("ruleId");
  if (typeof id !== "string" || !id) return;
  const rule = await prisma.rule.findUnique({ where: { id } });
  if (!rule) return;
  await prisma.rule.update({ where: { id }, data: { enabled: !rule.enabled } });
  revalidatePath("/settings");
}

export async function deleteRule(formData: FormData): Promise<void> {
  const id = formData.get("ruleId");
  if (typeof id !== "string" || !id) return;
  await prisma.rule.delete({ where: { id } });
  revalidatePath("/settings");
}

/** Removes a learned merchant so the next import asks again. */
export async function forgetMerchant(formData: FormData): Promise<void> {
  const merchantKey = formData.get("merchantKey");
  if (typeof merchantKey !== "string" || !merchantKey) return;
  await prisma.merchantMap.deleteMany({ where: { merchantKey } });
  revalidatePath("/settings");
}
