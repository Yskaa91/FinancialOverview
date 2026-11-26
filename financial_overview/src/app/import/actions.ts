"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  decodeStatementBytes,
  detectPdfSource,
  detectSource,
  parsePdfStatement,
  parseStatement,
  ImportFormatError,
  type NormalizedRow,
} from "@/lib/import";
import { extractPdfLines, looksLikePdf } from "@/lib/import/pdf";
import { dedupeHash } from "@/lib/import/normalize";
import { categoriseUncategorised } from "@/lib/categorize/rules";
import { AI_MODEL, isAiConfigured, proposeForPreview, type AiGroupInput } from "@/lib/categorize/ai";
import { classifyPreview, loadCategoryOptions } from "@/lib/review/classify";
import { ruleCategoryFor } from "@/lib/review/rule-category";
import { findDuplicateCandidates } from "@/lib/import/duplicates";
import { ensureTransfersCategory } from "@/lib/categorize/transfers";
import { linkTransfers, linkWindowFor } from "@/lib/transfers/link";
import type {
  DuplicateCandidate,
  ReviewDecisions,
  ReviewGroup,
  ReviewState,
  RuleProposal,
} from "@/lib/review/types";
import { RULE_MATCH_ON, RULE_OPERATORS, type StatementSource } from "@/lib/types";
import { requireSession } from "@/lib/auth";

// One preview at a time (single user, single machine). The parsed rows wait in
// Setting until the user commits or cancels, so a reload cannot lose the file and
// nothing is written before the confirm step.
const PREVIEW_KEY = "importPreview";
/** Above this, the review dialog stops being a dialog. */
const MAX_STATEMENT_ROWS = 20_000;

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
  await requireSession();
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
  // ICS only publishes PDF, so the upload path accepts both: the bytes decide,
  // never the extension.
  const isPdf = looksLikePdf(bytes);
  const text = isPdf ? "" : decodeStatementBytes(bytes);
  const fileHash = createHash("sha256").update(bytes).digest("hex");

  const seen = await prisma.statement.findUnique({ where: { fileHash } });
  if (seen) redirect("/import?error=already-imported");

  let pdfLines: string[] = [];
  if (isPdf) {
    try {
      pdfLines = await extractPdfLines(bytes);
    } catch {
      redirect("/import?error=unreadable-pdf");
    }
    if (pdfLines.length === 0) redirect("/import?error=unreadable-pdf");
  }

  const explicit = parsedForm.data.source;
  const source =
    explicit === "auto" ? (isPdf ? detectPdfSource(pdfLines) : detectSource(file.name, text)) : explicit;
  if (!source) redirect("/import?error=unknown-source");

  let result: ReturnType<typeof parseStatement>;
  try {
    result = isPdf ? parsePdfStatement(source, pdfLines) : parseStatement(source, text);
  } catch (error) {
    const detail = error instanceof ImportFormatError ? error.message : "unreadable file";
    redirect(`/import?error=${encodeURIComponent(`parse:${detail}`)}`);
  }

  // A 1 MB file can carry tens of thousands of rows, and every one of them is
  // grouped, classified and duplicate-checked on each render of the review. Bound
  // it where the work would start, with a message the user can act on.
  if (result.rows.length > MAX_STATEMENT_ROWS) {
    redirect(`/import?error=${encodeURIComponent(`too-many-rows:${result.rows.length}`)}`);
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

  // Spread into Math.min/Math.max throws above ~125k arguments, and a preview of
  // that size is unusable anyway: bound it here, loudly.
  let firstDay = Number.POSITIVE_INFINITY;
  let lastDay = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const day = row.bookedAt.getTime();
    if (day < firstDay) firstDay = day;
    if (day > lastDay) lastDay = day;
  }

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
    periodStart: rows.length ? new Date(firstDay).toISOString().slice(0, 10) : null,
    periodEnd: rows.length ? new Date(lastDay).toISOString().slice(0, 10) : null,
  };

  // Creating the preview is a write path, so the transfer category may be created
  // here: the dialog can then recognise account movements straight away.
  await ensureTransfersCategory();
  await savePreview(preview);

  revalidatePath("/import");
  redirect("/import?preview=1");
}

