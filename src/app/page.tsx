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
      <PageHeader title="Dashboard" subtitle="Vermogen, cashflow en wat aandacht nodig heeft" />

      {!hasAccounts && (
        <div className="mb-6">
          <EmptyState title="Nog geen rekeningen">
            Voeg je betaal-, spaar-, beleggings- en creditcardrekeningen toe via{" "}
            <Link href="/accounts" className="underline">
              Rekeningen
            </Link>
            . Daarna kun je ASN-, PayPal- en ICS-bestanden importeren.
          </EmptyState>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Netto vermogen" value={formatCents(data.netWorthCents)} large />
        </Card>
        <Card>
          <Stat
            label="30 dagen"
            value={formatCentsSigned(data.change30dCents)}
            tone={data.change30dCents >= 0 ? "positive" : "negative"}
            hint="Som van alle rekeningmutaties"
          />
        </Card>
        <Card>
          <Stat
            label="Inkomsten deze maand"
            value={formatCents(data.monthIncomeCents)}
            tone="positive"
          />
        </Card>
        <Card>
          <Stat
            label="Uitgaven deze maand"
            value={formatCents(data.monthExpenseCents)}
            tone="negative"
            hint={`Netto ${formatCentsSigned(monthNet)}`}
          />
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card title="Bezittingen en schulden">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Bezittingen</dt>
              <dd className="tabular">{formatCents(data.assetsCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Creditcardschuld</dt>
              <dd className="tabular">{formatCents(data.liabilitiesCents)}</dd>
            </div>
          </dl>
        </Card>

        <Card
          title="Grootste uitgaven deze maand"
          action={
            <Link href="/transactions" className="text-xs text-muted underline">
              alles
            </Link>
          }
        >
          {data.topCategories.length === 0 ? (
            <p className="text-sm text-muted">Nog geen uitgaven in deze maand.</p>
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
          title="Te categoriseren"
          action={
            <Link href="/transactions?review=1" className="text-xs text-muted underline">
              beoordelen
            </Link>
          }
        >
          <Stat
            label="Transacties"
            value={String(data.uncategorizedCount)}
            tone={data.uncategorizedCount > 0 ? "negative" : "neutral"}
            hint={data.uncategorizedCount > 0 ? "Kost één klik per merchant" : "Alles is ingedeeld"}
          />
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Rekeningen">
          {data.accounts.length === 0 ? (
            <p className="text-sm text-muted">Geen rekeningen.</p>
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

        <Card title="Laatste transacties">
          {data.recent.length === 0 ? (
            <p className="text-sm text-muted">Nog niets geïmporteerd.</p>
          ) : (
            <ul className="divide-y divide-border text-[13px]">
              {data.recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{t.merchant ?? t.description}</span>
                    <span className="block text-xs text-muted">
                      {formatDay(t.bookedAt)} · {t.accountName} ·{" "}
                      {t.categoryName ?? "niet gecategoriseerd"}
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
