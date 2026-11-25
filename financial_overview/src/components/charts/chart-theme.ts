// Chart paints and labels shared by the three dashboard charts. Colours are the
// design tokens from globals.css, so charts follow light and dark mode without a
// second palette living in the component tree.

import { formatMonth, parseStatementDate } from "@/lib/dates";

export const CHART = {
  accent: "var(--color-accent)",
  positive: "var(--color-positive)",
  negative: "var(--color-negative)",
  muted: "var(--color-muted)",
  border: "var(--color-border)",
  surface: "var(--color-surface)",
  surfaceMuted: "var(--color-surface-muted)",
} as const;

// Categorical ramp for the pie: the three token hues plus the neutral, each with a
// second, lighter step. No new hues are invented. The step is L0.62 / C0.10 because
// that clears 3:1 against both the light and the dark surface (3.45:1 and 4.38:1
// worst case), which a lighter step would not. Steps alternate so neighbouring
// slices differ in lightness as well as in hue, and every slice is named in the
// legend, so no meaning rests on colour alone.
export const CATEGORY_RAMP = [
  CHART.accent,
  "oklch(0.62 0.10 155)", // positive, second step
  CHART.negative,
  "oklch(0.62 0.10 258)", // accent, second step
  CHART.positive,
  "oklch(0.62 0.10 25)", // negative, second step
  CHART.muted, // "Other" is deliberately neutral: it is the residual, not a category
] as const;

/** Low-contrast ticks: the data, not the axes, carries the colour. */
export const AXIS_TICK = { fill: CHART.muted, fontSize: 11 } as const;

export const TOOLTIP_PROPS = {
  contentStyle: {
    background: CHART.surface,
    border: `1px solid ${CHART.border}`,
    borderRadius: "6px",
    padding: "6px 8px",
    fontSize: "12px",
    color: "var(--color-foreground)",
  },
  labelStyle: { color: CHART.muted, fontSize: "11px" },
  itemStyle: { fontSize: "12px", fontVariantNumeric: "tabular-nums" },
} as const;

/** "2026-01-01" or "01-01-2026" → "jan '26"; anything unparseable stays as given. */
export function monthLabel(date: string): string {
  const parsed = parseStatementDate(date);
  return parsed ? formatMonth(parsed) : date;
}
