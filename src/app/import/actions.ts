"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  decodeStatementBytes,
  detectSource,
  parseStatement,
  ImportFormatError,
  type NormalizedRow,
} from "@/lib/import";
import { dedupeHash } from "@/lib/import/normalize";
import { categoriseUncategorised } from "@/lib/categorize/rules";
import { AI_MODEL, isAiConfigured, proposeForPreview, type AiGroupInput } from "@/lib/categorize/ai";
import { classifyPreview, loadCategoryOptions } from "@/lib/review/classify";
import type {
  ReviewDecisions,
  ReviewGroup,
  ReviewState,
  RuleProposal,
} from "@/lib/review/types";
import { RULE_MATCH_ON, RULE_OPERATORS, type StatementSource } from "@/lib/types";

// One preview at a time (single user, single machine). The parsed rows wait in
// Setting until the user commits or cancels, so a reload cannot lose the file and
// nothing is written before the confirm step.
const PREVIEW_KEY = "importPreview";

/** A parsed row plus its dedupe hash. `bookedAt` is a string so the preview can
 * survive a JSON round trip through Setting. */
export type PreviewRow = Omit<NormalizedRow, "bookedAt"> & { bookedAt: string; dedupeHash: string };

/** What the AI run proposed, kept so the dialog survives a reload. */
export type StoredProposals = {
  /** group key -> categoryId */
  categories: Record<string, string>;
  /** rule proposals derived from recurrence, snapshotted at propose time */
  rules: Record<string, Omit<RuleProposal, "key" | "proposal">>;
  ran: boolean;
  calls: number;
  error?: string;
};

export type Preview = {
  accountId: string;
  accountName: string;
  source: StatementSource;
  filename: string;
  fileHash: string;
  rows: PreviewRow[];
  duplicates: number;
  rejected: { line: number; reason: string }[];
  sumCents: number;
  periodStart: string | null;
  periodEnd: string | null;
  proposals?: StoredProposals;
};

const uploadSchema = z.object({
  accountId: z.string().min(1),
  source: z.enum([...(["ASN", "PAYPAL", "ICS"] as const), "auto"]).default("auto"),
});

export async function previewUpload(formData: FormData): Promise<void> {
  const parsedForm = uploadSchema.safeParse({
    accountId: formData.get("accountId"),
    source: formData.get("source") ?? "auto",
  });
  const file = formData.get("file");
  if (!parsedForm.success || !(file instanceof File) || file.size === 0) {
    redirect("/import?error=missing-input");
  }

  const account = await prisma.account.findUnique({ where: { id: parsedForm.data.accountId } });
  if (!account) redirect("/import?error=unknown-account");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > 5_000_000) redirect("/import?error=file-too-large");
  const text = decodeStatementBytes(bytes);
  const fileHash = createHash("sha256").update(bytes).digest("hex");

  const seen = await prisma.statement.findUnique({ where: { fileHash } });
  if (seen) redirect("/import?error=already-imported");

  const explicit = parsedForm.data.source;
  const source = explicit === "auto" ? detectSource(file.name, text) : explicit;
  if (!source) redirect("/import?error=unknown-source");

  let result;
  try {
    result = parseStatement(source, text);
  } catch (error) {
    const detail = error instanceof ImportFormatError ? error.message : "unreadable file";
    redirect(`/import?error=${encodeURIComponent(`parse:${detail}`)}`);
  }

  // Occurrence counters make two identical coffees on one day two rows, while a
  // re-import of the same file still produces the same hashes.
  const occurrences = new Map<string, number>();
  const rows: (NormalizedRow & { dedupeHash: string })[] = result.rows.map((row) => {
    const base = [row.bookedAt.toISOString().slice(0, 10), row.amountCents, row.currency, row.merchant].join("|");
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return {
      ...row,
      dedupeHash: dedupeHash({
        accountId: account.id,
        bookedAt: row.bookedAt,
        amountCents: row.amountCents,
        currency: row.currency,
        merchant: row.merchant,
        occurrence,
      }),
    };
  });

  const existing = await prisma.transaction.findMany({
    where: { dedupeHash: { in: rows.map((r) => r.dedupeHash) } },
    select: { dedupeHash: true },
  });
  const known = new Set(existing.map((e) => e.dedupeHash));

  const dates = rows.map((r) => r.bookedAt.getTime());
  const preview: Preview = {
    accountId: account.id,
    accountName: account.name,
    source,
    filename: file.name,
    fileHash,
    rows: rows.map((r) => ({ ...r, bookedAt: r.bookedAt.toISOString() })),
    duplicates: rows.filter((r) => known.has(r.dedupeHash)).length,
    rejected: result.rejected,
    sumCents: rows.reduce((sum, r) => sum + r.amountCents, 0),
    periodStart: dates.length ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : null,
    periodEnd: dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : null,
  };

  await savePreview(preview);

  revalidatePath("/import");
  redirect("/import?preview=1");
}

