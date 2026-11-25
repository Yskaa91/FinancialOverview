import { Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { ACCOUNT_TYPE_LABELS, CATEGORY_KINDS } from "@/lib/types";
import { AI_MAX_BATCHES, AI_MODEL, isAiConfigured } from "@/lib/categorize/ai";
import { requireSession } from "@/lib/auth";
import { loadCategoryImpact } from "@/lib/queries/impact";
import { CategoriesEditor } from "./categories-editor";
import { RulesEditor } from "./rules-editor";
import { createCategory, forgetMerchant } from "./actions";

// Reads the database on every request; nothing here is safe to prerender.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSession();
  const [categories, rules, merchants, instruments, impact] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    prisma.rule.findMany({ orderBy: [{ priority: "asc" }, { name: "asc" }] }),
    prisma.merchantMap.findMany({ orderBy: { hits: "desc" }, take: 20 }),
    prisma.instrument.count(),
    loadCategoryImpact(),
  ]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const aiProvider = process.env.AI_PROVIDER ?? "none";
  const aiKeyPresent = Boolean(process.env.AI_API_KEY);
  const aiOn = isAiConfigured();
  const priceFetch = process.env.PRICE_FETCH ?? "disabled";

  return (
    <>
      <PageHeader title="Settings" subtitle="Categories, rules, merchant memory and data" />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Categories">
          <form action={createCategory} className="mb-3 grid gap-2 sm:grid-cols-2">
            <input
              name="name"
              required
              maxLength={60}
              placeholder="New category"
              aria-label="New category"
              className="rounded border border-border bg-background px-2 py-1.5 text-sm sm:col-span-2"
            />
            <select
              name="kind"
              defaultValue="EXPENSE"
              aria-label="Category kind"
              className="rounded border border-border bg-background px-2 py-1.5 text-sm"
            >
              {CATEGORY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              name="color"
              placeholder="Colour: auto"
              aria-label="Colour in hex, leave empty for an automatic one"
              className="rounded border border-border bg-background px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded border border-border px-2 py-1.5 text-sm hover:bg-surface-muted sm:col-span-2"
            >
              Add category
            </button>
          </form>

          <CategoriesEditor
            categories={categories.map((c) => ({
              id: c.id,
              name: c.name,
              kind: c.kind,
              color: c.color,
              parentId: c.parentId,
              isSystem: c.isSystem,
            }))}
            impact={Object.fromEntries(impact)}
          />
        </Card>

        <Card title="Rules">
          <RulesEditor
            rules={rules}
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          />
        </Card>

        <Card title="Merchant memory">
          <p className="mb-2 text-xs text-muted">
            Learned from confirmed categories: one click per shop, then the same merchant is
            automatic. Forget a merchant to let it ask again.
          </p>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto text-[13px]">
            {merchants.length === 0 && <li className="py-2 text-muted">Nothing learned yet.</li>}
            {merchants.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate">{m.merchantKey}</span>
                  <span className="block text-[11px] text-muted">
                    {categoryById.get(m.categoryId)?.name ?? "?"} · {m.source.toLowerCase()} ·{" "}
                    {m.hits} hits
                  </span>
                </span>
                <form action={forgetMerchant}>
                  <input type="hidden" name="merchantKey" value={m.merchantKey} />
                  <button type="submit" className="text-[11px] text-muted underline">
                    forget
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Automatic categorisation">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">AI suggestions</dt>
              <dd className={aiOn ? "text-positive" : "text-muted"}>{aiOn ? "on" : "off"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Provider</dt>
              <dd className="font-mono text-xs">{aiProvider}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Model</dt>
              <dd className="font-mono text-xs">{AI_MODEL}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">API key</dt>
              <dd className="font-mono text-xs">{aiKeyPresent ? "set" : "missing"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Max calls per run</dt>
              <dd className="tabular">{AI_MAX_BATCHES}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Price refresh</dt>
              <dd className="font-mono text-xs">{priceFetch}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Instruments</dt>
              <dd className="tabular">{instruments}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            {aiOn
              ? "Uncategorised rows get a suggestion after an import and from the review queue's AI button. A suggestion is never applied without a click; confirming one teaches the merchant, which then costs no further calls."
              : "Add AI_PROVIDER=mistral and AI_API_KEY to .env.local to get suggestions. Without it the app works fully on rules and manual corrections."}{" "}
            Only merchant text and amounts are sent; never IBANs, account names or balances.
          </p>
        </Card>

        <Card title="Account types">
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {Object.entries(ACCOUNT_TYPE_LABELS).map(([key, label]) => (
              <li key={key} className="flex justify-between gap-3">
                <span className="text-muted">{label}</span>
                <span className="font-mono text-xs">{key}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Database is SQLite in <code className="font-mono">dev.db</code>; a backup is a file copy.
            Rebuild the demo with <code className="font-mono">npm run db:seed</code>.
          </p>
        </Card>
      </div>
    </>
  );
}
