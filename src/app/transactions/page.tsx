import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { listAccounts } from "@/lib/queries/accounts";
import { listCategories, listTransactions } from "@/lib/queries/transactions";

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const filters = {
    accountId: first(sp.accountId),
    categoryId: first(sp.categoryId),
    from: first(sp.from),
    to: first(sp.to),
    q: first(sp.q),
    page: Number(first(sp.page) ?? 1),
  };

  const [{ items, count, pageCount, sumCents }, accounts, categories] = await Promise.all([
    listTransactions(filters),
    listAccounts(true),
    listCategories(),
  ]);

  return (
    <>
      <PageHeader
        title="Inkomsten & uitgaven"
        subtitle="Filter, categoriseer en controleer elke mutatie"
      />

      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" action="/transactions">
        <input
          name="q"
          defaultValue={filters.q}
          placeholder="Zoek omschrijving of merchant"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm lg:col-span-2"
        />
        <select
          name="accountId"
          defaultValue={filters.accountId ?? ""}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">Alle rekeningen</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          name="categoryId"
          defaultValue={filters.categoryId ?? ""}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">Alle categorieën</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            type="date"
            name="from"
            defaultValue={filters.from}
            className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
          />
          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-foreground/5 sm:col-span-2 lg:col-span-1"
        >
          Filter
        </button>
      </form>

      {count === 0 ? (
        <EmptyState title="Geen transacties in deze selectie">
          Pas het filter aan, of{" "}
          <Link href="/import" className="underline">
            importeer een afschrift
          </Link>
          .
        </EmptyState>
      ) : (
        <Card
          title={`${count} transacties`}
          action={
            <span className="tabular text-sm text-muted">
              som {formatCentsSigned(sumCents)}
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-medium">Datum</th>
                  <th className="py-2 pr-3 font-medium">Omschrijving</th>
                  <th className="py-2 pr-3 font-medium">Rekening</th>
                  <th className="py-2 pr-3 font-medium">Categorie</th>
                  <th className="py-2 pl-3 text-right font-medium">Bedrag</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3 tabular">{formatDay(t.bookedAt)}</td>
                    <td className="max-w-[26rem] truncate py-2 pr-3" title={t.description}>
                      {t.merchant ?? t.description}
                    </td>
                    <td className="py-2 pr-3 text-muted">{t.accountName}</td>
                    <td className="py-2 pr-3">
                      {t.categoryName ?? (
                        <span className="text-negative">niet gecategoriseerd</span>
                      )}
                    </td>
                    <td
                      className={`py-2 pl-3 text-right tabular ${t.amountCents < 0 ? "text-negative" : "text-positive"}`}
                    >
                      {formatCents(t.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>
              pagina {Math.min(filters.page, pageCount)} van {pageCount}
            </span>
            <span className="flex gap-3">
              {filters.page > 1 && (
                <Link href={{ pathname: "/transactions", query: { ...sp, page: filters.page - 1 } }} className="underline">
                  vorige
                </Link>
              )}
              {filters.page < pageCount && (
                <Link href={{ pathname: "/transactions", query: { ...sp, page: filters.page + 1 } }} className="underline">
                  volgende
                </Link>
              )}
            </span>
          </div>
        </Card>
      )}
    </>
  );
}
