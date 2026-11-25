import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { getAccount, listAccounts } from "@/lib/queries/accounts";
import { ACCOUNT_TYPE_LABELS } from "@/lib/types";

export default async function AccountDetailPage({ params }: PageProps<"/accounts/[id]">) {
  const { id } = await params;
  const account = await getAccount(id);
  if (!account) notFound();

  const summary = (await listAccounts(true)).find((a) => a.id === id);
  const [transactions, statements] = await Promise.all([
    prisma.transaction.findMany({
      where: { accountId: id },
      orderBy: [{ bookedAt: "desc" }],
      take: 25,
      include: { category: { select: { name: true } } },
    }),
    prisma.statement.findMany({
      where: { accountId: id },
      orderBy: { importedAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <>
      <PageHeader
        title={account.name}
        subtitle={`${ACCOUNT_TYPE_LABELS[account.type as keyof typeof ACCOUNT_TYPE_LABELS]} · ${account.institution}${account.iban ? ` · ${account.iban}` : ""}`}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-xs uppercase tracking-wide text-muted">
            {account.type === "BROKER" ? "Cash" : "Balance"}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular">
            {formatCents(summary?.balanceCents ?? account.openingBalanceCents)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-muted">Opening balance</div>
          <div className="mt-1 text-2xl font-semibold tabular">
            {formatCents(account.openingBalanceCents)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-muted">Last import</div>
          <div className="mt-1 text-2xl font-semibold tabular">
            {statements[0] ? formatDay(statements[0].importedAt) : "—"}
          </div>
        </Card>
      </div>

      {account.type === "BROKER" && (
        <div className="mt-3">
          <Card title="Portfolio">
            <p className="text-sm text-muted">
              Trades, positions (FIFO) and prices arrive in phase 5. See{" "}
              <code className="font-mono text-xs">docs/ARCHITECTURE.md</code> §7.
            </p>
          </Card>
        </div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card title="Recent transactions" className="lg:col-span-2">
          {transactions.length === 0 ? (
            <p className="text-sm text-muted">No transactions on this account yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {transactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{t.merchant ?? t.description}</span>
                    <span className="block text-xs text-muted">
                      {formatDay(t.bookedAt)} · {t.category?.name ?? "uncategorised"}
                    </span>
                  </span>
                  <span
                    className={`tabular shrink-0 ${t.amountCents < 0 ? "text-negative" : "text-positive"}`}
                  >
                    {formatCentsSigned(t.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Imports">
          {statements.length === 0 ? (
            <p className="text-sm text-muted">
              No files imported yet.{" "}
              <Link href="/import" className="underline">
                Import
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {statements.map((s) => (
                <li key={s.id} className="py-2">
                  <div className="truncate">{s.filename}</div>
                  <div className="text-xs text-muted">
                    {s.source} · {s.importedCount} rows ·{" "}
                    {s.skippedCount > 0 ? `${s.skippedCount} skipped` : "no duplicates"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
