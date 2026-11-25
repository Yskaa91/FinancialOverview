# Design brief: dashboard charts and the review-mode categorisation UI

Scope of this brief: the chart layer in `src/components/charts/**` (built) and the
review-mode categorisation UI on `/transactions?review=1` (specified, not built).
Everything below was decided from the vendored skill at
`.vibe/skills/ui-ux-pro-max` plus the existing tokens in `src/app/globals.css`.

## 0. What exists now

```ts
// src/components/charts/net-worth-chart.tsx
export type NetWorthPoint = { date: string; cents: number };
export function NetWorthChart({ points }: { points: NetWorthPoint[] }): JSX.Element;

// src/components/charts/cashflow-bars.tsx
export type CashflowPoint = { month: string; incomeCents: number; expenseCents: number };
export function CashflowBars({ points }: { points: CashflowPoint[] }): JSX.Element;

// src/components/charts/category-pie.tsx
export type CategorySlice = { name: string; cents: number; color?: string | null };
export function CategoryPie({ slices }: { slices: CategorySlice[] }): JSX.Element;

// src/components/charts/chart-theme.ts
export const CHART: { accent, positive, negative, muted, border, surface, surfaceMuted };
export const CATEGORY_RAMP: readonly string[];
export const AXIS_TICK: { fill, fontSize };
export const TOOLTIP_PROPS: { contentStyle, labelStyle, itemStyle };
export function monthLabel(date: string): string;
```

All three are client components (`"use client"`), take plain props, fetch nothing,
and format money only through `formatCents` from `src/lib/money.ts`. The shapes
match `src/lib/queries/history.ts` (`NetWorthPoint`, `CashflowPoint`) exactly, so
a Server Component can pass that output in with no mapping.

Wiring is one line per chart, inside the existing `Card` from
`src/components/ui.tsx` — the card owns the title, the chart owns the figure:

```tsx
<Card title="Net worth"><NetWorthChart points={netWorthSeries()} /></Card>
```

## 1. Design source: the skill queries that were run

```bash
python3 .vibe/skills/ui-ux-pro-max/scripts/search.py "financial dashboard net worth trend" --domain style
python3 .vibe/skills/ui-ux-pro-max/scripts/search.py "line chart spending over time" --domain chart
python3 .vibe/skills/ui-ux-pro-max/scripts/search.py "category breakdown" --domain chart
python3 .vibe/skills/ui-ux-pro-max/scripts/search.py "chart legend tooltip accessibility" --domain ux
python3 .vibe/skills/ui-ux-pro-max/scripts/search.py "positive negative comparison divergent bars" --domain chart
python3 .vibe/skills/ui-ux-pro-max/scripts/search.py "categorical color palette accessible" --domain color
python3 .vibe/skills/ui-ux-pro-max/scripts/search.py "inline category picker suggestion approval" --domain ux
python3 .vibe/skills/ui-ux-pro-max/scripts/search.py "bulk actions multi select table rows" --domain ux
```

`--domain color` returned zero hits for "categorical color palette accessible"; a
broader retry ("chart data") returned three product palettes (Citizen Science,
Analytics Dashboard, GIS) and no categorical ramp. The rules themselves live in
`references/quick-reference.md` section 10 ("Charts & Data"), which was read in
full.

### Used

