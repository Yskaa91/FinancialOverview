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
import { STATEMENT_SOURCES, type StatementSource } from "@/lib/types";

// One preview at a time (single user, single machine). The parsed rows wait in
// Setting until the user commits or cancels, so a reload cannot lose the file and
// nothing is written before the confirm step.
const PREVIEW_KEY = "importPreview";

/** A parsed row plus its dedupe hash. `bookedAt` is a string so the preview can
 * survive a JSON round trip through Setting. */
export type PreviewRow = Omit<NormalizedRow, "bookedAt"> & { bookedAt: string; dedupeHash: string };

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
};

const uploadSchema = z.object({
  accountId: z.string().min(1),
  source: z.enum([...STATEMENT_SOURCES, "auto"]).default("auto"),
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

  await prisma.setting.upsert({
    where: { key: PREVIEW_KEY },
    create: { key: PREVIEW_KEY, valueJson: JSON.stringify(preview) },
    update: { valueJson: JSON.stringify(preview) },
  });

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

/** Writes the statement and its transactions in one go, then categorises. */
export async function commitPreview(): Promise<void> {
  const preview = await loadPreview();
  if (!preview) redirect("/import?error=no-preview");

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

  // skipDuplicates is not available on SQLite, so filter first: one insert per
  // statement, no partial import.
  const known = new Set(
    (
      await prisma.transaction.findMany({
        where: { dedupeHash: { in: rows.map((r) => r.dedupeHash) } },
        select: { dedupeHash: true },
      })
    ).map((r) => r.dedupeHash),
  );
  const fresh = rows.filter((r) => !known.has(r.dedupeHash));

  const imported = await prisma.$transaction(async (tx) => {
    await tx.transaction.createMany({
      data: fresh.map((row) => ({
        accountId: preview.accountId,
        statementId: statement.id,
        bookedAt: row.bookedAt,
        amountCents: row.amountCents,
        currency: row.currency,
        description: row.description,
        counterparty: row.counterparty,
        counterpartyIban: row.counterpartyIban,
        merchant: row.merchant,
        balanceAfterCents: row.balanceAfterCents,
        rawJson: row.rawJson,
        dedupeHash: row.dedupeHash,
      })),
    });
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
  revalidatePath("/accounts");
  revalidatePath("/");
  redirect(`/import?done=${imported}&skipped=${rows.length - imported}`);
}

export async function cancelPreview(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: PREVIEW_KEY } });
  revalidatePath("/import");
  redirect("/import");
}
