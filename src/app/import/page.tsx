import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { listAccounts } from "@/lib/queries/accounts";
import { STATEMENT_SOURCES } from "@/lib/types";
import { cancelPreview, commitPreview, loadPreview, previewUpload } from "./actions";

const ERRORS: Record<string, string> = {
  "missing-input": "Choose an account and a file first.",
  "unknown-account": "That account no longer exists.",
  "file-too-large": "That file is larger than 5 MB.",
  "already-imported": "This exact file was imported before. Nothing was changed.",
  "unknown-source": "Could not tell which bank this file is from. Pick the source explicitly.",
  "no-preview": "The preview expired. Upload the file again.",
};

export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const [accounts, preview] = await Promise.all([listAccounts(), loadPreview()]);
  const error = first(sp.error);
  const done = first(sp.done);
  const skipped = Number(first(sp.skipped) ?? 0);
  const errorText = error
    ? (ERRORS[error] ?? (error.startsWith("parse:") ? `Parser said: ${error.slice(6)}` : error))
    : null;

  return (
    <>
      <PageHeader title="Import" subtitle="ASN (CSV or CAMT.053), PayPal (CSV), ICS (CSV)" />

      {errorText && (
        <div className="mb-3 rounded-md border border-negative/40 bg-negative/5 px-3 py-2 text-sm text-negative">
          {errorText}
        </div>
      )}

      {done && (
        <div className="mb-3 rounded-md border border-positive/40 bg-positive/5 px-3 py-2 text-sm">
          Imported {done} transactions{skipped > 0 ? `, skipped ${skipped} duplicates` : ""}. Go
          to{" "}
          <Link href="/transactions?review=1" className="underline">
            the review queue
          </Link>{" "}
          to categorise what is left.
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyState title="An account first">
          Add an account in{" "}
          <Link href="/accounts" className="underline">
            Accounts
          </Link>{" "}
          and then import the statement.
        </EmptyState>
      ) : preview ? (
        <div className="grid gap-3">
          <Card
            title="Step 2 — check before saving"
            action={
              <span className="font-mono text-[11px] text-muted">
                {preview.source} · {preview.filename}
              </span>
            }
          >
            <dl className="grid gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted">Account</dt>
                <dd>{preview.accountName}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted">Rows</dt>
                <dd className="tabular">
                  {preview.rows.length}
                  {preview.duplicates > 0 && (
                    <span className="text-muted"> · {preview.duplicates} duplicates</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted">Period</dt>
                <dd className="tabular">
                  {preview.periodStart ?? "—"} → {preview.periodEnd ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted">Total</dt>
                <dd className="tabular">{formatCentsSigned(preview.sumCents)}</dd>
              </div>
            </dl>

            {preview.rejected.length > 0 && (
              <p className="mt-3 text-xs text-muted">
                {preview.rejected.length} row(s) rejected by the parser:{" "}
                {preview.rejected
                  .slice(0, 3)
                  .map((r) => `line ${r.line}: ${r.reason}`)
                  .join("; ")}
                {preview.rejected.length > 3 ? " …" : ""}
              </p>
            )}

            <div className="mt-3 overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Description</th>
                    <th className="py-2 pr-3 font-medium">Merchant</th>
                    <th className="py-2 pl-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 25).map((row) => (
                    <tr key={row.dedupeHash} className="border-b border-border/60 last:border-0">
                      <td className="whitespace-nowrap py-1.5 pr-3 tabular">
                        {row.bookedAt.slice(0, 10)}
                      </td>
                      <td className="max-w-[26rem] truncate py-1.5 pr-3" title={row.description}>
                        {row.description}
                      </td>
                      <td className="py-1.5 pr-3 text-muted">{row.merchant ?? "—"}</td>
                      <td
                        className={`py-1.5 pl-3 text-right tabular ${row.amountCents < 0 ? "text-negative" : "text-positive"}`}
                      >
                        {formatCents(row.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 25 && (
                <p className="mt-2 text-xs text-muted">
                  Showing the first 25 of {preview.rows.length} rows.
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <form action={commitPreview}>
                <button
                  type="submit"
                  className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
                >
                  Save {preview.rows.length - preview.duplicates} transactions
                </button>
              </form>
              <form action={cancelPreview}>
                <button
                  type="submit"
                  className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:bg-surface-muted"
                >
                  Cancel
                </button>
              </form>
              <span className="text-xs text-muted">
                Duplicates are detected per transaction, so overlapping statements are safe.
              </span>
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Step 1 — choose a file">
            <form action={previewUpload} className="grid gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-muted">Account</span>
                <select
                  name="accountId"
                  required
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.institution})
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-muted">Source</span>
                <select
                  name="source"
                  defaultValue="auto"
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                >
                  <option value="auto">Detect automatically</option>
                  {STATEMENT_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-muted">Statement file</span>
                <input
                  type="file"
                  name="file"
                  required
                  accept=".csv,.CSV,.xml,.txt"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-2 file:py-1 file:text-xs"
                />
              </label>

              <button
                type="submit"
                className="justify-self-start rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
              >
                Read file
              </button>
            </form>
          </Card>

          <Card title="What happens next">
            <ol className="list-decimal space-y-1 pl-4 text-sm text-muted">
              <li>The file is parsed and decoded (cp1252 for ASN, UTF-8 BOM for ICS).</li>
              <li>
                You see the row count, period, total, duplicates and the first 25 rows. Nothing is
                written yet.
              </li>
              <li>
                Saving writes the statement and its transactions in one go, then runs the rule
                engine and merchant memory.
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted">
              Formats are documented in{" "}
              <code className="font-mono">docs/IMPORT-FORMATS.md</code>. Re-importing the same file
              is a no-op, and so is overlapping a previous period.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
