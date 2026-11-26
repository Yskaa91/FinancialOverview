import Link from "next/link";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { getDashboard } from "@/lib/queries/dashboard";
import { cashflowSeries, netWorthSeries } from "@/lib/queries/history";
import { NetWorthChart } from "@/components/charts/net-worth-chart";
import { CashflowBars } from "@/components/charts/cashflow-bars";
import { CategoryPie } from "@/components/charts/category-pie";
import { PeriodBar } from "@/components/period-bar";
import { CompareTable } from "@/components/compare-table";
import { comparePeriod, formatChangePercent, parsePeriod } from "@/lib/periods";
import { requireSession } from "@/lib/auth";

// Reads the database on every request; nothing here is safe to prerender.
export const dynamic = "force-dynamic";

/** "+€120,00 (+18%) vs October 2026" — the delta belongs next to the number. */
function deltaHint(
  currentCents: number,
  otherCents: number | undefined,
  otherLabel: string | undefined,
): string | undefined {
  if (otherCents === undefined || otherLabel === undefined) return undefined;
  const delta = currentCents - otherCents;
  if (delta === 0) return `Unchanged vs ${otherLabel}`;
  // A percentage over zero base says nothing; the amount carries the message.
  const percent = otherCents === 0 ? "" : ` (${formatChangePercent(delta, otherCents)})`;
  return `${formatCentsSigned(delta)}${percent} vs ${otherLabel}`;
}

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  await requireSession();

  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const period = parsePeriod(first(sp.p));
  const compareWith = comparePeriod(first(sp.c), period);

  const [data, netWorth, cashflow] = await Promise.all([
    getDashboard(period, compareWith),
    netWorthSeries(12),
    cashflowSeries(12),
  ]);

  const { period: shown, comparison } = data;
  const netCents = shown.incomeCents - shown.expenseCents;
  const otherNetCents = comparison
    ? comparison.period.incomeCents - comparison.period.expenseCents
    : undefined;
  const otherLabel = comparison?.period.period.label;
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

      <PeriodBar period={period} compare={compareWith} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Net worth" value={formatCents(data.netWorthCents)} large hint="As of today" />
        </Card>
        <Card>
          <Stat
            label={`Income, ${shown.period.label}`}
            value={formatCents(shown.incomeCents)}
            tone="positive"
            hint={deltaHint(shown.incomeCents, comparison?.period.incomeCents, otherLabel)}
          />
        </Card>
        <Card>
          <Stat
            label={`Expenses, ${shown.period.label}`}
            value={formatCents(shown.expenseCents)}
            tone="negative"
            hint={
              deltaHint(shown.expenseCents, comparison?.period.expenseCents, otherLabel) ??
              `Net ${formatCentsSigned(netCents)}`
            }
          />
        </Card>
        <Card>
          <Stat
            label="Net result"
            value={formatCentsSigned(netCents)}
            tone={netCents >= 0 ? "positive" : "negative"}
            hint={
              deltaHint(netCents, otherNetCents, otherLabel) ??
              "Income minus expenses in the period"
            }
          />
        </Card>
      </div>

      {/* Only when there is something to compare against: an empty row would
          push the charts down for nothing. */}
      {comparison && (
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Card
            title={`Comparing ${shown.period.label} with ${comparison.period.period.label}`}
            className="lg:col-span-2"
          >
            <CompareTable rows={comparison.rows} current={shown} other={comparison.period} />
          </Card>
          <Card title={`Spending by category, ${comparison.period.period.label}`}>
            <CategoryPie
              slices={comparison.period.categories.slice(0, 6).map((c) => ({
                name: c.name,
                cents: c.cents,
                color: c.color,
              }))}
            />
          </Card>
        </div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card title="Net worth, 12 months" className="lg:col-span-2">
          <NetWorthChart points={netWorth} />
        </Card>
        <Card title={`Spending by category, ${shown.period.label}`}>
          <CategoryPie
            slices={shown.categories.slice(0, 6).map((c) => ({
              name: c.name,
              cents: c.cents,
              color: c.color,
            }))}
          />
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card title="Income and expenses per month" className="lg:col-span-2">
          <CashflowBars points={cashflow} />
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
                      ${formatDay(t.bookedAt)} · {t.accountName} ·{" "}
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
