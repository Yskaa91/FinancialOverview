"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCents } from "@/lib/money";
import { AXIS_TICK, CHART, TOOLTIP_PROPS, monthLabel } from "./chart-theme";

export type CashflowPoint = { month: string; incomeCents: number; expenseCents: number };

export function CashflowBars({ points }: { points: CashflowPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        No cashflow yet. Import a statement to compare income against expenses per month.
      </p>
    );
  }

  // Expenses hang below the shared zero line. The incoming amounts are positive
  // cents; flipping the sign here keeps the props plain and the axis single.
  const data = points.map((point) => ({
    month: monthLabel(point.month),
    income: point.incomeCents,
    expenses: -point.expenseCents,
  }));
  const incomeTotal = points.reduce((sum, point) => sum + point.incomeCents, 0);
  const expenseTotal = points.reduce((sum, point) => sum + point.expenseCents, 0);
  const biggestExpense = points.reduce((a, b) => (b.expenseCents > a.expenseCents ? b : a));

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {`Income and expenses over ${points.length} months: ${formatCents(incomeTotal)} in, ${formatCents(expenseTotal)} out, a net of ${formatCents(incomeTotal - expenseTotal)}. The highest expense month is ${monthLabel(biggestExpense.month)} at ${formatCents(biggestExpense.expenseCents)}.`}
      </figcaption>

      {/* Two series, so name them in sight: the green and red never carry the
          meaning on their own. */}
      <ul className="mb-1 flex gap-3 text-[11px] text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-[1px]" style={{ background: CHART.positive }} />
          Income
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-[1px]" style={{ background: CHART.negative }} />
          Expenses
        </li>
      </ul>

      <div className="aspect-[8/3] max-h-[240px] w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke={CHART.border} strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: CHART.border }}
              minTickGap={16}
            />
            <YAxis
              width={80}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatCents(Number(value))}
            />
            <ReferenceLine y={0} stroke={CHART.border} />
            <Tooltip
              {...TOOLTIP_PROPS}
              cursor={{ fill: CHART.surfaceMuted }}
              formatter={(value) => formatCents(Math.abs(Number(value)))}
            />
            <Bar
              dataKey="income"
              name="Income"
              fill={CHART.positive}
              radius={[2, 2, 0, 0]}
              isAnimationActive="auto"
            />
            <Bar
              dataKey="expenses"
              name="Expenses"
              fill={CHART.negative}
              radius={[0, 0, 2, 2]}
              isAnimationActive="auto"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <table className="sr-only">
        <caption>Income and expenses per month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Income</th>
            <th scope="col">Expenses</th>
          </tr>
        </thead>
        <tbody>
          {points.map((row) => (
            <tr key={row.month}>
              <th scope="row">{monthLabel(row.month)}</th>
              <td>{formatCents(row.incomeCents)}</td>
              <td>{formatCents(row.expenseCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