| Source | What was taken |
|---|---|
| style `data-dense-dashboard` (parent of `financial-dashboard`) | 12px card padding, 36px rows, 12px meta text, grid gap 8px — already the repo's tokens, so no change |
| style `financial-dashboard` | trend-over-decoration, number formatting, positive/negative semantics, `cost:low` (SVG only) |
| chart `Trend Over Time` | line/area for a time axis; 20% fill; text/table fallback; SVG under 1000 points; "fewer than 4 points → use a stat" |
| chart `Cumulative Changes` (waterfall) | signed values with a shared zero line, direction not colour, for the cashflow bars |
| chart `Compare Categories` | always sort descending, direct labels, ≤15 categories |
| chart `Proportional / Percentage` | part-to-whole summary; the warning that a part-to-whole view degrades past 5 slices |
| ux Accessibility: contrast, alt text, error announcement | 4.5:1 text, 3:1 graphics, `sr-only` text alternatives, `role="alert"` for failures |
| ux Data Entry: `Bulk Actions` | checkbox column + action bar, not per-row repetition |
| ux Forms: inline validation, error placement, focusable summary | review-mode error handling below |
| quick-reference §10 rules | `empty-data-state`, `animation-optional`, `screen-reader-summary`, `data-table`, `legend-visible`, `tooltip-on-interact`, `number-formatting`, `contrast-data`, `gridline-subtle`, `trend-emphasis`, `time-scale-clarity`, `responsive-chart`, `axis-readability`, `focusable-elements` |

### Rejected, and why

