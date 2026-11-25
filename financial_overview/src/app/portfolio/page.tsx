import Link from "next/link";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatCents, formatCentsSigned, microToQuantity } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { getPortfolioOverview } from "@/lib/queries/portfolio";
import { refreshStalePrices } from "@/lib/portfolio/quotes";
import { ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/types";
import { requireSession } from "@/lib/auth";
import { addTrade, deleteTrade, setPrice } from "@/app/accounts/[id]/actions";

export const dynamic = "force-dynamic";

/**
 * Manual trade entry for every account in one place. Positions and totals come
 * from the same FIFO query the account page uses, so a trade recorded here and a
 * trade recorded there can never disagree.
 */
export default async function PortfolioPage() {
  await requireSession();
  // Automatic price tracking: opening this page refreshes any quote older than
  // twelve hours, and does nothing at all when PRICE_FETCH is off.
  await refreshStalePrices();
  const portfolio = await getPortfolioOverview();

  return (
    <>
      <PageHeader
        title="Portfolio"
        subtitle="Buy and sell stock and ETFs by hand, then track them per account"
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Holdings value" value={formatCents(portfolio.holdingsValueCents)} large />
        </Card>
        <Card>
          <Stat
            label="Unrealised P/L"
            value={formatCentsSigned(portfolio.unrealizedCents)}
            hint={`cost basis ${formatCents(portfolio.costBasisCents)}`}
          />
        </Card>
        <Card>
          <Stat
            label="Realised P/L"
            value={formatCentsSigned(portfolio.realizedCents)}
            hint="from closed lots, FIFO"
          />
        </Card>
        <Card>
          <Stat label="Cash" value={formatCents(portfolio.cashCents)} hint="broker cash on the books" />
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Record a trade" className="lg:col-span-1">
          {portfolio.accounts.length === 0 ? (
            <EmptyState title="No accounts yet">
              Create an account first —{" "}
              <Link href="/accounts" className="underline">
                Accounts
              </Link>
              .
            </EmptyState>
          ) : (
            <form action={addTrade} className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs sm:col-span-2">
                <span className="mb-1 block text-muted">Account</span>
                <select
                  name="accountId"
                  required
                  defaultValue={
                    portfolio.accounts.find((a) => a.type === "BROKER")?.id ?? portfolio.accounts[0].id
                  }
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                >
                  {portfolio.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {ACCOUNT_TYPE_LABELS[account.type as AccountType]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-muted">Symbol</span>
                <input
                  name="symbol"
                  required
                  list="portfolio-symbols"
                  placeholder="IWDA"
                  autoComplete="off"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm uppercase"
                />
                <datalist id="portfolio-symbols">
                  {portfolio.instruments.map((instrument) => (
                    <option key={instrument.id} value={instrument.symbol}>
                      {instrument.name}
                    </option>
                  ))}
                </datalist>
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
          )}
        </Card>

        <Card title="Open positions" className="min-w-0 lg:col-span-2">
          {portfolio.positions.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing held yet. Record a buy and the position, its cost basis and its value show up
              here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-2 font-medium">Symbol</th>
                    <th className="py-2 pr-2 font-medium">Account</th>
                    <th className="py-2 pr-2 text-right font-medium">Qty</th>
                    <th className="py-2 pr-2 text-right font-medium">Avg</th>
                    <th className="py-2 pr-2 text-right font-medium">Price</th>
                    <th className="py-2 pr-2 text-right font-medium">Value</th>
                    <th className="py-2 text-right font-medium">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.positions.map((holding) => (
                    <tr
                      key={`${holding.accountId}-${holding.instrumentId}`}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="py-1.5 pr-2">
                        <span className="block">{holding.symbol}</span>
                        <span className="block max-w-[14rem] truncate text-[11px] text-muted">
                          {holding.name}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-xs text-muted">{holding.accountName}</td>
                      <td className="py-1.5 pr-2 text-right tabular">
                        {microToQuantity(holding.quantityMicro)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular">
                        {formatCents(holding.averageCostCents)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular">
                        {formatCents(holding.priceCents)}
                        <form action={setPrice} className="mt-1 flex items-center justify-end gap-1">
                          <input type="hidden" name="accountId" value={holding.accountId} />
                          <input type="hidden" name="instrumentId" value={holding.instrumentId} />
                          <input
                            name="price"
                            inputMode="decimal"
                            placeholder="price"
                            aria-label={`Price for ${holding.symbol}`}
                            className="tabular w-14 rounded border border-border bg-background px-1 py-0.5 text-[11px]"
                          />
                          <button
                            type="submit"
                            className="rounded border border-border px-1 py-0.5 text-[10px] text-muted hover:bg-surface-muted"
                          >
                            set
                          </button>
                        </form>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular">
                        {formatCents(holding.valueCents)}
                      </td>
                      <td
                        className={`py-1.5 text-right tabular ${
                          holding.unrealizedCents < 0 ? "text-negative" : "text-positive"
                        }`}
                      >
                        {formatCentsSigned(holding.unrealizedCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-3">
        <Card title="Trade log">
          {portfolio.trades.length === 0 ? (
            <p className="text-sm text-muted">No trades yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-2 font-medium">Date</th>
                    <th className="py-2 pr-2 font-medium">Account</th>
                    <th className="py-2 pr-2 font-medium">Side</th>
                    <th className="py-2 pr-2 font-medium">Symbol</th>
                    <th className="py-2 pr-2 text-right font-medium">Qty</th>
                    <th className="py-2 pr-2 text-right font-medium">Price</th>
                    <th className="py-2 pr-2 text-right font-medium">Fee</th>
                    <th className="py-2 pr-2 text-right font-medium">Total</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {portfolio.trades.map((trade) => (
                    <tr key={trade.id} className="border-b border-border/60 last:border-0">
                      <td className="whitespace-nowrap py-1.5 pr-2 tabular">
                        {formatDay(trade.tradedAt)}
                      </td>
                      <td className="py-1.5 pr-2 text-xs text-muted">{trade.accountName}</td>
                      <td className="py-1.5 pr-2">
                        <span className={trade.side === "BUY" ? "text-positive" : "text-negative"}>
                          {trade.side.toLowerCase()}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">{trade.symbol}</td>
                      <td className="py-1.5 pr-2 text-right tabular">
                        {microToQuantity(trade.quantityMicro)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular">{formatCents(trade.priceCents)}</td>
                      <td className="py-1.5 pr-2 text-right tabular">{formatCents(trade.feeCents)}</td>
                      <td className="py-1.5 pr-2 text-right tabular">
                        {formatCents(
                          Math.round((trade.quantityMicro * trade.priceCents) / 1_000_000) +
                            trade.feeCents,
                        )}
                      </td>
                      <td className="py-1.5">
                        <form action={deleteTrade}>
                          <input type="hidden" name="tradeId" value={trade.id} />
                          <input type="hidden" name="accountId" value={trade.accountId} />
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
    </>
  );
}
