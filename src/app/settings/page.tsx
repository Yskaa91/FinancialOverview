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
      <PageHeader title="Instellingen" subtitle="Categorieën, regels, AI en gegevens" />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Categorieën">
          <p className="tabular text-2xl font-semibold">{categories}</p>
          <p className="mt-1 text-xs text-muted">
            Soorten: {CATEGORY_KINDS.join(", ")}. Beheer volgt in fase 1.
          </p>
        </Card>
        <Card title="Regels">
          <p className="tabular text-2xl font-semibold">{rules}</p>
          <p className="mt-1 text-xs text-muted">Keyword- en regexregels, volgorde op prioriteit.</p>
        </Card>
        <Card title="Merchant-geheugen">
          <p className="tabular text-2xl font-semibold">{merchants}</p>
          <p className="mt-1 text-xs text-muted">
            Elke bevestigde categorie onthoudt de merchant, dus één klik per winkel.
          </p>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Automatisch categoriseren">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">AI-provider</dt>
              <dd className="font-mono text-xs">{aiProvider}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Koersen verversen</dt>
              <dd className="font-mono text-xs">{priceFetch}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            Zet <code className="font-mono">AI_PROVIDER</code> en{" "}
            <code className="font-mono">AI_API_KEY</code> in{" "}
            <code className="font-mono">.env.local</code>. Zonder provider werkt de app volledig
            op regels en handmatige correcties. Er gaan nooit IBAN&apos;s of rekeningnamen naar een
            AI-provider.
          </p>
        </Card>

        <Card title="Gegevens">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Instrumenten</dt>
              <dd className="tabular">{instruments}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Database</dt>
              <dd className="font-mono text-xs">SQLite · dev.db</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            Back-up is een kopie van het databasebestand. Exporteren en opschonen komen in fase 7.
          </p>
        </Card>
      </div>

      <div className="mt-3">
        <Card title="Rekeningtypes">
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
