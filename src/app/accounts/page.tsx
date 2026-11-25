import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { listAccounts } from "@/lib/queries/accounts";
import { ACCOUNT_TYPE_LABELS } from "@/lib/types";
import { AddAccountForm } from "./add-account-form";

// Reads the database on every request; nothing here is safe to prerender.
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await listAccounts();

  return (
    <>
      <PageHeader
        title="Rekeningen"
        subtitle="Betaal, spaar, beleggen en creditcards op één plek"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => (
          <Card key={a.id} className="flex flex-col justify-between">
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/accounts/${a.id}`} className="font-medium hover:underline">
                  {a.name}
                </Link>
                <span className="shrink-0 text-xs text-muted">
                  {ACCOUNT_TYPE_LABELS[a.type]}
                </span>
              </div>
              <div className="mt-3 text-2xl font-semibold tabular">
                {formatCents(a.balanceCents)}
              </div>
              <div
                className={`mt-1 text-sm tabular ${a.change30dCents < 0 ? "text-negative" : "text-positive"}`}
              >
                {formatCentsSigned(a.change30dCents)} <span className="text-muted">30 dagen</span>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-muted">
              <span>{a.institution}</span>
              <span>
                {a.lastImportAt ? `import ${formatDay(a.lastImportAt)}` : "nog niet geïmporteerd"}
              </span>
            </div>
          </Card>
        ))}
      </div>

      {accounts.length === 0 && (
        <div className="mb-4">
          <EmptyState title="Nog geen rekeningen">
            Voeg eerst een rekening toe, daarna kun je bestanden importeren.
          </EmptyState>
        </div>
      )}

      <div className="mt-4">
        <Card title="Rekening toevoegen">
          <AddAccountForm />
        </Card>
      </div>
    </>
  );
}
