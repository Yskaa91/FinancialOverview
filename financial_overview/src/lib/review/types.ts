// Shared vocabulary for the import review dialog. Three parties agree on this:
// the classification layer (src/lib/review/classify.ts), the AI proposal layer
// (src/lib/categorize/ai.ts) and the dialog itself
// (src/components/import-review/*). Nothing here touches the database.

import type { CategoryKind, RuleMatchOn, RuleOperator } from "@/lib/types";

export type CategoryOption = { id: string; name: string; kind: CategoryKind };

/** Why a preview row already has a category, before the user does anything. */
export type ReviewMatch = {
  /** Empty string when merchant memory answered instead of a rule. */
  ruleId: string;
  /** Human label shown in the "matched by" column. */
  ruleName: string;
  categoryId: string;
};

export type ReviewRow = {
  /** Position in the stored preview; the only handle the dialog needs. */
  index: number;
  /** yyyy-mm-dd, already formatted for display. */
  bookedAt: string;
  amountCents: number;
  description: string;
  merchant: string | null;
};

/**
 * The unit of review. One merchant, many rows: choosing a category once must be
 * enough, otherwise the dialog is unusable for a 200-row statement.
 */
export type ReviewGroup = {
  /** Stable key used in decisions: merchant key when known, else a hash of the label. */
  key: string;
  label: string;
  rows: ReviewRow[];
  /** Sum of the group in cents, so the user sees the weight of the decision. */
  totalCents: number;
  /** How many rows of this merchant already live in the database. */
  historyHits: number;
  /** historyHits + rows.length >= MIN_HITS_FOR_RULE. Only these earn a rule. */
  recurring: boolean;
  /** Set when the rule engine or merchant memory already answered. */
  match: ReviewMatch | null;
  /** Filled by the AI button. Null means "nothing proposed". */
  proposedCategoryId: string | null;
  proposal: ProposalState;
};

/** SUGGESTED = shown, waiting for a click. ACCEPTED/REJECTED = the user decided. */
export type ProposalState = "NONE" | "SUGGESTED" | "ACCEPTED" | "REJECTED";

/**
 * A rule the AI suggests. The model never decides this: recurrence does. The
 * model only picks the category, which keeps rules predictable.
 */
export type RuleProposal = {
  /** The group key this rule would cover. */
  key: string;
  name: string;
  matchOn: RuleMatchOn;
  operator: RuleOperator;
  pattern: string;
  categoryId: string;
  /** Rows this rule would have caught, including those already in the database. */
  hits: number;
  proposal: "SUGGESTED" | "ACCEPTED" | "REJECTED";
};

/**
 * What the user approved. Absent keys mean "leave that group alone": a missing
 * decision can never silently categorise anything.
 */
export type ReviewDecisions = {
  /** group key -> categoryId. null = explicitly left uncategorised. */
  categories: Record<string, string | null>;
  /** Group keys whose proposed rule should be created. */
  acceptedRules: string[];
  /** incoming row hash -> what to do with a suspected duplicate. */
  duplicates: Record<string, "import" | "skip">;
};

/**
 * A row that looks like it is already in the database: either literally the same
 * transaction (an overlapping import), or one close enough in date and amount to
 * be worth a human look. Skipped by default when exact, imported by default
 * otherwise, and always shown before anything is written.
 */
export type DuplicateCandidate = {
  /** The incoming row's dedupe hash: also the key in ReviewDecisions.duplicates. */
  hash: string;
  kind: "EXACT" | "LIKELY";
  reason: "same-hash" | "same-amount-near-date" | "same-amount-same-merchant";
  row: {
    bookedAt: string;
    amountCents: number;
    description: string;
    merchant: string | null;
  };
  existing: {
    id: string;
    bookedAt: string;
    amountCents: number;
    description: string;
    merchant: string | null;
  };
  /** What the dialog (and the commit) does when the user does not touch it. */
  defaultDecision: "import" | "skip";
};

export type AiStatus = {
  configured: boolean;
  model: string;
  /** True once a suggestion run completed for this preview. */
  ran: boolean;
  calls: number;
  /** "not-configured" | "request-failed" | "no-rows" | undefined */
  error?: string;
};

export type ReviewState = {
  groups: ReviewGroup[];
  ruleProposals: RuleProposal[];
  categories: CategoryOption[];
  ai: AiStatus;
  /** Suspected duplicates for the rows in this import. Empty when none. */
  duplicates: DuplicateCandidate[];
};
