import { formatCents, formatCentsSigned } from "@/lib/money";
import type { BalanceComparison } from "@/lib/queries/dashboard";

/**
 * Where the money actually sat at the end of each period. The category table
 * explains the spending; this shows whether it left the accounts richer, and by
 * how much of it was debt.
 */
export function BalanceChanges({
  data,
  currentLabel,
  otherLabel,
}: {
  data: BalanceComparison;
  currentLabel: string;
  otherLabel: string;
}) {
  const change = (deltaCents: number) =>
    deltaCents === 0 ? "—" : formatCentsSigned(deltaCents);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <caption className="sr-only">
          {`Account balances at the end of ${currentLabel} compared with ${otherLabel}`}
        </caption>
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted">
            <th scope="col" className="py-1 pr-3 text-left font-medium">
              Account
            </th>
            <th scope="col" className="py-1 pl-3 text-right font-medium">
              {currentLabel}
            </th>
            <th scope="col" className="py-1 pl-3 text-right font-medium">
              {otherLabel}
            </th>
            <th scope="col" className="py-1 pl-3 text-right font-medium">
              Change
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                {row.name}
              </th>
              <td className="tabular py-1.5 pl-3 text-right">{formatCents(row.currentCents)}</td>
              <td className="tabular py-1.5 pl-3 text-right text-muted">
                {formatCents(row.otherCents)}
              </td>
              <td
                className={`tabular py-1.5 pl-3 text-right ${
                  row.deltaCents > 0
                    ? "text-positive"
                    : row.deltaCents < 0
                      ? "text-negative"
                      : "text-muted"
                }`}
              >
                {change(row.deltaCents)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border text-[13px]">
          <tr>
            <th scope="row" className="py-1.5 pr-3 text-left font-medium">
              Assets
            </th>
            <td className="tabular py-1.5 pl-3 text-right">
              {formatCents(data.current.assetsCents)}
            </td>
            <td className="tabular py-1.5 pl-3 text-right text-muted">
              {formatCents(data.other.assetsCents)}
            </td>
            <td className="tabular py-1.5 pl-3 text-right">
              {change(data.current.assetsCents - data.other.assetsCents)}
            </td>
          </tr>
          <tr>
            <th scope="row" className="py-1.5 pr-3 text-left font-medium">
              Credit card debt
            </th>
            <td className="tabular py-1.5 pl-3 text-right">
              {formatCents(data.current.liabilitiesCents)}
            </td>
            <td className="tabular py-1.5 pl-3 text-right text-muted">
              {formatCents(data.other.liabilitiesCents)}
            </td>
            <td className="tabular py-1.5 pl-3 text-right">
              {change(data.current.liabilitiesCents - data.other.liabilitiesCents)}
            </td>
          </tr>
          <tr>
            <th scope="row" className="py-1.5 pr-3 text-left font-medium">
              Net worth
            </th>
            <td className="tabular py-1.5 pl-3 text-right font-medium">
              {formatCents(data.current.netCents)}
            </td>
            <td className="tabular py-1.5 pl-3 text-right text-muted">
              {formatCents(data.other.netCents)}
            </td>
            <td
              className={`tabular py-1.5 pl-3 text-right font-medium ${
                data.current.netCents - data.other.netCents >= 0
                  ? "text-positive"
                  : "text-negative"
              }`}
            >
              {change(data.current.netCents - data.other.netCents)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-2 text-xs text-muted">
        Accounts only. Houses are valued at today&rsquo;s estimate and left out here.
      </p>
    </div>
  );
}
