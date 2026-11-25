"use client";

import { useActionState } from "react";
import { createAccount, type FormState } from "./actions";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, INSTITUTIONS } from "@/lib/types";

const initial: FormState = {};

export function AddAccountForm() {
  const [state, action, pending] = useActionState(createAccount, initial);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        <span className="mb-1 block text-muted">Naam</span>
        <input
          name="name"
          required
          maxLength={80}
          placeholder="ASN Betaalrekening"
          className="w-full rounded-md border border-border bg-background px-3 py-2"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-muted">Type</span>
        <select
          name="type"
          defaultValue="CHECKING"
          className="w-full rounded-md border border-border bg-background px-3 py-2"
        >
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {ACCOUNT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-muted">Instelling</span>
        <select
          name="institution"
          defaultValue="ASN"
          className="w-full rounded-md border border-border bg-background px-3 py-2"
        >
          {INSTITUTIONS.map((inst) => (
            <option key={inst} value={inst}>
              {inst}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-muted">IBAN of kaartnummer (optioneel)</span>
        <input
          name="iban"
          maxLength={34}
          placeholder="NL12ASNB0123456789"
          className="w-full rounded-md border border-border bg-background px-3 py-2"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-muted">Beginsaldo (optioneel)</span>
        <input
          name="openingBalance"
          inputMode="decimal"
          placeholder="0,00"
          className="tabular w-full rounded-md border border-border bg-background px-3 py-2"
        />
      </label>

      <div className="flex items-end gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Bezig…" : "Rekening toevoegen"}
        </button>
        {state.error && <p className="text-sm text-negative">{state.error}</p>}
      </div>
    </form>
  );
}
