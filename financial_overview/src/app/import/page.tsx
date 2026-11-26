import Link from "next/link";
import { ReviewDialog } from "@/components/import-review/review-dialog";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listAccounts } from "@/lib/queries/accounts";
import { STATEMENT_SOURCES } from "@/lib/types";
import { requireSession } from "@/lib/auth";
import { loadReview, previewUpload } from "./actions";

const ERRORS: Record<string, string> = {
  "missing-input": "Choose an account and a file first.",
  "unknown-account": "That account no longer exists.",
  "file-too-large": "That file is larger than 5 MB.",
  "unreadable-pdf": "That PDF could not be read. It must be the statement PDF itself, not a scan, and not password protected.",
  // Rows, not bytes: a small file can still hold an unusable number of lines.
  "too-many-rows": "That statement has more rows than this app reviews at once (limit 20.000). Split it by month.",
  "already-imported": "This exact file was imported before. Nothing was changed.",
  "unknown-source": "Could not tell which bank this file is from. Pick the source explicitly.",
  "no-preview": "The preview expired. Upload the file again.",
};

export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  await requireSession();
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const [accounts, loaded] = await Promise.all([listAccounts(), loadReview()]);
  const error = first(sp.error);
  const done = first(sp.done);
  const skipped = Number(first(sp.skipped) ?? 0);
  const errorText = error
    ? (ERRORS[error] ??
      (error.startsWith("parse:")
        ? `Parser said: ${error.slice(6)}`
        : error.startsWith("too-many-rows:")
          ? `That statement has ${error.slice("too-many-rows:".length)} rows, more than this app reviews at once (limit 20.000). Split the file.`
          : error))
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
      ) : (
        <>
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
                    accept=".csv,.CSV,.txt,.pdf,.PDF"
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
                <li>
                  The file is parsed and decoded (cp1252 for ASN, UTF-8 BOM for ICS). ICS
                  statement PDFs are read as text, so they must not be scans.
                </li>
                <li>
                  A review dialog opens with the rows grouped per merchant, the ones a rule already
                  matched below. Nothing is written yet.
                </li>
                <li>
                  Saving writes the statement and its transactions in one go, applies what you
                  approved, then runs the rule engine and merchant memory.
                </li>
              </ol>
              <p className="mt-3 text-xs text-muted">
                Formats are documented in{" "}
                <code className="font-mono">docs/IMPORT-FORMATS.md</code>. Re-importing the same file
                is a no-op, and so is overlapping a previous period.
              </p>
            </Card>
          </div>

          {loaded && <ReviewDialog review={loaded.review} summary={loaded.summary} />}
        </>
      )}
    </>
  );
}
