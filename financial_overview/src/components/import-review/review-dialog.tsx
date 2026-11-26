"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import {
  cancelPreview,
  commitPreview,
  suggestForPreview,
  type LoadedReview,
} from "@/app/import/actions";
import { formatDay } from "@/lib/dates";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { ruleCategoryFor } from "@/lib/review/rule-category";
import type {
  CategoryOption,
  DuplicateCandidate,
  ReviewDecisions,
  ReviewGroup,
  ReviewState,
  RuleProposal,
} from "@/lib/review/types";

/** The dialog's props live in actions.ts, so the two can never drift apart. */
export type ReviewSummary = LoadedReview["summary"];

type DuplicateDecision = "import" | "skip";

const KIND_ORDER = ["EXPENSE", "INCOME", "TRANSFER"] as const;
const DUPLICATE_CHOICES = ["import", "skip"] as const;

/** yyyy-mm-dd -> "31-01-2026". Parsed as UTC midnight, the way rows are stored. */
function day(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? iso : formatDay(parsed);
}

/** First and last booking date of a group; one date when the group is a single day. */
function span(rows: ReviewGroup["rows"]): string {
  if (rows.length === 0) return "—";
  let first = rows[0].bookedAt.slice(0, 10);
  let last = first;
  for (const row of rows) {
    const date = row.bookedAt.slice(0, 10);
    if (date < first) first = date;
    if (date > last) last = date;
  }
  return first === last ? day(first) : `${day(first)} → ${day(last)}`;
}

