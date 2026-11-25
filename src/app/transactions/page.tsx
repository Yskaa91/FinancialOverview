import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { listAccounts } from "@/lib/queries/accounts";
import { listCategories, listTransactions } from "@/lib/queries/transactions";
import { CategoryPicker } from "./category-picker";
import { runRules, suggestWithAi } from "./actions";
import { AI_MODEL, isAiConfigured } from "@/lib/categorize/ai";

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const review = first(sp.review) === "1";

  const filters = {
    accountId: first(sp.accountId),
    categoryId: first(sp.categoryId),
    from: first(sp.from),
    to: first(sp.to),
    q: first(sp.q),
    page: Number(first(sp.page) ?? 1),
    review,
  };

  const [{ items, count, pageCount, sumCents }, accounts, categories] = await Promise.all([
    listTransactions(filters),
    listAccounts(true),
    listCategories(),
  ]);

  return (
    <>
      <PageHeader
        title="Income & expenses"
        subtitle="Filter, categorise and review every transaction"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={review ? "/transactions" : "/transactions?review=1"}
          className={`rounded-md border px-2.5 py-1.5 ${
            review
              ? "border-accent bg-accent/10 font-medium text-foreground"
              : "border-border text-muted hover:bg-surface-muted"
          }`}
        >
          {review ? "Showing review queue" : "Review queue"}
        </Link>
        <form action={runRules}>
          <button
            type="submit"
            className="rounded-md border border-border px-2.5 py-1.5 text-muted hover:bg-surface-muted"
          >
            Run rules on uncategorised
          </button>
        </form>
        {isAiConfigured() && (
          <form action={suggestWithAi}>
            <button
              type="submit"
              className="rounded-md border border-border px-2.5 py-1.5 text-muted hover:bg-surface-muted"
              title={`Asks ${AI_MODEL} for suggestions; nothing is applied without your click`}
            >
              Suggest with AI
            </button>
          </form>
        )}
        <span className="text-xs text-muted">
          Picking a category saves immediately and remembers the merchant.
        </span>
      </div>

      {(first(sp.suggested) || first(sp.ai) || first(sp.aiError)) && (
        <div className="mb-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
          {first(sp.ai) === "off"
            ? "AI is off. Set AI_PROVIDER=mistral and AI_API_KEY in .env.local, then restart the server."
            : first(sp.aiError)
              ? `AI request failed (${first(sp.aiError)}). Nothing was changed; rows stay in the queue.`
              : `${first(sp.suggested) ?? 0} suggestions added, ${first(sp.calls) ?? 0} API calls. Confirm them below — suggested is not applied.`}
        </div>
      )}

      <form className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" action="/transactions">
        {review && <input type="hidden" name="review" value="1" />}
        <input
          name="q"
          defaultValue={filters.q}
          placeholder="Search description or merchant"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm lg:col-span-2"
        />
        <select
          name="accountId"
          defaultValue={filters.accountId ?? ""}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">All accounts</option>
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
          <option value="">All categories</option>
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
        <EmptyState title="No transactions in this selection">
          {review ? (
            <>Nothing left to review. Every transaction has a category.</>
          ) : (
            <>
              Change the filter, or{" "}
              <Link href="/import" className="underline">
                import a statement
              </Link>
              .
            </>
          )}
        </EmptyState>
      ) : (
        <Card
          title={`${count} transactions`}
          action={
            <span className="tabular text-sm text-muted">
              sum {formatCentsSigned(sumCents)}
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead className="text-[11px]">
                <tr className="border-b border-border text-left uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pl-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3 tabular">{formatDay(t.bookedAt)}</td>
                    <td className="max-w-[22rem] py-2 pr-3">
                      <span className="block truncate" title={t.description}>
                        {t.merchant ?? t.description}
                      </span>
                      {t.reviewState === "SUGGESTED" && (
                        <span className="block text-[11px] text-muted">
                          AI suggestion, not confirmed
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted">{t.accountName}</td>
                    <td className="py-2 pr-3">
                      <CategoryPicker
                        transactionId={t.id}
                        categoryId={t.categoryId}
                        categories={categories.map((c) => ({
                          id: c.id,
                          name: c.name,
                          kind: c.kind,
                        }))}
                        sameMerchantOpen={t.sameMerchantOpen}
                      />
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
              page {Math.min(filters.page, pageCount)} of {pageCount}
            </span>
            <span className="flex gap-3">
              {filters.page > 1 && (
                <Link href={{ pathname: "/transactions", query: { ...sp, page: filters.page - 1 } }} className="underline">
                  previous
                </Link>
              )}
              {filters.page < pageCount && (
                <Link href={{ pathname: "/transactions", query: { ...sp, page: filters.page + 1 } }} className="underline">
                  next
                </Link>
              )}
            </span>
          </div>
        </Card>
      )}
    </>
  );
}
