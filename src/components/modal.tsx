"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * One large modal, used by the import review and the rules editor. Native
 * <dialog> would fight React for the pointer events, so this is a plain overlay
 * with the accessibility bits that matter: role, aria-modal, Escape to close and
 * focus moved into the panel on open.
 */
export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = "lg",
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "lg" | "xl";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:p-6">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[94vh] w-full flex-col rounded-lg border border-border bg-surface shadow-xl outline-none ${
          size === "xl" ? "max-w-[100rem]" : "max-w-5xl"
        }`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold tracking-tight">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted hover:bg-surface-muted"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>

        {footer && (
          <footer className="shrink-0 border-t border-border bg-surface px-4 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}