export async function loadPreview(): Promise<Preview | null> {
  await requireSession();
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

/** Rows of this account within a fortnight of the import: the duplicate window. */
async function loadDuplicateCandidates(preview: Preview): Promise<DuplicateCandidate[]> {
  if (preview.rows.length === 0) return [];
  const days = preview.rows.map((row) => new Date(row.bookedAt).getTime());
  const from = new Date(Math.min(...days) - 14 * 86_400_000);
  const to = new Date(Math.max(...days) + 14 * 86_400_000);

  const existing = await prisma.transaction.findMany({
    where: { accountId: preview.accountId, bookedAt: { gte: from, lte: to } },
    select: {
      id: true,
      bookedAt: true,
      amountCents: true,
      description: true,
      merchant: true,
      dedupeHash: true,
    },
  });

  return findDuplicateCandidates(
    preview.rows.map((row, index) => ({
      index,
      bookedAt: row.bookedAt.slice(0, 10),
      amountCents: row.amountCents,
      description: row.description,
      merchant: row.merchant,
      dedupeHash: row.dedupeHash,
    })),
    existing.map((row) => ({ ...row, bookedAt: row.bookedAt.toISOString().slice(0, 10) })),
  );
}

/** The parsed rows, in the shape the classifier and the duplicate finder share. */
function toInputRows(rows: PreviewRow[]) {
  return rows.map((row) => ({
    bookedAt: row.bookedAt.slice(0, 10),
    amountCents: row.amountCents,
    description: row.description,
    merchant: row.merchant,
    counterparty: row.counterparty,
    counterpartyIban: row.counterpartyIban,
  }));
}

function toReviewState(
  groups: ReviewGroup[],
  proposals: StoredProposals | undefined,
  categories: Awaited<ReturnType<typeof loadCategoryOptions>>,
  duplicates: DuplicateCandidate[],
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
    duplicates,
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
  await requireSession();
  const preview = await loadPreview();
  if (!preview) return null;

  const [groups, categories, duplicates] = await Promise.all([
    classifyPreview(toInputRows(preview.rows), undefined, preview.accountId),
    loadCategoryOptions(),
    loadDuplicateCandidates(preview),
  ]);

  // Every row is shown: a suspected duplicate still needs a category if the user
  // decides to import it.
  return {
    review: toReviewState(groups, preview.proposals, categories, duplicates),
    summary: {
      filename: preview.filename,
      accountName: preview.accountName,
      source: preview.source,
      rowCount: preview.rows.length,
      duplicates: preview.duplicates,
      sumCents: preview.sumCents,
      periodStart: preview.periodStart,
      periodEnd: preview.periodEnd,
      saveCount:
        preview.rows.length - duplicates.filter((d) => d.defaultDecision === "skip").length,
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
  await requireSession();
  const preview = await loadPreview();
  if (!preview) redirect("/import?error=no-preview");
  if (!isAiConfigured()) redirect("/import?preview=1&ai=not-configured");

  const [groups, categories] = await Promise.all([
    classifyPreview(toInputRows(preview.rows), undefined, preview.accountId),
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
    // Two distinct narratives are enough to place a merchant; more is noise.
    description: [...new Set(group.rows.map((row) => row.description))].slice(0, 2).join(" · "),
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
  duplicates: z.record(z.string(), z.enum(["import", "skip"])).default({}),
});

function parseDecisions(raw: FormDataEntryValue | null): ReviewDecisions {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200_000) {
    return { categories: {}, acceptedRules: [], duplicates: {} };
  }
  try {
    const parsed = decisionsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { categories: {}, acceptedRules: [], duplicates: {} };
  } catch {
    return { categories: {}, acceptedRules: [], duplicates: {} };
  }
}

/**
 * Writes the statement, its transactions and the approved rules in one go. Only
 * what the user approved is applied; a group left out of the decisions stays
 * exactly as it was (matched by a rule or a transfer, or uncategorised), and a
 * suspected duplicate is skipped unless the user said otherwise.
 */
export async function commitPreview(formData: FormData): Promise<void> {
  await requireSession();
  const preview = await loadPreview();
  if (!preview) redirect("/import?error=no-preview");

  const decisions = parseDecisions(formData.get("decisions"));
  // The category has to exist before classification, or an account movement is
  // not recognised as one and would count as income or expense.
  await ensureTransfersCategory();

  const [groups, duplicates, categoryOptions] = await Promise.all([
    classifyPreview(toInputRows(preview.rows), undefined, preview.accountId),
    loadDuplicateCandidates(preview),
    loadCategoryOptions(),
  ]);

  const duplicateByHash = new Map(duplicates.map((candidate) => [candidate.hash, candidate]));
  const validCategories = new Set(categoryOptions.map((category) => category.id));
  const proposals = preview.proposals?.categories ?? {};

  // One decision per merchant group, applied to every row of that group.
  const perRow = new Map<number, { categoryId: string | null; source: string }>();
  for (const group of groups) {
    const decided = decisions.categories[group.key];
    const chosen = decided === undefined ? (group.match?.categoryId ?? null) : decided;
    if (chosen !== null && !validCategories.has(chosen)) continue;
    const fromAi = chosen !== null && proposals[group.key] === chosen;
    const source = chosen === null ? "NONE" : fromAi ? "AI" : group.match ? "RULE" : "MANUAL";
    for (const row of group.rows) perRow.set(row.index, { categoryId: chosen, source });
  }

  // Hashes already stored: approving an exact duplicate means it needs a new one,
  // because dedupeHash is unique by design.
  const taken = new Set(
    (
      await prisma.transaction.findMany({
        where: { dedupeHash: { in: preview.rows.map((row) => row.dedupeHash) } },
        select: { dedupeHash: true },
      })
    ).map((row) => row.dedupeHash),
  );
  const freeHash = (hash: string): string => {
    if (!taken.has(hash)) {
      taken.add(hash);
      return hash;
    }
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${hash}-${suffix}`;
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
    const fallback = `${hash}-${Date.now()}`;
    taken.add(fallback);
    return fallback;
  };

  const insert: { index: number; row: PreviewRow; storedHash: string }[] = [];
  preview.rows.forEach((row, index) => {
    const candidate = duplicateByHash.get(row.dedupeHash);
    const decision = decisions.duplicates[row.dedupeHash] ?? candidate?.defaultDecision ?? "import";
    if (decision === "skip") return;
    insert.push({ index, row, storedHash: freeHash(row.dedupeHash) });
  });

  let rulesCreated = 0;
  const imported = await prisma.$transaction(async (tx) => {
    // Inside the transaction: a failed commit used to leave the Statement row
    // behind, and since fileHash is unique that file could never be imported
    // again.
    const statement = await tx.statement.create({
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

    await tx.transaction.createMany({
      data: insert.map(({ index, row, storedHash }) => {
        const decision = perRow.get(index);
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
          dedupeHash: storedHash,
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
      // The rule follows the category the rows actually got: if the user changed
      // the suggestion, a rule carrying the model's pick would silently undo it
      // on the next import.
      const categoryId =
        ruleCategoryFor({
          decided: decisions.categories[key],
          proposalCategoryId: proposal?.categoryId,
          matchCategoryId: group.match?.categoryId,
        }) ?? undefined;
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
      data: { importedCount: insert.length, skippedCount: preview.rows.length - insert.length },
    });
    return insert.length;
  });

  await prisma.setting.delete({ where: { key: PREVIEW_KEY } });
  await categoriseUncategorised();

  // Pair the new rows with the statements already on file — and with the ones
  // imported later, which is why this runs on every import, not once.
  await linkTransfers(linkWindowFor(preview.periodStart, preview.periodEnd));

  revalidatePath("/import");
  revalidatePath("/reconcile");
  revalidatePath("/transactions");
  revalidatePath("/settings");
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect(
    `/import?done=${imported}&skipped=${preview.rows.length - imported}&rules=${rulesCreated}`,
  );
}

export async function cancelPreview(): Promise<void> {
  await requireSession();
  await prisma.setting.deleteMany({ where: { key: PREVIEW_KEY } });
  revalidatePath("/import");
  redirect("/import");
}