export async function loadPreview(): Promise<Preview | null> {
  const stored = await prisma.setting.findUnique({ where: { key: PREVIEW_KEY } });
  if (!stored) return null;
  try {
    return JSON.parse(stored.valueJson) as Preview;
  } catch {
    return null;
  }
}

async function savePreview(preview: Preview): Promise<void> {
  await prisma.setting.upsert({
    where: { key: PREVIEW_KEY },
    create: { key: PREVIEW_KEY, valueJson: JSON.stringify(preview) },
    update: { valueJson: JSON.stringify(preview) },
  });
}

/** Rows that will actually be written: duplicates of earlier imports are dropped. */
async function freshRows(preview: Preview): Promise<PreviewRow[]> {
  const known = new Set(
    (
      await prisma.transaction.findMany({
        where: { dedupeHash: { in: preview.rows.map((r) => r.dedupeHash) } },
        select: { dedupeHash: true },
      })
    ).map((r) => r.dedupeHash),
  );
  return preview.rows.filter((row) => !known.has(row.dedupeHash));
}

function toReviewState(
  groups: ReviewGroup[],
  proposals: StoredProposals | undefined,
  categories: Awaited<ReturnType<typeof loadCategoryOptions>>,
): ReviewState {
  const proposed = proposals?.categories ?? {};
  const withProposals = groups.map((group) => {
    const categoryId = proposed[group.key] ?? null;
    return {
      ...group,
      proposedCategoryId: categoryId,
      proposal: categoryId ? ("SUGGESTED" as const) : group.proposal,
    };
  });

  const ruleProposals: RuleProposal[] = Object.entries(proposals?.rules ?? {}).map(([key, rule]) => ({
    key,
    ...rule,
    proposal: "SUGGESTED" as const,
  }));

  return {
    groups: withProposals,
    ruleProposals,
    categories,
    ai: {
      configured: isAiConfigured(),
      model: AI_MODEL,
      ran: proposals?.ran ?? false,
      calls: proposals?.calls ?? 0,
      error: proposals?.error,
    },
  };
}

export type LoadedReview = {
  review: ReviewState;
  summary: {
    filename: string;
    accountName: string;
    source: string;
    rowCount: number;
    duplicates: number;
    sumCents: number;
    periodStart: string | null;
    periodEnd: string | null;
    saveCount: number;
    rejected: { line: number; reason: string }[];
  };
};

/** Everything the review dialog needs, in one round trip. */
export async function loadReview(): Promise<LoadedReview | null> {
  const preview = await loadPreview();
  if (!preview) return null;

  const fresh = await freshRows(preview);
  const [groups, categories] = await Promise.all([
    classifyPreview(
      fresh.map((row) => ({
        bookedAt: row.bookedAt.slice(0, 10),
        amountCents: row.amountCents,
        description: row.description,
        merchant: row.merchant,
      })),
      undefined,
      preview.accountId,
    ),
    loadCategoryOptions(),
  ]);

  return {
    review: toReviewState(groups, preview.proposals, categories),
    summary: {
      filename: preview.filename,
      accountName: preview.accountName,
      source: preview.source,
      rowCount: preview.rows.length,
      duplicates: preview.duplicates,
      sumCents: preview.sumCents,
      periodStart: preview.periodStart,
      periodEnd: preview.periodEnd,
      saveCount: fresh.length,
      rejected: preview.rejected,
    },
  };
}

