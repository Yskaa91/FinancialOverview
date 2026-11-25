"use client";

import { useCallback } from "react";
import { setCategory } from "./actions";

type Category = { id: string; name: string; kind: string };

/**
 * Inline category editing: picking a category saves it immediately, which is the
 * whole review loop. The submit button stays for keyboard and no-JS use, and for
 * "apply to the same merchant" (the bulk action the learning map makes safe).
 */
export function CategoryPicker({
  transactionId,
  categoryId,
  categories,
  sameMerchantOpen,
}: {
  transactionId: string;
  categoryId: string | null;
  categories: Category[];
  sameMerchantOpen: number;
}) {
  const submit = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    event.currentTarget.form?.requestSubmit();
  }, []);

  const grouped = {
    EXPENSE: categories.filter((c) => c.kind === "EXPENSE"),
    INCOME: categories.filter((c) => c.kind === "INCOME"),
    TRANSFER: categories.filter((c) => c.kind === "TRANSFER"),
  };

  return (
    <form action={setCategory} className="flex items-center gap-1.5">
      <input type="hidden" name="transactionId" value={transactionId} />
      <select
        name="categoryId"
        defaultValue={categoryId ?? ""}
        onChange={submit}
        aria-label="Category"
        className="max-w-[11rem] rounded border border-border bg-background px-1.5 py-1 text-xs"
      >
        <option value="" disabled>
          Choose…
        </option>
        {(["EXPENSE", "INCOME", "TRANSFER"] as const).map((kind) =>
          grouped[kind].length > 0 ? (
            <optgroup key={kind} label={kind.toLowerCase()}>
              {grouped[kind].map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </select>
      <button
        type="submit"
        className="rounded border border-border px-1.5 py-1 text-[11px] text-muted hover:bg-surface-muted"
      >
        save
      </button>
      {sameMerchantOpen > 1 && (
        <button
          type="submit"
          name="scope"
          value="merchant"
          className="rounded border border-border px-1.5 py-1 text-[11px] text-muted hover:bg-surface-muted"
          title="Also categorise the other rows of this merchant"
        >
          +{sameMerchantOpen - 1} same
        </button>
      )}
    </form>
  );
}
