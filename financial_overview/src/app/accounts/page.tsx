import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { listAccounts } from "@/lib/queries/accounts";
import { loadAccountImpact } from "@/lib/queries/impact";
import { ACCOUNT_TYPE_LABELS } from "@/lib/types";
import { requireSession } from "@/lib/auth";
import { AddAccountForm } from "./add-account-form";
import { AccountActions } from "./account-actions";

// Reads the database on every request; nothing here is safe to prerender.
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  await requireSession();
  // Archived accounts stay visible (dimmed, restorable) instead of unreachable.
  const [accounts, impact] = await Promise.all([listAccounts(true), loadAccountImpact()]);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Checking, savings, brokerage and credit cards in one place"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => (
          <Card
            key={a.id}
            className={`flex flex-col justify-between ${a.archived ? "opacity-60" : ""}`}
          >
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/accounts/${a.id}`} className="font-medium hover:underline">
                  {a.name}
                </Link>
                <div className="flex shrink-0 items-baseline gap-1.5">
                  {a.archived && (
                    <span className="rounded border border-border px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                      Archived
                    </span>
                  )}
                  <span className="text-xs text-muted">{ACCOUNT_TYPE_LABELS[a.type]}</span>
                </div>
              </div>
              <div className="mt-3 text-2xl font-semibold tabular">
                {formatCents(a.balanceCents)}
              </div>
              <div
                className={`mt-1 text-sm tabular ${a.change30dCents < 0 ? "text-negative" : "text-positive"}`}
              >
                {formatCentsSigned(a.change30dCents)} <span className="text-muted">last 30 days</span>
              </div>
            </div>
            <div>
              <div className="mt-4 flex items-center justify-between text-xs text-muted">
                <span>{a.institution}</span>
                <span>
                  {a.lastImportAt ? `imported ${formatDay(a.lastImportAt)}` : "not imported yet"}
                </span>
              </div>
              <AccountActions account={a} impact={impact.get(a.id) ?? null} />
            </div>
          </Card>
        ))}
      </div>

      {accounts.length === 0 && (
        <div className="mb-4">
          <EmptyState title="No accounts yet">
            Add an account first; after that you can import statement files.
          </EmptyState>
        </div>
      )}

      <div className="mt-4">
        <Card title="Add account">
          <AddAccountForm />
        </Card>
      </div>
    </>
  );
}
