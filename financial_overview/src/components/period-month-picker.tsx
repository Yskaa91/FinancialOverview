"use client";

import { useRouter } from "next/navigation";

/**
 * The period label *is* the picker: one control, not a label plus a jump box.
 * Changing it navigates straight away, so there is no second confirm button.
 * Used for both the shown period (`field="p"`) and the compared one (`"c"`).
 */
export function MonthPicker({
  value,
  field,
  other,
  label,
}: {
  value: string;
  field: "p" | "c";
  /** The other query parameter, carried over untouched. */
  other: string;
  label: string;
}) {
  const router = useRouter();
  const otherField = field === "p" ? "c" : "p";

  return (
    <input
      type="month"
      value={value}
      aria-label={label}
      onChange={(event) => {
        const next = event.target.value;
        if (next) router.push(`/?${field}=${next}&${otherField}=${encodeURIComponent(other)}`);
      }}
      className="min-w-[8.5rem] rounded-md border border-border bg-surface px-2 py-1 text-center text-sm font-medium text-foreground hover:bg-surface-muted"
    />
  );
}
