"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import { CATEGORY_KINDS } from "@/lib/types";
import { deleteCategory, updateCategory } from "./actions";

/** The category fields the list and both dialogs need; Prisma's row carries more. */
export type CategoryRow = {
  id: string;
  name: string;
  kind: string;
  color: string | null;
  parentId: string | null;
  isSystem: boolean;
};

export type CategoryImpactRow = {
  transactions: number;
  rules: number;
  children: number;
  merchantMemory: number;
};

const EMPTY_IMPACT: CategoryImpactRow = { transactions: 0, rules: 0, children: 0, merchantMemory: 0 };

const FIELD =
  "w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent";

const LABEL = "mb-1 block text-[11px] uppercase tracking-wide text-muted";

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What the delete dialog lists: only the parts that actually apply. */
function impactLines(impact: CategoryImpactRow): string[] {
  const lines: string[] = [];
  if (impact.transactions > 0) {
    lines.push(
      `${plural(impact.transactions, "transaction")} keep their amount but lose this category — they go back to being uncategorised`,
    );
  }
  if (impact.rules > 0) {
    lines.push(`${plural(impact.rules, "rule")} that point at this category will be deleted`);
  }
  if (impact.children > 0) {
    lines.push(
      `${plural(impact.children, "subcategory", "subcategories")} will move up to the top level, keeping their own transactions`,
    );
  }
  if (impact.merchantMemory > 0) {
    lines.push(
      `${plural(impact.merchantMemory, "remembered merchant")} will forget this category`,
    );
  }
  return lines;
}

/**
 * Same fields as the create form plus a parent picker, so editing exposes every
 * option creation does. Closes itself when the action comes back without an error.
 */
function EditForm({
  category,
  categories,
  onClose,
}: {
  category: CategoryRow;
  categories: CategoryRow[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateCategory, {});
  const [kind, setKind] = useState(category.kind);
  const [parentId, setParentId] = useState(category.parentId ?? "");
  const submitted = useRef(false);

  useEffect(() => {
    if (pending) {
      submitted.current = true;
      return;
    }
    if (!submitted.current) return;
    submitted.current = false;
    if (!state.error) onClose();
  }, [pending, state, onClose]);

  // A parent must be top level and of the same kind, which the action enforces too.
  const parents = categories.filter((c) => !c.parentId && c.id !== category.id && c.kind === kind);
  const chosenParent = parents.some((c) => c.id === parentId) ? parentId : "";

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={category.id} />

      <label className="text-sm sm:col-span-2">
        <span className={LABEL}>Name</span>
        <input name="name" required maxLength={60} defaultValue={category.name} className={FIELD} />
      </label>

      <label className="text-sm">
        <span className={LABEL}>Kind</span>
        <select
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.currentTarget.value)}
          className={FIELD}
        >
          {CATEGORY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className={LABEL}>Colour</span>
        <input
          name="color"
          defaultValue={category.color ?? ""}
          placeholder="#22c55e"
          className={`${FIELD} font-mono text-xs`}
        />
      </label>

      <label className="text-sm sm:col-span-2">
        <span className={LABEL}>Parent</span>
        <select
          name="parentId"
          value={chosenParent}
          onChange={(event) => setParentId(event.currentTarget.value)}
          className={FIELD}
        >
          <option value="">None</option>
          {parents.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {state.error && (
        <p role="alert" className="text-xs text-negative sm:col-span-2">
          {state.error}
        </p>
      )}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

/** Impact first, then an explicit acknowledgement before the red button unlocks. */
function DeletePanel({
  category,
  impact,
  onClose,
}: {
  category: CategoryRow;
  impact: CategoryImpactRow;
  onClose: () => void;
}) {
  const [ack, setAck] = useState(false);
  const lines = impactLines(impact);

  async function handleDelete(formData: FormData) {
    await deleteCategory(formData);
    onClose();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">This cannot be undone.</p>
      {lines.length === 0 ? (
        <p className="text-sm text-muted">Nothing else uses this category.</p>
      ) : (
        <ul className="space-y-1 text-sm text-muted">
          {lines.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="text-negative">
                ·
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      <form action={handleDelete} className="space-y-3">
        <input type="hidden" name="categoryId" value={category.id} />
        <input type="hidden" name="confirm" value="delete" />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ack}
            onChange={(event) => setAck(event.currentTarget.checked)}
            className="h-3.5 w-3.5"
          />
          I understand
        </label>
        <button
          type="submit"
          disabled={!ack}
          className="rounded bg-negative px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Delete category
        </button>
      </form>
    </div>
  );
}

/**
 * Category list with per-row edit and a delete that states its impact first. The
 * row buttons sit at low opacity so thirteen rows stay scannable, and they come
 * back on hover or as soon as anything in the row takes keyboard focus.
 */
export function CategoriesEditor({
  categories,
  impact,
}: {
  categories: CategoryRow[];
  impact: Record<string, CategoryImpactRow>;
}) {
  const [dialog, setDialog] = useState<
    { mode: "edit"; category: CategoryRow } | { mode: "delete"; category: CategoryRow } | null
  >(null);

  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const close = () => setDialog(null);
  const closeButton = (
    <button
      type="button"
      onClick={close}
      className="rounded border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-muted"
    >
      Cancel
    </button>
  );

  return (
    <>
      <ul className="max-h-72 divide-y divide-border overflow-y-auto text-[13px]">
        {categories.map((c) => {
          const used = impact[c.id]?.transactions ?? 0;
          return (
            <li key={c.id} className="group flex items-center justify-between gap-2 py-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
                  style={{ background: c.color ?? "transparent" }}
                />
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-[11px] text-muted">
                  {c.kind.toLowerCase()}
                  {used ? ` · ${used}` : ""}
                </span>
                {c.parentId && (
                  <span className="shrink-0 truncate text-[11px] text-muted">
                    ↳ {nameById.get(c.parentId) ?? "?"}
                  </span>
                )}
                {c.isSystem && (
                  <span
                    title="Transfers are classified into this built-in category. Deleting it would turn every transfer back into income."
                    className="shrink-0 cursor-help rounded border border-border px-1 text-[10px] uppercase tracking-wide text-muted"
                  >
                    built-in
                  </span>
                )}
              </span>

              <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => setDialog({ mode: "edit", category: c })}
                  className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-muted hover:text-foreground"
                >
                  Edit
                </button>
                {!c.isSystem && (
                  <button
                    type="button"
                    onClick={() => setDialog({ mode: "delete", category: c })}
                    className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-muted hover:text-negative"
                  >
                    Delete
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {dialog !== null && (
        <Modal
          open
          onClose={close}
          title={dialog.mode === "edit" ? "Edit category" : `Delete ${dialog.category.name}?`}
          subtitle={dialog.mode === "edit" ? dialog.category.kind.toLowerCase() : undefined}
          footer={closeButton}
        >
          {dialog.mode === "edit" ? (
            <EditForm category={dialog.category} categories={categories} onClose={close} />
          ) : (
            <DeletePanel
              category={dialog.category}
              impact={impact[dialog.category.id] ?? EMPTY_IMPACT}
              onClose={close}
            />
          )}
        </Modal>
      )}
    </>
  );
}
