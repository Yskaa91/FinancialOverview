"use client";

import { useActionState, useCallback, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Modal } from "@/components/modal";
import { centsToDecimalString, formatCents } from "@/lib/money";
import type { AccountImpact } from "@/lib/queries/impact";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  INSTITUTIONS,
  type AccountType,
  type Institution,
} from "@/lib/types";
import { archiveAccount, deleteAccount, updateAccount, type FormState } from "./actions";

/** The slice of an account row these controls need; the page passes the whole row. */
export type EditableAccount = {
  id: string;
  name: string;
  type: AccountType;
  institution: Institution;
  iban: string | null;
  archived: boolean;
  openingBalanceCents: number;
  balanceCents: number;
};

const initial: FormState = {};

const INPUT = "w-full rounded-md border border-border bg-background px-3 py-2";
const FIELD_LABEL = "mb-1 block text-muted";
const ACTION =
  "rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40";
const CANCEL =
  "rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-muted";

/** "1 transaction" / "3 transactions" — the counts are read out, so they read well. */
function count(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? "" : "s"}`;
}

/**
 * What deleting this account costs, in the order of severity: the transaction
 * cascade first, then the smaller tables, then the balance that leaves the
 * net-worth figures. Zero counts are never mentioned.
 */
function impactLines(account: EditableAccount, impact: AccountImpact | null): string[] {
  const lines: string[] = [];
  if (!impact) return lines;

  if (impact.transactions > 0) {
    lines.push(`${count(impact.transactions, "transaction")} will be deleted`);
  }
  if (impact.statements > 0) {
    lines.push(`${count(impact.statements, "statement")} will be deleted`);
  }
  if (impact.trades > 0 && impact.snapshots > 0) {
    lines.push(
      `${impact.trades} trades and ${impact.snapshots} price snapshots will be deleted`,
    );
  } else if (impact.trades > 0) {
    lines.push(`${count(impact.trades, "trade")} will be deleted`);
  } else if (impact.snapshots > 0) {
    lines.push(`${count(impact.snapshots, "price snapshot")} will be deleted`);
  }
  if (impact.rules > 0) {
    lines.push(`${count(impact.rules, "rule")} scoped to this account will be deleted`);
  }
  if (account.balanceCents !== 0) {
    lines.push(
      `The account's balance of ${formatCents(account.balanceCents)} disappears from net worth`,
    );
  }
  return lines;
}

function impactIsEmpty(impact: AccountImpact | null): boolean {
  if (!impact) return true;
  return (
    impact.transactions === 0 &&
    impact.statements === 0 &&
    impact.trades === 0 &&
    impact.snapshots === 0 &&
    impact.rules === 0
  );
}

