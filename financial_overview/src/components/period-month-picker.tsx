"use client";

import { useRouter } from "next/navigation";

/**
 * The period label *is* the picker: one control, not a label plus a jump box.
 * Changing it navigates straight away, so there is no second confirm button.
 */
export function MonthPicker({ value, compare }: { value: string; compare: string }) {
  const router = useRouter();

  return (
    <input
      type="month"
      value={value}
      aria-label="Jump to month"
      onChange={(event) => {
        const next = event.target.value;
        if (next) router.push(`/?p=${next}&c=${compare}`);
      }}
      className="min-w-[8.5rem] rounded-md border border-border bg-surface px-2 py-1 text-center text-sm font-medium text-foreground hover:bg-surface-muted"
    />
  );
}
