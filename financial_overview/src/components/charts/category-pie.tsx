"use client";

import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { LOCALE, formatCents } from "@/lib/money";
import { CATEGORY_RAMP, CHART } from "./chart-theme";

export type CategorySlice = { name: string; cents: number; color?: string | null };

const percent = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  maximumFractionDigits: 1,
});

// A category colour comes from the database and is user-editable, so it can be
// any string. Keep the ones a browser can paint and fall back to the ramp.
const PAINTABLE = /^(#[0-9a-f]{3,8}|oklch\(|oklab\(|lab\(|lch\(|rgb\(|hsl\()/i;

function sliceFill(color: string | null | undefined, index: number): string {
  const trimmed = color?.trim();
  return trimmed && PAINTABLE.test(trimmed)
    ? trimmed
    : CATEGORY_RAMP[index % CATEGORY_RAMP.length];
}

export function CategoryPie({ slices }: { slices: CategorySlice[] }) {
  const positive = slices.filter((slice) => slice.cents > 0);
  const total = positive.reduce((sum, slice) => sum + slice.cents, 0);

  if (total <= 0) {
    return (
      <p className="py-6 text-center text-sm text-muted">
        Nothing spent yet. Import a statement to see where the money goes.
      </p>
    );
  }

  const sorted = [...positive].sort((a, b) => b.cents - a.cents);
  const head = sorted.slice(0, 6);
  const rest = sorted.slice(6);
  const restCents = rest.reduce((sum, slice) => sum + slice.cents, 0);
  const rows = restCents > 0 ? [...head, { name: "Other", cents: restCents, color: null }] : head;

  const data = rows.map((row, index) => ({
    name: row.name,
    cents: row.cents,
    fill: sliceFill(row.color, index),
  }));
  const largest = data[0];

  return (
    <figure className="m-0 flex flex-col gap-2 sm:flex-row sm:items-center">
      <figcaption className="sr-only">
        {`Expenses by category: ${formatCents(total)} over ${data.length} ${data.length === 1 ? "category" : "categories"}. The largest is ${largest.name} at ${percent.format(largest.cents / total)} with ${formatCents(largest.cents)}.`}
      </figcaption>

      {/* The list is the readable view: every slice shows its name, share and
          amount, so colour is never the only label. */}
      <ul className="order-2 flex-1 space-y-1 text-[13px] sm:order-1">
        {data.map((row, index) => (
          <li key={`${row.name}-${index}`} className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span
                aria-hidden
                className="size-2.5 shrink-0 translate-y-px rounded-[2px]"
                style={{ background: row.fill }}
              />
              <span className="truncate">{row.name}</span>
            </span>
            <span className="tabular shrink-0 text-muted">
              {percent.format(row.cents / total)} · {formatCents(row.cents)}
            </span>
          </li>
        ))}
      </ul>

      {/* The donut is decoration once the list is there, so it takes the smaller
          share: at 2/5 of a narrow card the names lost their last characters. */}
      <div className="order-1 w-full sm:order-2 sm:w-1/3">
        <div className="aspect-[4/3] max-h-[200px] w-full">
          <ResponsiveContainer>
            <PieChart>
              <Tooltip
                formatter={(value, name) => [
                  `${formatCents(Number(value))} (${percent.format(Number(value) / total)})`,
                  name,
                ]}
              />
              <Pie
                data={data}
                dataKey="cents"
                nameKey="name"
                innerRadius="55%"
                outerRadius="88%"
                paddingAngle={1}
                // A surface-coloured ring between slices separates neighbours without
                // relying on their hue difference.
                stroke={CHART.surface}
                strokeWidth={2}
                isAnimationActive="auto"
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </figure>
  );
}
