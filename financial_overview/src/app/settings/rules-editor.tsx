"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Modal } from "@/components/modal";
import { RULE_MATCH_ON, RULE_OPERATORS } from "@/lib/types";
import { createRule, deleteRule, updateRule } from "./actions";

/** Plain shape of a rule row; the Prisma row carries more, none of it needed here. */
export type RuleRowData = {
  id: string;
  name: string;
  matchOn: string;
  operator: string;
  pattern: string;
  categoryId: string;
  priority: number;
  enabled: boolean;
  origin: string;
  hits: number;
};

export type RuleCategory = { id: string; name: string };

// One grid for the header, the new-rule row and every rule row, so the columns line up.
const GRID =
  "grid grid-cols-[minmax(8rem,1fr)_7.5rem_7.5rem_minmax(9rem,1.3fr)_9rem_4rem_2.5rem_3rem_4rem_7.5rem] items-start gap-1.5 px-2";

const INPUT =
  "w-full rounded border border-border bg-background px-1.5 py-1 text-xs outline-none focus:border-accent";

function regexError(operator: string, pattern: string): string | null {
  if (operator !== "REGEX") return null;
  if (!pattern.trim()) return "Pattern is required";
  try {
    new RegExp(pattern, "i");
    return null;
  } catch {
    return "Invalid regex";
  }
}

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "…" : label}
    </button>
  );
}

/**
 * One rule as an editable form. A null rule means the create row at the top of the
 * table. Delete rides on formAction so the row stays a single form (no nesting).
 */
function RuleRowForm({ rule, categories }: { rule: RuleRowData | null; categories: RuleCategory[] }) {
  const [operator, setOperator] = useState(rule?.operator ?? "CONTAINS");
  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const error = regexError(operator, pattern);

  return (
    <form
      action={rule ? updateRule : createRule}
      className={`${GRID} border-t border-border py-1.5 text-xs ${
        rule && !rule.enabled ? "text-muted" : ""
      }`}
    >
      {rule && <input type="hidden" name="id" value={rule.id} />}

      <input
        name="name"
        required
        maxLength={60}
        defaultValue={rule?.name ?? ""}
        placeholder={rule ? undefined : "New rule name"}
        aria-label="Rule name"
        className={INPUT}
      />

      <select
        name="matchOn"
        defaultValue={rule?.matchOn ?? "MERCHANT"}
        aria-label="Match on"
        className={INPUT}
      >
        {RULE_MATCH_ON.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <select
        name="operator"
        defaultValue={rule?.operator ?? "CONTAINS"}
        onChange={(event) => setOperator(event.currentTarget.value)}
        aria-label="Operator"
        className={INPUT}
      >
        {RULE_OPERATORS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>

      <div>
        <input
          name="pattern"
          required
          maxLength={120}
          defaultValue={rule?.pattern ?? ""}
          placeholder="Pattern"
          aria-label="Pattern"
          onChange={(event) => setPattern(event.currentTarget.value)}
          className={`${INPUT} ${error ? "border-negative" : ""}`}
        />
        {error && <p className="mt-0.5 text-[11px] text-negative">{error}</p>}
      </div>

      <select
        name="categoryId"
        required
        defaultValue={rule?.categoryId ?? categories[0]?.id ?? ""}
        aria-label="Category"
        className={INPUT}
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <input
        name="priority"
        type="number"
        min={1}
        max={999}
        defaultValue={rule?.priority ?? 100}
        aria-label="Priority"
        className={`${INPUT} tabular`}
      />

      {rule ? (
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={rule.enabled}
          aria-label="Enabled"
          className="mt-1 h-3.5 w-3.5 accent-current"
        />
      ) : (
        <span aria-hidden />
      )}

      <span className="tabular pt-1 text-[11px] text-muted">{rule ? rule.hits : ""}</span>
      <span className="pt-1 text-[11px] text-muted">{rule ? rule.origin.toLowerCase() : ""}</span>

      <div className="flex items-start justify-end gap-1">
        <SubmitButton disabled={error !== null} label={rule ? "Save" : "Add"} />
        {rule && (
          <button
            type="submit"
            formAction={deleteRule}
            name="ruleId"
            value={rule.id}
            className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-muted hover:text-negative"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Settings-card summary plus the rules popup. Rules are the only table here that
 * gets edited in bulk, so the card stays a summary and everything lands in the modal.
 */
export function RulesEditor({ rules, categories }: { rules: RuleRowData[]; categories: RuleCategory[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const enabled = rules.filter((r) => r.enabled).length;
  const learned = rules.filter((r) => r.origin === "LEARNED").length;
  const hits = rules.reduce((sum, r) => sum + r.hits, 0);

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const query = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!query) return rules;
    return rules.filter((r) =>
      `${r.name} ${r.pattern} ${categoryName.get(r.categoryId) ?? ""}`.toLowerCase().includes(query),
    );
  }, [rules, query, categoryName]);

  return (
    <>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Enabled</dt>
          <dd className="tabular">
            {enabled} / {rules.length}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Learned</dt>
          <dd className="tabular">{learned}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Hits applied</dt>
          <dd className="tabular">{hits}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded border border-border px-2 py-1.5 text-sm hover:bg-surface-muted"
      >
        Manage rules ({enabled} enabled / {rules.length} total)
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title="Rules"
        subtitle={`${visible.length} of ${rules.length} shown · lowest priority number wins`}
        footer={
          <p className="text-xs text-muted">
            Merchant memory answers before any rule, so a learned merchant overrides all of them. A
            disabled rule never fires. Only REGEX patterns are compiled: they are validated before
            saving.
          </p>
        }
      >
        <div className="mb-2 flex items-center gap-2">
          <input
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            placeholder="Filter by name, pattern or category"
            aria-label="Filter rules"
            className="w-72 rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter("")}
              className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-muted"
            >
              Clear
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[72rem]">
            <div className={`${GRID} pb-1 text-[11px] uppercase tracking-wide text-muted`}>
              <span>Name</span>
              <span>Match on</span>
              <span>Operator</span>
              <span>Pattern</span>
              <span>Category</span>
              <span>Priority</span>
              <span>On</span>
              <span>Hits</span>
              <span>Origin</span>
              <span className="text-right">Actions</span>
            </div>

            <RuleRowForm key={`new-${rules.length}`} rule={null} categories={categories} />

            {visible.map((rule) => (
              <RuleRowForm key={rule.id} rule={rule} categories={categories} />
            ))}

            {visible.length === 0 && (
              <p className="border-t border-border px-2 py-2 text-xs text-muted">
                {rules.length === 0
                  ? "No rules yet. Add the first one above."
                  : `No rule matches “${filter}”.`}
              </p>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
