import { Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { ACCOUNT_TYPE_LABELS, CATEGORY_KINDS } from "@/lib/types";

// Reads the database on every request; nothing here is safe to prerender.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [categories, rules, merchants, instruments] = await Promise.all([
    prisma.category.count(),
    prisma.rule.count(),
    prisma.merchantMap.count(),
    prisma.instrument.count(),
  ]);

  const aiProvider = process.env.AI_PROVIDER ?? "none";
  const priceFetch = process.env.PRICE_FETCH ?? "disabled";

  return (
    <>
      <PageHeader title="Settings" subtitle="Categories, rules, AI and data" />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Categories">
          <p className="tabular text-2xl font-semibold">{categories}</p>
          <p className="mt-1 text-xs text-muted">
            Kinds: {CATEGORY_KINDS.join(", ")}. Management follows in phase 1.
          </p>
        </Card>
        <Card title="Rules">
          <p className="tabular text-2xl font-semibold">{rules}</p>
          <p className="mt-1 text-xs text-muted">Keyword and regex rules, ordered by priority.</p>
        </Card>
        <Card title="Merchant memory">
          <p className="tabular text-2xl font-semibold">{merchants}</p>
          <p className="mt-1 text-xs text-muted">
            Every confirmed category remembers the merchant, so one click per shop.
          </p>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Automatic categorisation">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">AI provider</dt>
              <dd className="font-mono text-xs">{aiProvider}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Price refresh</dt>
              <dd className="font-mono text-xs">{priceFetch}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            Set <code className="font-mono">AI_PROVIDER</code> and{" "}
            <code className="font-mono">AI_API_KEY</code> in{" "}
            <code className="font-mono">.env.local</code>. Without a provider the app works fully
            on rules and manual corrections. IBANs and account names never go to an AI provider.
          </p>
        </Card>

        <Card title="Data">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Instruments</dt>
              <dd className="tabular">{instruments}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Database</dt>
              <dd className="font-mono text-xs">SQLite · dev.db</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            A backup is a copy of the database file. Export and cleanup arrive in phase 7.
          </p>
        </Card>
      </div>

      <div className="mt-3">
        <Card title="Account types">
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {Object.entries(ACCOUNT_TYPE_LABELS).map(([key, label]) => (
              <li key={key} className="flex justify-between gap-3">
                <span className="text-muted">{label}</span>
                <span className="font-mono text-xs">{key}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
