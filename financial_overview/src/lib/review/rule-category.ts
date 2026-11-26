// Which category an approved rule gets. Shared because two places need the same
// answer: the server that writes the rule, and the dialog that shows it. They
// used to disagree, which is how a rule ended up with the model's category while
// its transactions got the user's.

export function ruleCategoryFor({
  decided,
  proposalCategoryId,
  matchCategoryId,
}: {
  /** decisions.categories[key]; undefined = untouched, null = left uncategorised. */
  decided: string | null | undefined;
  proposalCategoryId?: string | null;
  matchCategoryId?: string | null;
}): string | null {
  if (decided !== undefined) return decided;
  return proposalCategoryId ?? matchCategoryId ?? null;
}
