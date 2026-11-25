import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listAccounts } from "@/lib/queries/accounts";

// Reads the database on every request; nothing here is safe to prerender.
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const accounts = await listAccounts();

  return (
    <>
      <PageHeader
        title="Import"
        subtitle="ASN (CSV or CAMT.053), PayPal (CSV), ICS (CSV)"
      />

      {accounts.length === 0 ? (
        <EmptyState title="An account first">
          Add an account in{" "}
          <Link href="/accounts" className="underline">
            Accounts
          </Link>{" "}
          and then import the statement.
        </EmptyState>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Step 1 — choose a file">
            <p className="text-sm text-muted">
              Pick the account and the file. The parser follows from the account
              ({accounts.map((a) => a.institution).filter((v, i, arr) => arr.indexOf(v) === i).join(", ")}).
            </p>
          </Card>
          <Card title="Step 2 — check">
            <p className="text-sm text-muted">
              Before saving you see the row count, the period, the total amount and how many rows
              are duplicates. Nothing is written yet.
            </p>
          </Card>
          <Card title="Step 3 — commit">
            <p className="text-sm text-muted">
              Saved in one transaction, then categorised through merchant memory and rules. The
              result shows what was added and what still needs review.
            </p>
          </Card>
          <Card title="Not built yet">
            <p className="text-sm text-muted">
              The wizard itself is phase 2 (ASN) and 3 (PayPal, ICS). See{" "}
              <code className="font-mono text-xs">docs/ARCHITECTURE.md</code> §5 and{" "}
              <code className="font-mono text-xs">docs/IMPORT-FORMATS.md</code> for the format
              details per source.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
