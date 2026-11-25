import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, Stat } from "@/components/ui";
import { formatCents, formatCentsSigned, microToQuantity } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { getAccount, listAccounts } from "@/lib/queries/accounts";
import { getPortfolio } from "@/lib/queries/portfolio";
import { ACCOUNT_TYPE_LABELS } from "@/lib/types";
import { requireSession } from "@/lib/auth";
import { addTrade, deleteTrade, refreshPrices, setPrice } from "./actions";

export default async function AccountDetailPage({ params }: PageProps<"/accounts/[id]">) {
  await requireSession();
  const { id } = await params;
  const account = await getAccount(id);
  if (!account) notFound();

  const summary = (await listAccounts(true)).find((a) => a.id === id);
  const isBroker = account.type === "BROKER";
  const portfolio = isBroker ? await getPortfolio(id) : null;

  const [transactions, statements] = await Promise.all([
    prisma.transaction.findMany({
      where: { accountId: id },
      orderBy: [{ bookedAt: "desc" }],
      take: 12,
      include: { category: { select: { name: true } } },
    }),
    prisma.statement.findMany({
      where: { accountId: id },
      orderBy: { importedAt: "desc" },
      take: 6,
    }),
  ]);

  const balanceCents = isBroker
    ? (portfolio?.totalCents ?? 0)
    : (summary?.balanceCents ?? account.openingBalanceCents);

  return (
    <>
      <PageHeader
        title={account.name}
        subtitle={`${ACCOUNT_TYPE_LABELS[account.type as keyof typeof ACCOUNT_TYPE_LABELS]} · ${account.institution}${account.iban ? ` · ${account.iban}` : ""}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label={isBroker ? "Total value" : "Balance"} value={formatCents(balanceCents)} large />
        </Card>
        {isBroker && portfolio ? (
          <>
            <Card>
              <Stat label="Cash" value={formatCents(portfolio.cashCents)} />
            </Card>
            <Card>
              <Stat
                label="Unrealised P/L"
                value={formatCentsSigned(portfolio.unrealizedCents)}
                tone={portfolio.unrealizedCents >= 0 ? "positive" : "negative"}
                hint={`Cost basis ${formatCents(portfolio.costBasisCents)}`}
              />
            </Card>
            <Card>
              <Stat
                label="Realised P/L"
                value={formatCentsSigned(portfolio.realizedCents)}
                tone={portfolio.realizedCents >= 0 ? "positive" : "negative"}
                hint={`${portfolio.trades.length} trades`}
              />
            </Card>
          </>
        ) : (
          <>
            <Card>
              <Stat label="Opening balance" value={formatCents(account.openingBalanceCents)} />
            </Card>
            <Card>
              <Stat
                label="Last import"
                value={statements[0] ? formatDay(statements[0].importedAt) : "—"}
              />
            </Card>
          </>
        )}
      </div>

      {isBroker && portfolio && (
        <div className="mt-3 grid gap-3">
          <Card
            title="Holdings"
            action={
              <form action={refreshPrices}>
                <input type="hidden" name="accountId" value={id} />
                <button
                  type="submit"
                  className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-muted"
                  disabled={(process.env.PRICE_FETCH ?? "disabled") !== "enabled"}
                  title={
                    (process.env.PRICE_FETCH ?? "disabled") === "enabled"
                      ? "Fetch quotes from Stooq"
                      : "Set PRICE_FETCH=enabled to fetch quotes"
                  }
                >
                  refresh prices
                </button>
              </form>
            }
          >
            {portfolio.holdings.length === 0 ? (
              <p className="text-sm text-muted">
                No open positions. Record a buy below to start the portfolio.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-muted">
                    <tr className="border-b border-border text-left">
                      <th className="py-2 pr-3 font-medium">Instrument</th>
                      <th className="py-2 pr-3 text-right font-medium">Qty</th>
                      <th className="py-2 pr-3 text-right font-medium">Avg cost</th>
                      <th className="py-2 pr-3 text-right font-medium">Price</th>
                      <th className="py-2 pr-3 text-right font-medium">Value</th>
                      <th className="py-2 pr-3 text-right font-medium">Unrealised</th>
                      <th className="py-2 font-medium">Set price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.holdings.map((h) => (
                      <tr key={h.instrumentId} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{h.symbol}</span>
                          <span className="block text-[11px] text-muted">{h.name}</span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular">
                          {microToQuantity(h.quantityMicro)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular">{formatCents(h.averageCostCents)}</td>
                        <td className="py-2 pr-3 text-right tabular">{formatCents(h.priceCents)}</td>
                        <td className="py-2 pr-3 text-right tabular">{formatCents(h.valueCents)}</td>
                        <td
                          className={`py-2 pr-3 text-right tabular ${h.unrealizedCents < 0 ? "text-negative" : "text-positive"}`}
                        >
                          {formatCentsSigned(h.unrealizedCents)}
                        </td>
                        <td className="py-2">
                          <form action={setPrice} className="flex items-center gap-1">
                            <input type="hidden" name="accountId" value={id} />
                            <input type="hidden" name="instrumentId" value={h.instrumentId} />
                            <input
                              name="price"
                              inputMode="decimal"
                              placeholder="0,00"
                              aria-label={`Price for ${h.symbol}`}
                              className="tabular w-20 rounded border border-border bg-background px-1.5 py-1 text-xs"
                            />
                            <button
                              type="submit"
                              className="rounded border border-border px-1.5 py-1 text-[11px] text-muted hover:bg-surface-muted"
                            >
                              save
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Record a trade">
              <form action={addTrade} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="accountId" value={id} />
                <label className="text-xs">
                  <span className="mb-1 block text-muted">Symbol</span>
                  <input
                    name="symbol"
                    required
                    placeholder="IWDA"
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm uppercase"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-muted">Side</span>
                  <select
                    name="side"
                    defaultValue="BUY"
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="BUY">Buy</option>
                    <option value="SELL">Sell</option>
                  </select>
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-muted">Date</span>
                  <input
                    type="date"
                    name="tradedAt"
                    required
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-muted">Quantity</span>
                  <input
                    name="quantity"
                    required
                    inputMode="decimal"
                    placeholder="2"
                    className="tabular w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-muted">Price per unit</span>
                  <input
                    name="price"
                    required
                    inputMode="decimal"
                    placeholder="84,50"
                    className="tabular w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-muted">Fee</span>
                  <input
                    name="fee"
                    inputMode="decimal"
                    placeholder="2,50"
                    className="tabular w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs sm:col-span-2">
                  <span className="mb-1 block text-muted">Note</span>
                  <input
                    name="note"
                    maxLength={200}
                    className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white sm:col-span-2"
                >
                  Add trade
                </button>
              </form>
            </Card>

            <Card title="Trade log">
              {portfolio.trades.length === 0 ? (
                <p className="text-sm text-muted">No trades yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-muted">
                      <tr className="border-b border-border text-left">
                        <th className="py-2 pr-2 font-medium">Date</th>
                        <th className="py-2 pr-2 font-medium">Side</th>
                        <th className="py-2 pr-2 font-medium">Symbol</th>
                        <th className="py-2 pr-2 text-right font-medium">Qty</th>
                        <th className="py-2 pr-2 text-right font-medium">Price</th>
                        <th className="py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio.trades.map((t) => (
                        <tr key={t.id} className="border-b border-border/60 last:border-0">
                          <td className="whitespace-nowrap py-1.5 pr-2 tabular">
                            {formatDay(t.tradedAt)}
                          </td>
                          <td className="py-1.5 pr-2">
                            <span
                              className={t.side === "BUY" ? "text-positive" : "text-negative"}
                            >
                              {t.side.toLowerCase()}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2">{t.symbol}</td>
                          <td className="py-1.5 pr-2 text-right tabular">
                            {microToQuantity(t.quantityMicro)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular">
                            {formatCents(t.priceCents)}
                          </td>
                          <td className="py-1.5">
                            <form action={deleteTrade}>
                              <input type="hidden" name="tradeId" value={t.id} />
                              <input type="hidden" name="accountId" value={id} />
                              <button
                                type="submit"
                                className="text-[11px] text-muted underline hover:text-negative"
                                title="Delete this trade"
                              >
                                delete
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card title="Recent transactions" className="lg:col-span-2">
          {transactions.length === 0 ? (
            <p className="text-sm text-muted">No transactions on this account yet.</p>
          ) : (
            <ul className="divide-y divide-border text-[13px]">
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
            <ul className="divide-y divide-border text-[13px]">
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