/** The create form's fields, prefilled, behind a modal. */
function EditAccountDialog({
  account,
  onClose,
}: {
  account: EditableAccount;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(updateAccount, initial);
  const [attempted, setAttempted] = useState(false);
  const formId = useId();

  // The action returns {} on success and only errors carry a message, so a
  // result object that is no longer the initial one and has no error means the
  // save landed. `attempted` keeps the untouched dialog from closing itself.
  const saved = attempted && !pending && !state.error && state !== initial;

  useEffect(() => {
    if (saved) onClose();
  }, [saved, onClose]);

  return (
    <Modal
      open
      title="Edit account"
      subtitle="Everything the account was created with stays editable"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className={CANCEL}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={pending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
          {state.error && <p className="text-sm text-negative">{state.error}</p>}
        </div>
      }
    >
      <form
        id={formId}
        action={action}
        onSubmit={() => setAttempted(true)}
        className="grid gap-3 sm:grid-cols-2"
      >
        <input type="hidden" name="id" value={account.id} />

        <label className="text-sm">
          <span className={FIELD_LABEL}>Name</span>
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={account.name}
            className={INPUT}
          />
        </label>

        <label className="text-sm">
          <span className={FIELD_LABEL}>Type</span>
          <select name="type" defaultValue={account.type} className={INPUT}>
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {ACCOUNT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className={FIELD_LABEL}>Institution</span>
          <select name="institution" defaultValue={account.institution} className={INPUT}>
            {INSTITUTIONS.map((inst) => (
              <option key={inst} value={inst}>
                {inst}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className={FIELD_LABEL}>IBAN or card number (optional)</span>
          <input
            name="iban"
            maxLength={34}
            placeholder="NL12ASNB0123456789"
            defaultValue={account.iban ?? ""}
            className={INPUT}
          />
        </label>

        <label className="text-sm">
          <span className={FIELD_LABEL}>Opening balance (optional)</span>
          <input
            name="openingBalance"
            inputMode="decimal"
            placeholder="0,00"
            defaultValue={centsToDecimalString(account.openingBalanceCents)}
            className={`tabular ${INPUT}`}
          />
        </label>
      </form>
    </Modal>
  );
}

function ConfirmDeleteButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-md border border-negative px-3 py-2 text-sm font-medium text-negative hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "Deleting…" : "Delete permanently"}
    </button>
  );
}

/**
 * Hard delete, gated by the impact it has. Nothing here submits on Enter from
 * the edit form: this is its own form, and the button stays disabled until the
 * checkbox is ticked.
 */
function DeleteAccountDialog({
  account,
  impact,
  onClose,
}: {
  account: EditableAccount;
  impact: AccountImpact | null;
  onClose: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const checkboxId = useId();
  const lines = impactLines(account, impact);

  return (
    <Modal
      open
      title={`Delete ${account.name}?`}
      subtitle="This cannot be undone."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {account.archived
              ? "Archive keeps the data and hides the account."
              : "Archiving hides the account and keeps every transaction."}
          </p>
          <button type="button" onClick={onClose} className={CANCEL}>
            Cancel
          </button>
        </div>
      }
    >
      <div className="max-w-prose space-y-3 text-sm">
        {impactIsEmpty(impact) && (
          <p className="text-muted">
            This account has no data attached; nothing else is affected.
          </p>
        )}

        {lines.length > 0 && (
          <ul className="space-y-1">
            {lines.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="text-muted">
                  –
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}

        <form action={deleteAccount} className="space-y-3 border-t border-border pt-3">
          <input type="hidden" name="id" value={account.id} />
          <input type="hidden" name="confirm" value="delete" />

          <label htmlFor={checkboxId} className="flex items-start gap-2 text-sm">
            <input
              id={checkboxId}
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.currentTarget.checked)}
              className="mt-0.5"
            />
            <span>I understand this permanently deletes the data above.</span>
          </label>

          <div>
            <ConfirmDeleteButton disabled={!acknowledged} />
          </div>
        </form>
      </div>
    </Modal>
  );
}

/**
 * The action row on an account card. Edit and Delete open a modal next to the
 * card; Archive/Restore is a plain form post, so it needs no state of its own.
 */
export function AccountActions({
  account,
  impact,
}: {
  account: EditableAccount;
  impact: AccountImpact | null;
}) {
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const close = useCallback(() => setDialog(null), []);

  return (
    <>
      <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-border pt-2">
        <button type="button" onClick={() => setDialog("edit")} className={ACTION}>
          Edit
        </button>

        <form action={archiveAccount}>
          <input type="hidden" name="id" value={account.id} />
          <input type="hidden" name="archived" value={account.archived ? "false" : "true"} />
          <button type="submit" className={ACTION}>
            {account.archived ? "Restore" : "Archive"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setDialog("delete")}
          className={`${ACTION} border-negative text-negative`}
        >
          Delete
        </button>
      </div>

      {dialog === "edit" && <EditAccountDialog account={account} onClose={close} />}
      {dialog === "delete" && (
        <DeleteAccountDialog account={account} impact={impact} onClose={close} />
      )}
    </>
  );
}
