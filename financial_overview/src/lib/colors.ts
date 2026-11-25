// Category colours. A category without an explicit colour used to be stored as
// null, which rendered as an indistinguishable grey dot: the point of the colour
// is telling categories apart at a glance in the charts.

/**
 * Hues chosen to stay distinguishable next to each other in a pie chart, and to
 * survive the muted token background. Deliberately not generated: random RGB
 * gives muddy colours and near-duplicates.
 */
export const CATEGORY_PALETTE = [
  "#6366f1", // indigo
  "#22c55e", // green
  "#0ea5e9", // sky
  "#a855f7", // violet
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#eab308", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#84cc16", // lime
  "#64748b", // slate
] as const;

/** One palette colour, avoiding the ones this account already uses. */
export function pickCategoryColor(
  /** Colours already taken, e.g. every existing category's colour. */
  taken: (string | null)[] = [],
  random: () => number = Math.random,
): string {
  const used = new Set(taken.filter((colour): colour is string => Boolean(colour)).map((c) => c.toLowerCase()));
  const free = CATEGORY_PALETTE.filter((colour) => !used.has(colour));
  const pool = free.length > 0 ? free : CATEGORY_PALETTE;
  // Math.random is fine for a colour; when it returns exactly 1 the index is
  // clamped rather than undefined.
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index];
}
