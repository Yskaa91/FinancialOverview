import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listAccounts } from "@/lib/queries/accounts";

// Reads the database on every request; nothing here is safe to prerender.
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const accounts = await listAccounts();

  return (
    <>
      <PageHeader
        title="Importeren"
        subtitle="ASN (CSV of CAMT.053), PayPal (CSV), ICS (CSV)"
      />

      {accounts.length === 0 ? (
        <EmptyState title="Eerst een rekening">
          Voeg een rekening toe op{" "}
          <Link href="/accounts" className="underline">
            Rekeningen
          </Link>{" "}
          en importeer daarna het afschrift.
        </EmptyState>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Stap 1 — bestand kiezen">
            <p className="text-sm text-muted">
              Kies de rekening en het bestand. De parserkeuze volgt uit de rekening
              ({accounts.map((a) => a.institution).filter((v, i, arr) => arr.indexOf(v) === i).join(", ")}).
            </p>
          </Card>
          <Card title="Stap 2 — controle">
            <p className="text-sm text-muted">
              Vóór het opslaan zie je aantal regels, periode, totaalbedrag en hoeveel regels
              duplicaten zijn. Er wordt nog niets geschreven.
            </p>
          </Card>
          <Card title="Stap 3 — verwerken">
            <p className="text-sm text-muted">
              Opslaan in één transactie, daarna categoriseren via merchant-geheugen en regels.
              Het resultaat toont wat is toegevoegd en wat nog beoordeeld moet worden.
            </p>
          </Card>
          <Card title="Nog niet gebouwd">
            <p className="text-sm text-muted">
              De wizard zelf is fase 2 (ASN) en 3 (PayPal, ICS). Zie{" "}
              <code className="font-mono text-xs">docs/ARCHITECTURE.md</code> §5 en{" "}
              <code className="font-mono text-xs">docs/IMPORT-FORMATS.md</code> voor de
              formaatdetails per bron.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
