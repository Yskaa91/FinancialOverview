"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { AXIS_TICK, CHART, TOOLTIP_PROPS, monthLabel } from "./chart-theme";

export type NetWorthPoint = { date: string; cents: number };

export function NetWorthChart({ points }: { points: NetWorthPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        No history yet. Import a statement or fill in an opening balance to start the line.
      </p>
    );
  }

  // One month is a single dot in a corner; the skill's chart data says fewer than
  // four points belong in a stat, so say the number instead of drawing a line.
  if (points.length === 1) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        <span className="tabular text-foreground">{formatCents(points[0].cents)}</span> in{" "}
        {monthLabel(points[0].date)}. The trend line appears from the second month on.
      </p>
    );
  }

  const data = points.map((point) => ({
    month: monthLabel(point.date),
    cents: point.cents,
  }));
  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map((point) => point.cents);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const change = last.cents - first.cents;

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {`Net worth over ${points.length} months: ${formatCents(first.cents)} in ${monthLabel(first.date)} to ${formatCents(last.cents)} in ${monthLabel(last.date)}, a change of ${formatCentsSigned(change)}. Highest ${formatCents(high)}, lowest ${formatCents(low)}.`}
      </figcaption>

      <div className="aspect-[8/3] max-h-[260px] w-full">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
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
              // "auto" instead of the default zero baseline: net worth never nears
              // zero, and anchoring it there would flatten the whole trend.
              domain={["auto", "auto"]}
              tickFormatter={(value) => formatCents(Number(value))}
            />
            <Tooltip
              {...TOOLTIP_PROPS}
              cursor={{ stroke: CHART.border }}
              formatter={(value) => formatCents(Number(value))}
            />
            <Area
              type="monotone"
              dataKey="cents"
              name="Net worth"
              stroke={CHART.accent}
              strokeWidth={2}
              fill={CHART.accent}
              fillOpacity={0.18}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              // "auto" tells Recharts to skip the entrance animation when the user
              // prefers reduced motion, which CSS cannot switch off.
              isAnimationActive="auto"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <table className="sr-only">
        <caption>Net worth per month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Net worth</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.month}>
              <th scope="row">{row.month}</th>
              <td>{formatCents(row.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