/**
 * The AI answered for this preview. Nothing is applied: the proposals are stored
 * beside the preview and the user still has to approve them in the dialog.
 * Rules are only proposed for recurring merchants — recurrence decides, never the
 * model, which is what keeps the rule set predictable.
 */
export async function suggestForPreview(): Promise<void> {
  const preview = await loadPreview();
  if (!preview) redirect("/import?error=no-preview");
  if (!isAiConfigured()) redirect("/import?preview=1&ai=not-configured");

  const fresh = await freshRows(preview);
  const [groups, categories] = await Promise.all([
    classifyPreview(
      fresh.map((row) => ({
        bookedAt: row.bookedAt.slice(0, 10),
        amountCents: row.amountCents,
        description: row.description,
        merchant: row.merchant,
      })),
      undefined,
      preview.accountId,
    ),
    loadCategoryOptions(),
  ]);

  const unmatched = groups.filter((group) => !group.match);
  if (unmatched.length === 0 || categories.length === 0) {
    await savePreview({ ...preview, proposals: { categories: {}, rules: {}, ran: true, calls: 0, error: "no-rows" } });
    redirect("/import?preview=1");
  }

  const inputs: AiGroupInput[] = unmatched.map((group) => ({
    key: group.key,
    label: group.label,
    amountCents: group.totalCents,
    rows: group.rows.length,
  }));

  const run = await proposeForPreview(inputs, categories);

  const rules: StoredProposals["rules"] = {};
  for (const group of unmatched) {
    const categoryId = run.categories.get(group.key);
    if (!categoryId || !group.recurring) continue;
    rules[group.key] = {
      name: group.label.slice(0, 60),
      matchOn: "MERCHANT" as const,
      operator: "CONTAINS" as const,
      pattern: group.label.slice(0, 60),
      categoryId,
      hits: group.historyHits + group.rows.length,
    };
  }

  await savePreview({
    ...preview,
    proposals: {
      categories: Object.fromEntries(run.categories),
      rules,
      ran: true,
      calls: run.calls,
      error: run.error,
    },
  });

  revalidatePath("/import");
  redirect("/import?preview=1&ai=done");
}

const decisionsSchema = z.object({
  categories: z.record(z.string(), z.union([z.string(), z.null()])).default({}),
  acceptedRules: z.array(z.string()).default([]),
});

function parseDecisions(raw: FormDataEntryValue | null): ReviewDecisions {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200_000) {
    return { categories: {}, acceptedRules: [] };
  }
  try {
    const parsed = decisionsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { categories: {}, acceptedRules: [] };
  } catch {
    return { categories: {}, acceptedRules: [] };
  }
}

/**
 * Writes the statement, its transactions and the approved rules in one go. Only
 * what the user approved is applied; a group left out of the decisions stays
 * exactly as it was (matched by a rule, or uncategorised).
 */
