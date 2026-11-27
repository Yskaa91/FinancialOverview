import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatCents } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { requireSession } from "@/lib/auth";
import { loadReconciliation, type ReconRow } from "@/lib/queries/reconciliation";
import { breakLink, linkByHand, matchTransfers } from "./actions";

// Reads the database on every request.
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "missing-input": "Pick a row on the other side first.",
  "same-transaction": "That is the same row twice.",
  "same-account": "Both rows belong to the same account.",
  "already-linked": "One of those rows is already part of a pair. Break that pair first.",
  currency: "The two rows are in different currencies.",
  amount: "The amounts do not match. Only the same money can be linked.",
  "too-far-apart": "Those two rows are more than 45 days apart.",
  "same-direction-on-two-cards": "Two outgoing rows on two cards are not one movement.",
  "missing-transaction": "One of those rows no longer exists.",
  "missing-account": "One of those accounts no longer exists.",
};

const KIND_LABELS: Record<string, string> = {
  FUNDING: "Funded",
  SETTLEMENT: "Settled",
  OWN_ACCOUNT: "Own account",
};

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const sp = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const reconciliation = await loadReconciliation();
  const error = first(sp.error);
  const matched = first(sp.matched);
  const linked = first(sp.linked);
  const unlinked = first(sp.unlinked);
  const message = error
    ? (ERRORS[error] ?? `The pair could not be linked (${error}).`)
    : linked
      ? "Linked. Those two rows now count as one movement."
      : unlinked
        ? "Unlinked. Both rows count on their own again."
        : matched !== undefined
          ? `Pairing run finished: ${matched} new pair(s).`
          : null;

  return (
    <>
      <PageHeader
        title="Reconciliation"
        subtitle="The same money seen from two accounts: the bank's direct debit and the PayPal purchase it paid for, the card bill and its collection"
      />

      {message && (
        <p
          className={`mb-3 rounded-md border px-3 py-2 text-sm ${
            error ? "border-negative/40 bg-negative/5 text-negative" : "border-border bg-surface-muted/50"
          }`}
        >
          {message}
        </p>
      )}

      <div className="grid gap-3">
        <Card
          title={`Linked pairs — ${reconciliation.pairsTotal}`}
          action={
            <form action={matchTransfers}>
              <button
                type="submit"
                className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-muted"
              >
                Match transfers
              </button>
            </form>
          }
        >
          <p className="mb-2 text-xs text-muted">
            One movement, two statements. The leg that names the shop keeps counting as spending;
            the other leg moves its own account&apos;s balance and is kept out of income and
            expenses.
          </p>
          {reconciliation.pairs.length === 0 ? (
            <EmptyState title="Nothing linked yet">
              Import a bank statement and the wallet or card statement that goes with it, then press
              Match transfers.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 font-medium">Kind</th>
                    <th className="py-2 pr-3 font-medium">Leg</th>
                    <th className="py-2 pr-3 font-medium">Counter leg</th>
                    <th className="py-2 pl-3 text-right font-medium">Amount</th>
                    <th className="py-2 pl-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation.pairs.map((pair) => (
                    <tr key={pair.linkId} className="border-b border-border/60 last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted">
                        {KIND_LABELS[pair.kind] ?? pair.kind}
                        {pair.method === "MANUAL" && (
                          <span className="ml-1 rounded border border-border px-1 text-[10px] uppercase">
                            manual
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <RowLine row={pair.left} />
                      </td>
                      <td className="py-2 pr-3">
                        <RowLine row={pair.right} />
                      </td>
                      <td className="whitespace-nowrap py-2 pl-3 text-right tabular">
                        {formatCents(pair.left.amountCents)}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        <form action={breakLink}>
                          <input type="hidden" name="linkId" value={pair.linkId} />
                          <button
                            type="submit"
                            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:text-foreground"
                          >
                            Unlink
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

        <Card title={`Rows waiting for a partner — ${reconciliation.unmatched.length}`}>
          <p className="mb-2 text-xs text-muted">
            A bank or wallet row that names another of your accounts but has no counterpart. Either
            that statement was never imported, or the leg falls outside the imported period. Card
            purchases are not listed here — a card settles as one monthly debit, checked below.
          </p>
          {reconciliation.unmatched.length === 0 ? (
            <EmptyState title="Everything is accounted for">
              Every settlement leg has a partner.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Account</th>
                    <th className="py-2 pr-3 font-medium">Row</th>
                    <th className="py-2 pl-3 text-right font-medium">Amount</th>
                    <th className="py-2 pl-3 font-medium">Link to</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation.unmatched.map((row) => (
                    <tr key={row.id} className="border-b border-border/60 last:border-0">
                      <td className="whitespace-nowrap py-2 pr-3 tabular">{formatDay(row.bookedAt)}</td>
                      <td className="py-2 pr-3 text-xs text-muted">{row.accountName}</td>
                      <td className="max-w-[20rem] py-2 pr-3">
                        <span className="block truncate" title={row.description}>
                          {row.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2 pl-3 text-right tabular">
                        {formatCents(row.amountCents)}
                      </td>
                      <td className="py-2 pl-3">
                        {row.candidates.length === 0 ? (
                          <span className="text-[11px] text-muted">no candidate in the window</span>
                        ) : (
                          <form action={linkByHand} className="flex items-center gap-1">
                            <input type="hidden" name="leftId" value={row.id} />
                            <select
                              name="rightId"
                              aria-label={`Link ${row.label} to`}
                              className="max-w-[16rem] rounded border border-border bg-background px-1.5 py-1 text-xs"
                            >
                              {row.candidates.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {formatDay(candidate.bookedAt)} · {candidate.accountName} ·{" "}
                                  {candidate.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="submit"
                              className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-muted"
                            >
                              Link
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={`Card statements — ${reconciliation.cardStatements.length}`}>
          <p className="mb-2 text-xs text-muted">
            A card is collected once a month: the bank sees one direct debit, the card sees the
            purchases behind it. Individual card rows therefore never have a partner — the total of
            one statement is what settles, and it has to equal the debit to the cent.
          </p>
          {reconciliation.cardStatements.length === 0 ? (
            <EmptyState title="No card statements">Import a card statement to check it against the bank.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 font-medium">Card</th>
                    <th className="py-2 pr-3 font-medium">Statement period</th>
                    <th className="py-2 pl-3 text-right font-medium">Charges</th>
                    <th className="py-2 pl-3 font-medium">Collected by</th>
                    <th className="py-2 pl-3 text-right font-medium">Bank debit</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliation.cardStatements.map((statement) => (
                    <tr key={statement.statementId} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3">{statement.accountName}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted">
                        {statement.periodStart && statement.periodEnd
                          ? `${formatDay(statement.periodStart)} – ${formatDay(statement.periodEnd)}`
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap py-2 pl-3 text-right tabular">
                        {formatCents(statement.chargesCents)}
                      </td>
                      <td className="py-2 pl-3 text-xs">
                        {statement.paidBy ? (
                          <span className="text-muted">
                            {formatDay(new Date(`${statement.paidBy.bookedAt}T00:00:00.000Z`))} ·{" "}
                            {statement.paidBy.accountName}
                          </span>
                        ) : (
                          <span className="text-muted">
                            {statement.creditedCents > 0 && statement.chargesCents === 0
                              ? "nothing charged"
                              : "no debit found"}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 pl-3 text-right tabular">
                        {statement.paidBy ? formatCents(statement.paidBy.amountCents) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Statement coverage">
          <p className="mb-2 text-xs text-muted">
            What has been imported per account. A gap here is the usual reason a settlement row above
            has no partner.
          </p>
          <table className="data-table w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-3 font-medium">Account</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pl-3 text-right font-medium">Statements</th>
                <th className="py-2 pl-3 font-medium">Period covered</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.coverage.map((account) => (
                <tr key={account.accountId} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3">{account.accountName}</td>
                  <td className="py-2 pr-3 text-xs text-muted">{account.institution}</td>
                  <td className="py-2 pl-3 text-right tabular">{account.statements}</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-xs text-muted">
                    {account.periodStart && account.periodEnd
                      ? `${formatDay(account.periodStart)} – ${formatDay(account.periodEnd)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}

function RowLine({ row }: { row: ReconRow }) {
  return (
    <span className="block">
      <span className="block truncate" title={row.description}>
        {row.label}
      </span>
      <span className="block text-[11px] text-muted">
        {formatDay(row.bookedAt)} · {row.accountName}
        {row.excluded ? " · not counted" : ""}
      </span>
    </span>
  );
}
