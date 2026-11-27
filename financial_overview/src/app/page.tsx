import Link from "next/link";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { getDashboard, accountChanges } from "@/lib/queries/dashboard";
import { cashflowSeries, netWorthSeries } from "@/lib/queries/history";
import { NetWorthChart } from "@/components/charts/net-worth-chart";
import { CashflowBars } from "@/components/charts/cashflow-bars";
import { CategoryPie } from "@/components/charts/category-pie";
import { PeriodBar } from "@/components/period-bar";
import { CompareTable } from "@/components/compare-table";
import { BalanceChanges } from "@/components/balance-changes";
import { parsePeriod, comparePeriod } from "@/lib/periods";
import { requireSession } from "@/lib/auth";

// Reads the database on every request; nothing here is safe to prerender.
export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  await requireSession();

  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const period = parsePeriod(first(sp.p));
  const compareWith = comparePeriod(first(sp.c), period);

  const [data, netWorth, cashflow, balances] = await Promise.all([
    getDashboard(period, compareWith),
    netWorthSeries(12),
    cashflowSeries(12),
    compareWith ? accountChanges(period, compareWith) : Promise.resolve(null),
  ]);

  const { period: shown, comparison } = data;
  const netCents = shown.incomeCents - shown.expenseCents;
  const pie = (totals: typeof shown) =>
    totals.categories.slice(0, 6).map((c) => ({
      name: c.name,
      cents: c.cents,
      color: c.color,
    }));

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Net worth, cashflow and what needs attention" />

      {data.accounts.length === 0 && (
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

      <PeriodBar period={period} compare={compareWith} />

      {comparison && balances ? (
        <>
          <Card
            title={`Comparing ${shown.period.label} with ${comparison.period.period.label}`}
          >
            <CompareTable rows={comparison.rows} current={shown} other={comparison.period} />
          </Card>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Card title={`Spending by category, ${shown.period.label}`}>
              <CategoryPie slices={pie(shown)} />
            </Card>
            <Card title={`Spending by category, ${comparison.period.period.label}`}>
              <CategoryPie slices={pie(comparison.period)} />
            </Card>
          </div>

          <div className="mt-3">
            <Card
              title={`Accounts, ${shown.period.label} vs ${comparison.period.period.label}`}
            >
              <BalanceChanges
                data={balances}
                currentLabel={shown.period.label}
                otherLabel={comparison.period.period.label}
              />
            </Card>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <Stat
                label="Net worth"
                value={formatCents(data.netWorthCents)}
                large
                hint="As of today"
              />
            </Card>
            <Card>
              <Stat
                label={`Income, ${shown.period.label}`}
                value={formatCents(shown.incomeCents)}
                tone="positive"
              />
            </Card>
            <Card>
              <Stat
                label={`Expenses, ${shown.period.label}`}
                value={formatCents(shown.expenseCents)}
                tone="negative"
                hint={`Net ${formatCentsSigned(netCents)}`}
              />
            </Card>
            <Card>
              <Stat
                label="Net result"
                value={formatCentsSigned(netCents)}
                tone={netCents >= 0 ? "positive" : "negative"}
                hint="Income minus expenses in the period"
              />
            </Card>
          </div>

          {/* Two rows of two, so all four cards are half width: the category
              names carry the meaning and were the first thing to be clipped when
              they shared a row with a wider chart. */}
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Card title={`Spending by category, ${shown.period.label}`}>
              <CategoryPie slices={pie(shown)} />
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
                    ? "One click per merchant, any period"
                    : "Everything is categorised"
                }
              />
            </Card>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Card title="Income and expenses per month">
              <CashflowBars points={cashflow} />
            </Card>
            <Card title="Net worth, 12 months">
              <NetWorthChart points={netWorth} />
            </Card>
          </div>

          <div className="mt-3 grid content-start gap-3 lg:grid-cols-2">
            <div className="grid gap-3">
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

              <Card title="Assets and liabilities">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">Assets</dt>
                    <dd className="tabular">{formatCents(data.assetsCents)}</dd>
                  </div>
                  {data.propertyCents > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-muted">of which real estate</dt>
                      <dd className="tabular">{formatCents(data.propertyCents)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-muted">Credit card debt</dt>
                    <dd className="tabular">{formatCents(data.liabilitiesCents)}</dd>
                  </div>
                </dl>
              </Card>
            </div>

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
                        className={`tabular shrink-0 ${
                          t.amountCents < 0 ? "text-negative" : "text-positive"
                        }`}
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
      )}
    </>
  );
}