- **The skill's hex palettes** (`financial-dashboard`: profit `#22C55E`, loss
  `#EF4444`, trust `#003366`; chart `#0080FF`; the three `colors.csv` product
  palettes). The repo already owns an oklch token set that adapts to dark mode;
  adding hexes would mean two palettes and would break AGENTS.md ("design tokens
  live in `globals.css`, change them there, not per component"). No new palette
  was invented — see §3 for what the pie's ramp is made of.
- **Empty state from the skill's "use stat card under 4 points" ad absurdum**: a
  12-month requirement is fixed by the props, so a short series is handled
  explicitly (0 points → message, 1 point → sentence, ≥2 → line) instead of
  dropping the chart.
- **Waffle chart** for the proportion: needs 3–5 categories by the skill's own
  rule and the dashboard slot is small; a donut plus a labelled list reads better
  there.
- **Treemap / nested donut** (`Hierarchical / Nested Data`, `risk:high`): the
  category list is flat here — there is no hierarchy to show.
- **`Cell` for per-slice colours**: deprecated in the installed Recharts 3.11.1
  ("will be removed in Recharts 4.0"). A `fill` on the data entry is the v3 way
  and is what the pie uses.
- **Recharts `Legend` component**: replaced by a real `<ul>` so each row carries
  name, share and amount. `legend-interactive` (click to toggle series) was
  skipped — one series per chart, nothing to toggle.
- **A compact money formatter for the y-axis** (`€12k`): AGENTS.md makes
  `src/lib/money.ts` the only place that formats money, so ticks use
  `formatCents` as-is and the y-axis is 80px wide. If long values ever crowd,
  the fix belongs in `money.ts`, not in a chart.

### The one tension worth recording

`no-pie-overuse` says: avoid a pie/donut past 5 categories, use a bar. The brief
asks for top 6 plus "Other" (7). The mitigation is that the donut is decoration
and the list beside it is the real view: every slice is named in text with its
share and amount, and "Other" is a neutral grey, not a seventh hue. If the card
ever loses width or the list needs more slices, switch the component body to a
horizontal bar list (the skill's preference) — the props do not have to change.

## 2. Chart specs

| | NetWorthChart | CashflowBars | CategoryPie |
|---|---|---|---|
| Form | area + 2px line, monotone | two bars per month | donut, inner 55% / outer 88% |
| Series | one (`cents`) | income above 0, expenses below 0 | 6 slices + neutral "Other" |
| X axis | month label from `formatMonth` (`jan 25`), `minTickGap` 16 | same | none |
| Y axis | `domain={["auto","auto"]}` — **not** zero-anchored, or a 12-month trend flattens against a €0 baseline | shared zero via `<ReferenceLine y={0}>`; one axis for both directions | total in the caption, no axis |
| Ticks | `formatCents`, 11px, muted, no tick lines, no y axis line | same | — |
| Grid | horizontal only, `--color-border`, dashed 3 3 | same | none |
| Fill / stroke | accent line, accent fill at 0.18 | positive / negative tokens, 2px corner radius | token hue or the category's own colour, 2px surface-coloured ring |
| Tooltip | `formatCents`, mouse **and** keyboard (Recharts `accessibilityLayer` is on by default in v3) | absolute amount plus the series name, so "Expenses" never shows as a negative surprise | `€ amount (share%)` + category name |
| Animation | `isAnimationActive="auto"` | same | same |
| Empty state | "No history yet. Import a statement or fill in an opening balance to start the line." | "No cashflow yet. Import a statement to compare income against expenses per month." | "Nothing spent yet. Import a statement to see where the money goes." (also for a zero total) |
| Size | `aspect-[8/3] max-h-[260px]` | `aspect-[8/3] max-h-[240px]` | `aspect-[4/3] max-h-[200px]`, chart above the list on mobile |
| Screen reader | `figcaption` sentence (first → last, change, high, low) + `sr-only` month/value table | `figcaption` sentence (total in, total out, net, worst month) + `sr-only` three-column table | `figcaption` sentence (total, count, largest and its share) + the visible list |

Recharts 3 notes for whoever edits these files: `isAnimationActive="auto"` is the
default and already consults `prefers-reduced-motion` through
`usePrefersReducedMotion` — no custom hook is needed and CSS cannot switch a JS
animation off. `ResponsiveContainer`'s own `aspect` prop leaves the wrapper's
height to the parent, which collapses on an auto-height parent, so the height is
owned by a CSS `aspect-ratio` wrapper instead.

## 3. Colour and contrast

No new palette. Every series colour is a token:

| Role | Token |
|---|---|
| net worth line/fill | `--color-accent` |
| income bars | `--color-positive` |
| expense bars, negative trend | `--color-negative` |
| axis ticks, meta text, "Other" | `--color-muted` |
| gridlines, zero line, tooltip border | `--color-border` |
| pie slice separation, card surface | `--color-surface` |
| tooltip hover band | `--color-surface-muted` |

The pie needs seven distinguishable fills and the token set has three hues, so
`CATEGORY_RAMP` is the three token hues **plus the neutral**, each with a second
step at the same hue and `oklch(0.62 0.10 …)`. That step was chosen by
measurement, not by eye: a lighter step (`L0.72`) only reaches ~2.4:1 on the
white surface and would have failed the skill's "data vs background ≥ 3:1".

Measured contrast (oklch → linear sRGB, relative luminance; sRGB approximation):

| Colour | on light surface `oklch(1 0 0)` | on dark surface `oklch(0.23 0.007 250)` |
|---|---|---|
| accent `0.55 0.15 258` | 4.92:1 | 3.43:1 |
| positive `0.55 0.12 155` | 4.58:1 | 3.69:1 |
| negative `0.55 0.18 25` | 5.32:1 | 3.17:1 |
| second step `0.62 0.10 (155/258/25)` | 3.45:1 | 4.38:1 |
| muted light `0.48` / muted dark `0.72` | 6.53:1 | 6.81:1 |

Consequences that are enforced in code:

- Token hues clear 3:1 for graphics in both modes but **not** 4.5:1 on the dark
  surface, so they are never used as small text. All text is `--foreground` or
  `--muted`, which `globals.css` already keeps at ≥4.5:1.
- A user-editable `Category.color` is used only if a browser can paint it
  (`#hex`, `oklch()`, `oklab()`, `lab()`, `lch()`, `rgb()`, `hsl()`); otherwise
  the slice falls back to the ramp. A broken string would otherwise render an
  invisible slice.
- Slices are separated by a 2px `--color-surface` ring plus 1° padding, so two
  similar fills never share an edge — the gap satisfies the non-text contrast
  requirement without tinting the data.
- Gridlines sit at `--color-border` (1.31:1 on the light surface): deliberately
  below the data, per `gridline-subtle`.
- Status is never colour-only anywhere: names and amounts in the legend and the
  tooltip, "Income"/"Expenses" in the visible legend, "Other" as text.

## 4. The accessibility contract (shared by all three)

- `<figure>` + `<figcaption class="sr-only">` with the one-sentence insight
  (change, extremes, worst month, largest share) — the `screen-reader-summary`
  rule, and the only thing read before the table.
- An `sr-only` table of the plotted values (month → amount, month → income /
  expenses) as the `data-table` alternative, since a hover tooltip is not
  reachable without a mouse.
- Keyboard: Recharts' `accessibilityLayer` puts the chart in the tab order and
  arrows move through the points; no custom key handling was added on top.
- Motion: the entrance animation disappears under `prefers-reduced-motion`
  (`isAnimationActive="auto"`). `globals.css` already nukes CSS transitions.
- Sizing: no fixed pixel heights. `aspect-ratio` wrappers with a `max-h-*` cap,
  so a 320px phone gets a ~120px chart and a 1200px desktop gets a capped 260px
  one. Axis tick density is handled by Recharts' `minTickGap`, not by JS
  breakpoints.

## 5. Review-mode categorisation UI — brief for the implementer

Not built in this pass. Entry point already exists: the dashboard links to
`/transactions?review=1`, and `getReviewQueue()` in `src/lib/queries/dashboard.ts`
returns `SUGGESTED` / `UNCATEGORIZED` rows from the last 90 days.

### 5.1 Shape of the screen

Review mode is a *mode of the transactions table*, not a separate page: same
columns, same 36px rows, one extra leading checkbox column and a sticky action
bar. A review banner at the top states the queue ("23 to review · 8 merchants"),
with a "Leave review" link. Desktop-first, one column, `overflow-x-auto` around
the table (skill: never let a table break the viewport).

Row anatomy, left to right:

| Cell | Content |
|---|---|
| checkbox | 16px box; the whole cell is the label target |
| date | `formatDay`, mono, `--muted`, 12px |
| merchant / description | merchant in `--foreground`, description in 12px `--muted`, truncated with `title` |
| amount | `formatCentsSigned`, tabular, `positive`/`negative` token, right aligned |
| category cell | the picker trigger — see 5.2 |
| state | a chip, text always present — see 5.3 |

### 5.2 Inline category picker (the core interaction)

One component, used both in the row and above a bulk selection. Combobox
pattern, not a `<select>`:

- The trigger is a button showing the current state ("Choose category",
  "Suggested: Groceries", "Groceries · you"). It spans the whole category cell,
  so the hit area is ≥120×36px; under `pointer: coarse` review rows grow to 44px
  (skill priority 2) while the rest of the app stays at 36px.
- Opening it renders a labelled input plus a `role="listbox"`. The input has an
  `sr-only` label naming the row ("Category for ALBERT HEIJN, 12 March"),
  `aria-expanded`, `aria-controls`, `aria-activedescendant`. The listbox is
  ordered: the suggested category first, then the six most used, then the rest
  alphabetically.
- Keys: type to filter, `↓`/`↑` move, `Enter` selects, `Esc` closes and restores
  focus to the trigger, `Tab` closes and moves on (committing nothing).
- Selecting writes `categoryId`, `categorySource = MANUAL`,
  `reviewState = OK` through a Server Action; the row then shows the confirmed
  chip and the queue count decrements. Optimistic update, revert on error.
- Free text never creates a category silently: a "Create category…" item is the
  last entry and routes to `/settings`.
- Validation follows the skill's Forms rules: the failure appears under the row's
  picker with `aria-describedby`, not only as a toast, and a failed bulk apply
  also gets a focusable summary at the top of the table (`role="alert"`,
  `tabindex="-1"`, moved into focus after the failure).

### 5.3 Suggested vs confirmed

`categorySource` is the truth; the chip is only its face.

| State | Chip | Meaning for the user |
|---|---|---|
| `UNCATEGORIZED` (no category) | no chip; the trigger reads "Choose category" in `--muted` | nothing is known |
| `SUGGESTED` + `RULE` | dashed 1px border, rule icon, "Suggested: Groceries" | a rule guessed it; not final |
| `SUGGESTED` + `AI` | dashed border, sparkle icon, "Suggested: Groceries · 82%" | an AI guess with confidence; not final |
| `OK` + `MANUAL` | solid chip, "Groceries · you" | final; nothing automatic may overwrite it |
| `OK` + `RULE` | solid chip, "Groceries · rule" (tooltip: rule name) | applied by a rule, editable |
| `OK` + `AI` (accepted) | solid chip, "Groceries" | accepted, indistinguishable from a manual pick afterwards |

Dashed vs solid plus the word "Suggested" carries the distinction; the icons are
the skill's "no colour-only meaning" requirement, not decoration. Confidence is
text, never a red/amber dot. Accepting a suggestion is one keystroke (`Enter` on
a focused row) or one click on the chip's check button — no confirmation dialog
for a single row.

After the first accept for a merchant, offer the learning step inline in the same
row: "Also categorise the other 7 ALBERT HEIJN rows as Groceries?" with
`[Apply to 7]` and `[Just this one]`. This is the `MerchantMap` loop and the only
bulk path that should ever fire automatically.

### 5.4 Bulk apply

- Checkbox column (skill: `Bulk Actions`) plus select-all in the header. When a
  selection exists, a sticky bar covers the bottom of the table:
  `23 selected · [Category ▾] [Apply] [Clear]`.
- Scope is explicit, never implicit: "This page (23)" vs "All 41 matching the
  filter". Default to the visible page; show the other number so nobody applies
  to a hidden set by accident.
- Before applying, show a one-line preview: count, the distinct merchants
  ("ALBERT HEIJN, JUMBO + 3 more"), and the net amount. Above 20 rows, that
  preview is a confirm step; at or below it, apply immediately with an undo.
- The server action filters `categorySource: { not: "MANUAL" }` regardless of
  what the client sends, and returns `{ updated, skipped }`. The bar announces
  the result politely ("23 categorised as Groceries, 2 skipped because they were
  set by hand") and focus returns to the table header.
- Undo: a 10s toast with `[Undo]`, implementing a revert action for exactly the
  ids the apply touched. No undo, no immediate destructive bulk write.

### 5.5 States, empty and error

| State | Treatment |
|---|---|
| loading | 8 skeleton rows at 36px, no spinner, no layout shift |
| nothing to review | the shared `EmptyState`: "Nothing to review" + "New rows land here after an import." + link to `/import` |
| a filter excludes everything | "No rows match this filter" + `[Clear filters]` — do not show the "nothing to review" copy |
| picker has no categories | "No categories yet" + link to `/settings`; the input stays enabled |
| action failed | inline error under the affected row (or under the bar), `role="alert"`, `[Retry]`; the optimistic change is reverted |
| apply skipped MANUAL rows | success message states the skipped count; never silently ignore |

### 5.6 Copy rules

Sentence case, English only. "Suggested", never "AI thinks" or "Probably".
Amounts always via `formatCents` / `formatCentsSigned`; counts spelled out
("12 transactions"), never "12x". Buttons are verbs ("Apply", "Undo"), states are
nouns ("Suggested", "Uncategorised").

### 5.7 Tests this UI owes

- A category action that leaves `categorySource = MANUAL` rows untouched, with a
  fixture where a bulk apply overlaps both manual and suggested rows.
- A merchant-map learning case: accepting the suggestion for one row and
  applying to the rest produces one `MerchantMap` row, not N.
- Idempotency of a second apply over the same ids (the repo's dedupe habits
  apply to categorisation too: applying twice must not double a `hits` counter).

## 6. Deliberately out of scope

- No page wiring: `src/app/**` was not in this pass, so the charts are exported
  and unused until the dashboard is updated.
- No images, icons or illustrations in the chart layer; no dependency was added.
- Chart legend toggling (`legend-interactive`), zoom/brush, drill-down and CSV
  export of chart data (`export-option`) are all reasonable later additions and
  were skipped as unrequested.
- No component test suite for the charts: the repo has none by design, and
  `tests/**` is outside this pass. The SSR smoke used during development lived
  in `/tmp` and left nothing behind.