export async function commitPreview(formData: FormData): Promise<void> {
  const preview = await loadPreview();
  if (!preview) redirect("/import?error=no-preview");

  const decisions = parseDecisions(formData.get("decisions"));
  const fresh = await freshRows(preview);
  const groups = await classifyPreview(
    fresh.map((row) => ({
      bookedAt: row.bookedAt.slice(0, 10),
      amountCents: row.amountCents,
      description: row.description,
      merchant: row.merchant,
    })),
    undefined,
    preview.accountId,
  );

  // A decision is per merchant, the write is per row: map row index -> hash once.
  const hashByIndex = new Map(fresh.map((row, index) => [index, row.dedupeHash]));

  const validCategories = new Set((await loadCategoryOptions()).map((c) => c.id));
  const proposals = preview.proposals?.categories ?? {};

  const perRow = new Map<string, { categoryId: string | null; source: string }>();
  for (const group of groups) {
    const decided = decisions.categories[group.key];
    const chosen = decided === undefined ? (group.match?.categoryId ?? null) : decided;
    if (chosen !== null && !validCategories.has(chosen)) continue;
    const fromAi = chosen !== null && proposals[group.key] === chosen;
    const source = chosen === null ? "NONE" : fromAi ? "AI" : group.match ? "RULE" : "MANUAL";
    for (const row of group.rows) {
      const hash = hashByIndex.get(row.index);
      if (hash) perRow.set(hash, { categoryId: chosen, source });
    }
  }

  const rows = preview.rows.map((row) => ({ ...row, bookedAt: new Date(row.bookedAt) }));

  const statement = await prisma.statement.create({
    data: {
      accountId: preview.accountId,
      source: preview.source,
      filename: preview.filename,
      fileHash: preview.fileHash,
      rowCount: preview.rows.length,
      periodStart: preview.periodStart ? new Date(`${preview.periodStart}T00:00:00.000Z`) : null,
      periodEnd: preview.periodEnd ? new Date(`${preview.periodEnd}T00:00:00.000Z`) : null,
    },
  });

  let rulesCreated = 0;
  const imported = await prisma.$transaction(async (tx) => {
    await tx.transaction.createMany({
      data: fresh.map((row) => {
        const decision = perRow.get(row.dedupeHash);
        const categoryId = decision?.categoryId ?? null;
        return {
          accountId: preview.accountId,
          statementId: statement.id,
          bookedAt: new Date(row.bookedAt),
          amountCents: row.amountCents,
          currency: row.currency,
          description: row.description,
          counterparty: row.counterparty,
          counterpartyIban: row.counterpartyIban,
          merchant: row.merchant,
          balanceAfterCents: row.balanceAfterCents,
          categoryId,
          categorySource: categoryId ? (decision?.source ?? "MANUAL") : "NONE",
          reviewState: categoryId ? "OK" : "UNCATEGORIZED",
          rawJson: row.rawJson,
          dedupeHash: row.dedupeHash,
        };
      }),
    });

    // Only approved rules, only for recurring merchants, never a duplicate.
    for (const key of decisions.acceptedRules) {
      const group = groups.find((candidate) => candidate.key === key);
      // Recurrence is the only gate: a one-off merchant never earns a rule, no
      // matter what the model thought.
      if (!group || !group.recurring) continue;

      const proposal = preview.proposals?.rules[key];
      const decided = decisions.categories[key];
      const categoryId =
        proposal?.categoryId ??
        (decided === null ? undefined : decided) ??
        group.match?.categoryId ??
        undefined;
      if (!categoryId || !validCategories.has(categoryId)) continue;

      const matchOn = proposal && RULE_MATCH_ON.includes(proposal.matchOn) ? proposal.matchOn : "MERCHANT";
      const operator =
        proposal && RULE_OPERATORS.includes(proposal.operator) ? proposal.operator : "CONTAINS";
      const pattern = (proposal?.pattern ?? group.label).slice(0, 60);

      const same = await tx.rule.findFirst({
        where: { matchOn, operator, pattern, categoryId },
        select: { id: true },
      });
      if (same) continue;
      await tx.rule.create({
        data: {
          name: (proposal?.name ?? group.label).slice(0, 60),
          matchOn,
          operator,
          pattern,
          categoryId,
          origin: "LEARNED",
          priority: 100,
        },
      });
      rulesCreated += 1;
    }

    await tx.statement.update({
      where: { id: statement.id },
      data: { importedCount: fresh.length, skippedCount: rows.length - fresh.length },
    });
    return fresh.length;
  });

  await prisma.setting.delete({ where: { key: PREVIEW_KEY } });
  await categoriseUncategorised();

  revalidatePath("/import");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect(`/import?done=${imported}&skipped=${rows.length - imported}&rules=${rulesCreated}`);
}

export async function cancelPreview(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: PREVIEW_KEY } });
  revalidatePath("/import");
  redirect("/import");
}
