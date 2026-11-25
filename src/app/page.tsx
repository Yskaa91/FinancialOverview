import Link from "next/link";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { getDashboard } from "@/lib/queries/dashboard";

// Reads the database on every request; nothing here is safe to prerender.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getDashboard();
  const monthNet = data.monthIncomeCents - data.monthExpenseCents;
  const hasAccounts = data.accounts.length > 0;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Net worth, cashflow and what needs attention" />

      {!hasAccounts && (
        <div className="mb-6">
          <EmptyState title="No accounts yet">
            Add your checking, savings, brokerage and credit card accounts in{" "}
            <Link href="/accounts" className="underline">
              Accounts
            </Link>
            . After that you can import ASN, PayPal and ICS files.
          </EmptyState>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Net worth" value={formatCents(data.netWorthCents)} large />
        </Card>
        <Card>
          <Stat
            label="Last 30 days"
            value={formatCentsSigned(data.change30dCents)}
            tone={data.change30dCents >= 0 ? "positive" : "negative"}
            hint="Sum of all account movements"
          />
        </Card>
        <Card>
          <Stat
            label="Income this month"
            value={formatCents(data.monthIncomeCents)}
            tone="positive"
          />
        </Card>
        <Card>
          <Stat
            label="Expenses this month"
            value={formatCents(data.monthExpenseCents)}
            tone="negative"
            hint={`Net ${formatCentsSigned(monthNet)}`}
          />
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card title="Assets and liabilities">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Assets</dt>
              <dd className="tabular">{formatCents(data.assetsCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Credit card debt</dt>
              <dd className="tabular">{formatCents(data.liabilitiesCents)}</dd>
            </div>
          </dl>
        </Card>

        <Card
          title="Largest expenses this month"
          action={
            <Link href="/transactions" className="text-xs text-muted underline">
              all
            </Link>
          }
        >
          {data.topCategories.length === 0 ? (
            <p className="text-sm text-muted">No expenses this month.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.topCategories.map((c) => (
                <li key={c.name} className="flex justify-between gap-3">
                  <span className="truncate">{c.name}</span>
                  <span className="tabular shrink-0">{formatCents(c.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Needs a category"
          action={
            <Link href="/transactions?review=1" className="text-xs text-muted underline">
              review
            </Link>
          }
        >
          <Stat
            label="Transactions"
            value={String(data.uncategorizedCount)}
            tone={data.uncategorizedCount > 0 ? "negative" : "neutral"}
            hint={
              data.uncategorizedCount > 0
                ? "One click per merchant"
                : "Everything is categorised"
            }
          />
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Accounts">
          {data.accounts.length === 0 ? (
            <p className="text-sm text-muted">No accounts.</p>
          ) : (
            <ul className="divide-y divide-border text-[13px]">
              {data.accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/accounts/${a.id}`} className="truncate hover:underline">
                    {a.name}
                  </Link>
                  <span className="tabular shrink-0">{formatCents(a.balanceCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent transactions">
          {data.recent.length === 0 ? (
            <p className="text-sm text-muted">Nothing imported yet.</p>
          ) : (
            <ul className="divide-y divide-border text-[13px]">
              {data.recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{t.merchant ?? t.description}</span>
                    <span className="block text-xs text-muted">
                      {formatDay(t.bookedAt)} · {t.accountName} ·{" "}
                      {t.categoryName ?? "uncategorised"}
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
      </div>
    </>
  );
}