function categoryName(categories: CategoryOption[], id: string | null): string {
  if (!id) return "—";
  return categories.find((c) => c.id === id)?.name ?? "unknown";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function aiMessage(ai: ReviewState["ai"], suggestions: number, rules: number): string {
  if (!ai.configured) {
    return "AI is not configured, so nothing is suggested. Categorise the rows below by hand.";
  }
  if (ai.error === "request-failed") return "AI request failed, nothing was applied.";
  if (ai.error === "not-configured") return "AI is not configured, so nothing was suggested.";
  if (ai.error === "no-rows") return "AI had no unmatched rows to look at.";
  if (ai.ran) return `${plural(suggestions, "suggestion")}, ${plural(rules, "rule")} proposed.`;
  return `Nothing suggested yet. ${ai.model} fills the empty categories.`;
}

function CategorySelect({
  categories,
  value,
  onChange,
  ariaLabel,
  proposedCategoryId,
}: {
  categories: CategoryOption[];
  value: string;
  onChange: (next: string | null) => void;
  ariaLabel: string;
  proposedCategoryId: string | null;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.currentTarget.value === "" ? null : event.currentTarget.value)}
      aria-label={ariaLabel}
      className="w-full max-w-[10rem] rounded border border-border bg-background px-1.5 py-1 text-xs"
    >
      <option value="">No category</option>
      {KIND_ORDER.map((kind) => {
        const options = categories.filter((c) => c.kind === kind);
        if (options.length === 0) return null;
        return (
          <optgroup key={kind} label={kind.toLowerCase()}>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id === proposedCategoryId ? `${c.name} · suggested` : c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

function GroupRows({
  group,
  categories,
  value,
  onPick,
  ruleChecked,
  onToggleRule,
  ruleDisabled,
  showRuleColumn,
  muted,
}: {
  group: ReviewGroup;
  categories: CategoryOption[];
  value: string;
  onPick: (next: string | null) => void;
  ruleChecked: boolean;
  onToggleRule: () => void;
  /** A rule must point at a category, so the box waits for one. */
  ruleDisabled?: boolean;
  /** Rule column for the "needs a category" table, "matched by" column otherwise. */
  showRuleColumn?: boolean;
  muted: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const meta = muted ? "text-muted" : "";
  const suggestion =
    group.proposedCategoryId === null
      ? null
      : value === group.proposedCategoryId
        ? "suggested"
        : value === ""
          ? "rejected"
          : "changed";

  return (
    <>
      <tr className="border-b border-border/60">
        <td className="py-1 pr-2">
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${expanded ? "Hide" : "Show"} ${plural(group.rows.length, "transaction")} of ${group.label}`}
            className="flex max-w-[18rem] items-center gap-1 text-left text-sm hover:underline"
          >
            <span aria-hidden className="w-3 shrink-0 text-[10px] text-muted">
              {expanded ? "▾" : "▸"}
            </span>
            <span className="truncate">{group.label}</span>
          </button>
          <div className="mt-0.5 pl-4 text-[11px] text-muted">
            {group.recurring ? `seen ${group.historyHits + group.rows.length}x in 12 months` : "one-off"}
            {suggestion && <span> · {suggestion}</span>}
          </div>
        </td>
        <td className={`py-1 pr-2 text-right text-xs tabular ${meta}`}>{group.rows.length}</td>
        <td className={`whitespace-nowrap py-1 pr-2 text-xs tabular ${meta}`}>{span(group.rows)}</td>
        <td
          className={`py-1 pr-2 text-right text-sm tabular ${
            group.totalCents < 0 ? "text-negative" : "text-positive"
          }`}
        >
          {formatCents(group.totalCents)}
        </td>
        <td className="py-1 pr-2">
          <CategorySelect
            categories={categories}
            value={value}
            onChange={onPick}
            ariaLabel={`Category for ${group.label}`}
            proposedCategoryId={group.proposedCategoryId}
          />
        </td>
        {showRuleColumn ? (
          <td className="py-1 text-[11px] text-muted">
            {group.recurring ? (
              <label
                className="inline-flex items-center gap-1"
                title={ruleDisabled ? "pick a category first" : "Create a rule for this merchant"}
              >
                <input
                  type="checkbox"
                  checked={ruleChecked}
                  disabled={ruleDisabled}
                  onChange={onToggleRule}
                  aria-label={`Also create a rule for ${group.label}`}
                />
                rule
              </label>
            ) : (
              <span title="One-offs never earn a rule">—</span>
            )}
          </td>
        ) : (
          <td className="py-1 text-xs text-muted">
            {group.match ? (group.match.ruleId ? group.match.ruleName : "Merchant memory") : "—"}
          </td>
        )}
      </tr>
      {expanded && (
        <tr id={panelId}>
          <td colSpan={6} className="bg-surface-muted/60 px-2 pb-2">
            <table className="w-full text-xs">
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.index}>
                    <td className="whitespace-nowrap py-0.5 pr-2 tabular">{day(row.bookedAt)}</td>
                    <td className="max-w-[30rem] truncate py-0.5 pr-2" title={row.description}>
                      {row.description}
                    </td>
                    <td
                      className={`whitespace-nowrap py-0.5 text-right tabular ${
                        row.amountCents < 0 ? "text-negative" : "text-positive"
                      }`}
                    >
                      {formatCents(row.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function RuleProposalRow({
  proposal,
  categories,
  categoryId,
  checked,
  onToggle,
}: {
  proposal: RuleProposal;
  categories: CategoryOption[];
  /** What the rule will actually use: the user's pick wins over the suggestion. */
  categoryId: string | null;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="border-b border-border/60">
      <td className="py-1 pr-2">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label={`Create rule ${proposal.name}`}
          />
          <span className="truncate">{proposal.name}</span>
        </label>
      </td>
      <td className="whitespace-nowrap py-1 pr-2 font-mono text-xs text-muted">
        {proposal.matchOn.toLowerCase()} {proposal.operator.toLowerCase()}{" "}
        <span className="text-foreground">&quot;{proposal.pattern}&quot;</span>
      </td>
      <td className="py-1 pr-2 text-xs">{categoryName(categories, categoryId)}</td>
      <td className="whitespace-nowrap py-1 text-right text-xs tabular text-muted">
        would catch {plural(proposal.hits, "transaction")}
      </td>
    </tr>
  );
}

function DuplicateBlock({
  candidates,
  overrides,
  onDecide,
  onAll,
}: {
  candidates: DuplicateCandidate[];
  overrides: Record<string, DuplicateDecision>;
  onDecide: (hash: string, decision: DuplicateDecision) => void;
  onAll: (decision: DuplicateDecision) => void;
}) {
  const decided = (candidate: DuplicateCandidate) =>
    overrides[candidate.hash] ?? candidate.defaultDecision;
  const toImport = candidates.filter((candidate) => decided(candidate) === "import").length;
  const toSkip = candidates.length - toImport;

  return (
    <section className="mb-4 rounded-lg border border-border bg-surface-muted/50 p-2">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Possible duplicates — {plural(candidates.length, "row")}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            Overlapping statements are normal. Check these before saving.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onAll("import")}
            className="rounded border border-border bg-surface px-2 py-1 text-[11px] hover:bg-surface-muted"
          >
            Import all
          </button>
          <button
            type="button"
            onClick={() => onAll("skip")}
            className="rounded border border-border bg-surface px-2 py-1 text-[11px] hover:bg-surface-muted"
          >
            Skip all
          </button>
        </div>
      </div>

      <table className="data-table w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-muted">
          <tr className="border-b border-border text-left">
            <th className="py-2 pr-2 font-medium">Check</th>
            <th className="py-2 pr-2 font-medium">Date</th>
            <th className="py-2 pr-2 text-right font-medium">Amount</th>
            <th className="py-2 pr-2 font-medium">Incoming row</th>
            <th className="py-2 pr-2 font-medium">In the database</th>
            <th className="py-2 font-medium">Decision</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => {
            const decision = decided(candidate);
            return (
              <tr key={candidate.hash} className="border-b border-border/60">
                <td className="py-1 pr-2 align-top">
                  <span
                    className={`inline-block rounded border px-1 text-[10px] font-medium uppercase tracking-wide ${
                      candidate.kind === "EXACT"
                        ? "border-negative/40 bg-negative/5 text-negative"
                        : "border-accent/40 bg-accent/5 text-accent"
                    }`}
                  >
                    {candidate.kind}
                  </span>
                  <div className="mt-0.5 max-w-[11rem] text-[10px] leading-tight text-muted">
                    {candidate.kind === "EXACT"
                      ? "already imported"
                      : "looks the same as an existing row"}
                  </div>
                </td>
                <td className="whitespace-nowrap py-1 pr-2 align-top text-xs tabular">
                  {day(candidate.row.bookedAt)}
                </td>
                <td
                  className={`whitespace-nowrap py-1 pr-2 align-top text-right text-xs tabular ${
                    candidate.row.amountCents < 0 ? "text-negative" : "text-positive"
                  }`}
                >
                  {formatCents(candidate.row.amountCents)}
                </td>
                <td className="py-1 pr-2 align-top">
                  <div className="max-w-[18rem] truncate text-xs" title={candidate.row.description}>
                    {candidate.row.merchant ?? candidate.row.description}
                  </div>
                  {candidate.row.merchant && (
                    <div className="max-w-[18rem] truncate text-[10px] text-muted" title={candidate.row.description}>
                      {candidate.row.description}
                    </div>
                  )}
                </td>
                <td className="py-1 pr-2 align-top text-[11px] text-muted">
                  <span className="whitespace-nowrap tabular">{day(candidate.existing.bookedAt)}</span>{" "}
                  <span
                    className="inline-block max-w-[14rem] truncate align-bottom"
                    title={candidate.existing.description}
                  >
                    {candidate.existing.merchant ?? candidate.existing.description}
                  </span>{" "}
                  <span className="whitespace-nowrap tabular">
                    {formatCents(candidate.existing.amountCents)}
                  </span>
                </td>
                <td className="py-1 align-top">
                  <div className="inline-flex overflow-hidden rounded border border-border text-[11px]">
                    {DUPLICATE_CHOICES.map((choice) => (
                      <label key={choice} className="border-l border-border first:border-l-0">
                        <input
                          type="radio"
                          name={`duplicate-${candidate.hash}`}
                          value={choice}
                          checked={decision === choice}
                          onChange={() => onDecide(candidate.hash, choice)}
                          className="peer sr-only"
                        />
                        <span className="block cursor-pointer px-2 py-0.5 text-muted hover:bg-surface-muted peer-checked:bg-accent peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
                          {choice === "import" ? "Import" : "Skip"}
                        </span>
                      </label>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-1 text-[11px] text-muted" role="status">
        <span className="tabular">{toImport}</span> to import,{" "}
        <span className="tabular">{toSkip}</span> to skip
      </p>
    </section>
  );
}

/**
 * The preview step. It is a dialog because reviewing is a decision, not a page:
 * everything the statement needs to be saved is in here, and one footer button
 * writes it. Nothing is committed until that button.
 */
export function ReviewDialog({ review, summary }: { review: ReviewState; summary: ReviewSummary }) {
  // Only what the user touched. Untouched groups stay out of the decisions, and
  // the server falls back to the rule engine for those.
  const [touched, setTouched] = useState<Record<string, string | null>>({});
  // Rules the AI already proposed start checked: saying yes is a click in the
  // footer, saying no is one click here.
  const [rules, setRules] = useState<string[]>(() =>
    review.ruleProposals.map((proposal) => proposal.key),
  );
  // Duplicate rows the user has overridden; anything absent keeps its default.
  const [duplicates, setDuplicates] = useState<Record<string, DuplicateDecision>>({});
  const cancelForm = useRef<HTMLFormElement>(null);

  const close = useCallback(() => cancelForm.current?.requestSubmit(), []);

  const unmatched = review.groups.filter((group) => group.match === null);
  const matched = review.groups.filter((group) => group.match !== null);
  const suggested = review.groups.filter((group) => group.proposedCategoryId !== null).length;

  /** What the select shows: the user's pick, else the AI suggestion, else the rule's category. */
  const valueOf = (group: ReviewGroup) => {
    const picked = touched[group.key];
    if (picked !== undefined) return picked ?? "";
    return group.proposedCategoryId ?? group.match?.categoryId ?? "";
  };

  /**
   * A proposed rule is shown with the category those rows are about to get, not
   * with the model's original suggestion: changing the category of a merchant
   * has to change the rule listed for it, or the footer would promise one thing
   * and the database store another.
   */
  const ruleCategoryOf = (proposal: RuleProposal) =>
    ruleCategoryFor({ decided: touched[proposal.key], proposalCategoryId: proposal.categoryId });

  /** Picking a category is also the moment a group enters (or leaves) the decisions. */
  const pick = (key: string, next: string | null) => {
    setTouched((prev) => ({ ...prev, [key]: next }));
    if (next === null) setRules((prev) => prev.filter((k) => k !== key));
  };

  const categories: Record<string, string | null> = {};
  for (const group of review.groups) {
    if (group.proposedCategoryId) categories[group.key] = group.proposedCategoryId;
  }
  Object.assign(categories, touched);

  // Only deviations travel: an absent duplicate falls back to defaultDecision.
  const duplicateDecisions: Record<string, DuplicateDecision> = {};
  for (const candidate of review.duplicates) {
    const chosen = duplicates[candidate.hash] ?? candidate.defaultDecision;
    if (chosen !== candidate.defaultDecision) duplicateDecisions[candidate.hash] = chosen;
  }

  const decisions: ReviewDecisions = {
    categories,
    acceptedRules: rules,
    duplicates: duplicateDecisions,
  };

  // The server's saveCount already honours defaultDecision, so only the flips move it.
  let writeCount = summary.saveCount;
  for (const candidate of review.duplicates) {
    const chosen = duplicates[candidate.hash] ?? candidate.defaultDecision;
    if (chosen !== candidate.defaultDecision) writeCount += chosen === "import" ? 1 : -1;
  }
  writeCount = Math.max(0, writeCount);

  const setAllDuplicates = (decision: DuplicateDecision) =>
    setDuplicates(
      Object.fromEntries(review.duplicates.map((candidate) => [candidate.hash, decision])),
    );

  const toggleRule = (key: string) =>
    setRules((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const approveAll = () => {
    const next: Record<string, string | null> = { ...touched };
    for (const group of review.groups) {
      if (group.proposedCategoryId) next[group.key] = group.proposedCategoryId;
    }
    setTouched(next);
    setRules(review.ruleProposals.map((proposal) => proposal.key));
  };

  /**
   * The counterpart of approveAll: only suggestions are denied. A rule-matched or
   * transfer group was never a suggestion, so it keeps its category and stays out
   * of the decisions.
   */
  const denyAll = () => {
    const next: Record<string, string | null> = {};
    for (const group of review.groups) {
      if (group.proposedCategoryId !== null || touched[group.key] !== undefined) {
        next[group.key] = null;
      }
    }
    setTouched(next);
    setRules([]);
  };

  const categorised = unmatched.filter((group) => valueOf(group) !== "").length;

  return (
    <>
      <form ref={cancelForm} id="review-cancel" action={cancelPreview} className="hidden" />

      <Modal
        open
        size="xl"
        title="Review statement"
        subtitle={`${summary.filename} · ${summary.source} · ${summary.accountName} · ${plural(summary.rowCount, "row")}`}
        onClose={close}
        footer={
          <form action={commitPreview} className="flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="decisions" value={JSON.stringify(decisions)} />
            <p className="text-xs text-muted">
              <span className="tabular">{formatCentsSigned(summary.sumCents)}</span> ·{" "}
              {summary.duplicates > 0 ? `${plural(summary.duplicates, "duplicate")} skipped · ` : ""}
              <span className="tabular">
                {day(summary.periodStart)} → {day(summary.periodEnd)}
              </span>{" "}
              · nothing is written until you save
            </p>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                form="review-cancel"
                className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:bg-surface-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
              >
                Save {plural(writeCount, "transaction")}
              </button>
            </div>
          </form>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {review.ai.configured && (
            <form action={suggestForPreview}>
              <button
                type="submit"
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
              >
                {review.ai.ran ? "Suggest with AI again" : "Suggest with AI"}
              </button>
            </form>
          )}
          {(suggested > 0 || review.ruleProposals.length > 0) && (
            <button
              type="button"
              onClick={approveAll}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-muted"
            >
              Approve all suggestions
            </button>
          )}
          {(suggested > 0 ||
            review.ruleProposals.length > 0 ||
            Object.keys(touched).length > 0 ||
            rules.length > 0) && (
            <button
              type="button"
              onClick={denyAll}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-muted"
            >
              Deny all suggestions
            </button>
          )}
          <p className="text-xs text-muted" role="status">
            {aiMessage(review.ai, suggested, review.ruleProposals.length)}
          </p>
        </div>

        {review.duplicates.length > 0 && (
          <DuplicateBlock
            candidates={review.duplicates}
            overrides={duplicates}
            onDecide={(hash, decision) =>
              setDuplicates((prev) => ({ ...prev, [hash]: decision }))
            }
            onAll={setAllDuplicates}
          />
        )}

        {summary.rejected.length > 0 && (
          <div className="mb-3 text-xs text-muted">
            {plural(summary.rejected.length, "row")} could not be read and will be skipped.
            <details className="mt-0.5">
              <summary className="cursor-pointer text-[11px]">Details</summary>
              <ul className="mt-1 space-y-0.5 pl-4">
                {summary.rejected.map((rejected) => (
                  <li key={rejected.line}>
                    line {rejected.line}: {rejected.reason}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}

        <section className="mb-4">
          <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
            Needs a category — {plural(unmatched.length, "merchant")}, {categorised} categorised
          </h3>
          {unmatched.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm">
              Everything was matched by a rule.
            </p>
          ) : (
            <table className="data-table w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted">
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-2 font-medium">Merchant</th>
                  <th className="py-2 pr-2 text-right font-medium">Rows</th>
                  <th className="py-2 pr-2 font-medium">Period</th>
                  <th className="py-2 pr-2 text-right font-medium">Total</th>
                  <th className="py-2 pr-2 font-medium">Category</th>
                  <th className="py-2 font-medium">Rule</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((group) => (
                  <GroupRows
                    key={group.key}
                    group={group}
                    categories={review.categories}
                    value={valueOf(group)}
                    onPick={(next) => pick(group.key, next)}
                    ruleChecked={rules.includes(group.key)}
                    onToggleRule={() => toggleRule(group.key)}
                    ruleDisabled={valueOf(group) === ""}
                    showRuleColumn
                    muted={false}
                  />
                ))}
              </tbody>
            </table>
          )}
        </section>

        {review.ruleProposals.length > 0 && (
          <section className="mb-4">
            <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
              Proposed rules ({review.ruleProposals.length})
            </h3>
            <table className="data-table w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-muted">
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-2 font-medium">Rule</th>
                  <th className="py-2 pr-2 font-medium">Matches on</th>
                  <th className="py-2 pr-2 font-medium">Category</th>
                  <th className="py-2 text-right font-medium">Reach</th>
                </tr>
              </thead>
              <tbody>
                {review.ruleProposals.map((proposal) => (
                  <RuleProposalRow
                    key={proposal.key}
                    proposal={proposal}
                    categories={review.categories}
                    categoryId={ruleCategoryOf(proposal)}
                    checked={rules.includes(proposal.key)}
                    onToggle={() => toggleRule(proposal.key)}
                  />
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section>
          <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
            Matched by rules — {plural(matched.length, "merchant")}
          </h3>
          {matched.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted">
              No rule matched any row.
            </p>
          ) : (
            <table className="data-table w-full text-sm text-muted">
              <thead className="text-[11px] uppercase tracking-wide text-muted">
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-2 font-medium">Merchant</th>
                  <th className="py-2 pr-2 text-right font-medium">Rows</th>
                  <th className="py-2 pr-2 font-medium">Period</th>
                  <th className="py-2 pr-2 text-right font-medium">Total</th>
                  <th className="py-2 pr-2 font-medium">Category</th>
                  <th className="py-2 font-medium">Matched by</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((group) => (
                  <GroupRows
                    key={group.key}
                    group={group}
                    categories={review.categories}
                    value={valueOf(group)}
                    onPick={(next) => pick(group.key, next)}
                    ruleChecked={false}
                    onToggleRule={() => undefined}
                    muted
                  />
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-muted">
            Matched rows keep the category of their rule unless you pick another one here.
          </p>
        </section>
      </Modal>
    </>
  );
}
