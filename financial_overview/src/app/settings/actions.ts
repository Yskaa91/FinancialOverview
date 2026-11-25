"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { CATEGORY_KINDS, RULE_MATCH_ON, RULE_OPERATORS } from "@/lib/types";
import { requireSession } from "@/lib/auth";
import { isSafePattern, MAX_PATTERN_LENGTH } from "@/lib/categorize/rules";
import { pickCategoryColor } from "@/lib/colors";

export type CategoryFormState = { error?: string };

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
  await requireSession();
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

  // No colour typed: pick one from the palette that this ledger is not using yet,
  // so a new category is visually distinct in the charts without the user having
  // to think about hex codes.
  const existingColours = parsed.data.color
    ? []
    : (await prisma.category.findMany({ select: { color: true } })).map((c) => c.color);

  await prisma.category.create({
    data: {
      name: parsed.data.name,
      kind: parsed.data.kind,
      color: parsed.data.color ?? pickCategoryColor(existingColours),
      parentId: typeof parentId === "string" && parentId ? parentId : null,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/transactions");
  revalidatePath("/");
}

/** Deleting a category is refused while transactions or rules point at it. */
/**
 * Editing a category uses the creation fields plus an id. `kind` is editable
 * because a miscategorised income/expense is a real thing to fix; transactions
 * already assigned keep pointing at the same row.
 */
export async function updateCategory(_prev: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  await requireSession();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Unknown category" };

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    color: formData.get("color") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const parentId = formData.get("parentId");
  const parent = typeof parentId === "string" && parentId && parentId !== id ? parentId : null;

  // A parent must be top level: two levels are enough for a personal ledger.
  if (parent) {
    const candidate = await prisma.category.findUnique({ where: { id: parent } });
    if (!candidate || candidate.parentId) return { error: "Pick a top-level category as parent" };
  }

  const clash = await prisma.category.findFirst({
    where: { name: parsed.data.name, kind: parsed.data.kind, parentId: parent, NOT: { id } },
  });
  if (clash) return { error: "A category with that name already exists here" };

  const current = await prisma.category.findUnique({
    where: { id },
    select: { name: true, kind: true, isSystem: true, _count: { select: { children: true } } },
  });
  if (!current) return { error: "Unknown category" };

  // The built-in Transfers category is found by name when imports classify a
  // transfer: renaming it would quietly create a second one, and flipping its kind
  // would undo the rule that keeps transfers out of income and expense. Colour is
  // cosmetic and stays editable.
  if (current.isSystem && (parsed.data.name !== current.name || parsed.data.kind !== current.kind)) {
    return { error: "This category is built in; its name and kind cannot change" };
  }

  // A parent's kind decides what its children mean. Changing it under them would
  // leave an INCOME parent holding EXPENSE children.
  if (parsed.data.kind !== current.kind && current._count.children > 0) {
    return { error: "This category has subcategories; move or rename them before changing its kind" };
  }

  await prisma.category.update({
    where: { id },
    data: {
      name: parsed.data.name,
      kind: parsed.data.kind,
      color: parsed.data.color ?? null,
      parentId: parent,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/transactions");
  revalidatePath("/");
  return {};
}

/**
 * Deletes a category after the user has confirmed the impact shown in the
 * dialog: its transactions survive without a category, its children move up to
 * the top level, and its rules and merchant memory are removed with it.
 */
export async function deleteCategory(formData: FormData): Promise<void> {
  await requireSession();
  const id = formData.get("categoryId");
  if (typeof id !== "string" || !id) return;
  if (formData.get("confirm") !== "delete") return;

  const category = await prisma.category.findUnique({ where: { id }, select: { isSystem: true } });
  // The built-in Transfers category is load-bearing: transfers are classified
  // into it, and deleting it would quietly turn every transfer back into income.
  if (!category || category.isSystem) return;

  await prisma.category.delete({ where: { id } });
  revalidatePath("/settings");
  revalidatePath("/transactions");
  revalidatePath("/");
}

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  matchOn: z.enum(RULE_MATCH_ON),
  operator: z.enum(RULE_OPERATORS),
  pattern: z.string().trim().min(1).max(120),
  categoryId: z.string().min(1),
  priority: z.coerce.number().int().min(1).max(999),
});

/**
 * Refuses a pattern that could backtrack catastrophically. The match path refuses
 * it too, but letting it in at all means a stored rule that silently never runs.
 */
function patternProblem(pattern: string, operator: string): string | null {
  if (pattern.length > MAX_PATTERN_LENGTH) return "pattern-too-long";
  if (operator !== "REGEX") return null;
  const verdict = isSafePattern(pattern);
  return verdict.safe ? null : "unsafe-regex";
}

export async function createRule(formData: FormData): Promise<void> {
  await requireSession();
  const parsed = ruleSchema.safeParse({
    name: formData.get("name"),
    matchOn: formData.get("matchOn"),
    operator: formData.get("operator"),
    pattern: formData.get("pattern"),
    categoryId: formData.get("categoryId"),
    priority: formData.get("priority") ?? 100,
  });
  if (!parsed.success) return;
  if (parsed.data.operator === "REGEX" && !compiles(parsed.data.pattern)) return;
  if (patternProblem(parsed.data.pattern, parsed.data.operator)) return;

  await prisma.rule.create({ data: { ...parsed.data, origin: "MANUAL" } });
  revalidatePath("/settings");
  revalidatePath("/transactions");
}

const ruleUpdateSchema = ruleSchema.extend({
  id: z.string().min(1),
  enabled: z.boolean(),
});

/** A user-supplied regex must compile before it is stored; the engine also guards at match time. */
function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
}

/** Edits one rule in place. Invalid input changes nothing, same as createRule. */
export async function updateRule(formData: FormData): Promise<void> {
  await requireSession();
  const parsed = ruleUpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    matchOn: formData.get("matchOn"),
    operator: formData.get("operator"),
    pattern: formData.get("pattern"),
    categoryId: formData.get("categoryId"),
    priority: formData.get("priority") ?? 100,
    enabled: formData.get("enabled") === "on",
  });
  if (!parsed.success) return;
  if (parsed.data.operator === "REGEX" && !compiles(parsed.data.pattern)) return;
  if (patternProblem(parsed.data.pattern, parsed.data.operator)) return;

  const { id, ...data } = parsed.data;
  await prisma.rule.update({ where: { id }, data });
  revalidatePath("/settings");
  revalidatePath("/transactions");
}

export async function toggleRule(formData: FormData): Promise<void> {
  await requireSession();
  const id = formData.get("ruleId");
  if (typeof id !== "string" || !id) return;
  const rule = await prisma.rule.findUnique({ where: { id } });
  if (!rule) return;
  await prisma.rule.update({ where: { id }, data: { enabled: !rule.enabled } });
  revalidatePath("/settings");
}

const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export async function deleteRule(formData: FormData): Promise<void> {
  await requireSession();
  const id = idSchema.safeParse(formData.get("ruleId"));
  if (!id.success) return;
  await prisma.rule.delete({ where: { id: id.data } });
  revalidatePath("/settings");
}

/** Removes a learned merchant so the next import asks again. */
export async function forgetMerchant(formData: FormData): Promise<void> {
  await requireSession();
  const merchantKey = z.string().min(1).max(120).safeParse(formData.get("merchantKey"));
  if (!merchantKey.success) return;
  await prisma.merchantMap.deleteMany({ where: { merchantKey: merchantKey.data } });
  revalidatePath("/settings");
}
