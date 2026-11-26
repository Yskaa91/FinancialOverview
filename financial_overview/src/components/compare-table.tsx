import Link from "next/link";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { dayBounds, formatChangePercent, type CompareRow, type PeriodTotals } from "@/lib/periods";

/**
 * The same money, two periods, one line per category. Spending that appears on
 * only one side is kept and marked "new" or "gone": a subscription that started
 * this month is the finding, not an edge case.
 */
export function CompareTable({
  rows,
  current,
  other,
}: {
  rows: CompareRow[];
  current: PeriodTotals;
  other: PeriodTotals;
}) {
  const bounds = dayBounds(current.period);
  const filterHref = (categoryId: string) =>
    `/transactions?categoryId=${categoryId}&from=${bounds.from}&to=${bounds.to}`;

  const incomeDelta = current.incomeCents - other.incomeCents;
  const expenseDelta = current.expenseCents - other.expenseCents;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <caption className="sr-only">
          {`Spending per category, ${current.period.label} compared with ${other.period.label}`}
        </caption>
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted">
            <th scope="col" className="py-1 pr-3 text-left font-medium">
              Category
            </th>
            <th scope="col" className="py-1 pl-3 text-right font-medium">
              {current.period.label}
            </th>
            <th scope="col" className="py-1 pl-3 text-right font-medium">
              {other.period.label}
            </th>
            <th scope="col" className="py-1 pl-3 text-right font-medium">
              Change
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id ?? "uncategorised"}>
              <th scope="row" className="max-w-[16rem] truncate py-1.5 pr-3 text-left font-normal">
                {row.id ? (
                  <Link href={filterHref(row.id)} className="hover:underline">
                    {row.name}
                  </Link>
                ) : (
                  <Link
                    href={`/transactions?review=1`}
                    className="text-muted hover:underline"
                    title="Transactions without a category; open the review queue"
                  >
                    {row.name}
                  </Link>
                )}
              </th>
              <td className="tabular py-1.5 pl-3 text-right">{formatCents(row.currentCents)}</td>
              <td className="tabular py-1.5 pl-3 text-right text-muted">
                {formatCents(row.otherCents)}
              </td>
              <td
                className={`tabular py-1.5 pl-3 text-right ${
                  row.deltaCents > 0
                    ? "text-negative"
                    : row.deltaCents < 0
                      ? "text-positive"
                      : "text-muted"
                }`}
              >
                {row.deltaCents === 0
                  ? "—"
                  : `${formatCentsSigned(row.deltaCents)} (${formatChangePercent(row.deltaCents, row.otherCents)})`}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border text-[13px]">
          <tr>
            <th scope="row" className="py-1.5 pr-3 text-left font-medium">
              Income
            </th>
            <td className="tabular py-1.5 pl-3 text-right">{formatCents(current.incomeCents)}</td>
            <td className="tabular py-1.5 pl-3 text-right text-muted">
              {formatCents(other.incomeCents)}
            </td>
            <td
              className={`tabular py-1.5 pl-3 text-right ${
                incomeDelta >= 0 ? "text-positive" : "text-negative"
              }`}
            >
              {incomeDelta === 0
                ? "—"
                : `${formatCentsSigned(incomeDelta)} (${formatChangePercent(incomeDelta, other.incomeCents)})`}
            </td>
          </tr>
          <tr>
            <th scope="row" className="py-1.5 pr-3 text-left font-medium">
              Total expenses
            </th>
            <td className="tabular py-1.5 pl-3 text-right font-medium">
              {formatCents(current.expenseCents)}
            </td>
            <td className="tabular py-1.5 pl-3 text-right text-muted">
              {formatCents(other.expenseCents)}
            </td>
            <td
              className={`tabular py-1.5 pl-3 text-right font-medium ${
                expenseDelta > 0
                  ? "text-negative"
                  : expenseDelta < 0
                    ? "text-positive"
                    : "text-muted"
              }`}
            >
              {expenseDelta === 0
                ? "—"
                : `${formatCentsSigned(expenseDelta)} (${formatChangePercent(expenseDelta, other.expenseCents)})`}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
