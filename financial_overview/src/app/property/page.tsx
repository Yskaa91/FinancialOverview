import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { listProperties, refreshPropertyValues, totalsOf } from "@/lib/queries/property";
import { INDEX_SCALE_1E6 } from "@/lib/property/valuation";
import { requireSession } from "@/lib/auth";
import { addProperty, deleteProperty, refreshProperties } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "Fill in an address, a municipality and a purchase price.",
  price: "That purchase price is not a number.",
  date: "That purchase date is not a date.",
  "unknown-region": "CBS does not know that municipality. Check the spelling, or name the province.",
};

const index = (micro: number | null) =>
  micro === null ? "—" : (micro / INDEX_SCALE_1E6).toFixed(1);

/**
 * Homes, valued from the CBS regional price index. The estimate is approximate
 * by nature: it follows the average for the municipality, not this address.
 */
export default async function PropertyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  await requireSession();
  const sp = await searchParams;

  await refreshPropertyValues();
  const properties = await listProperties();
  const totals = totalsOf(properties);

  return (
    <>
      <PageHeader
        title="Real estate"
        subtitle="Homes, with an approximate value that follows the CBS price index for their region"
      />

      {sp.error && (
        <p role="alert" className="mb-3 rounded-lg border border-negative/40 bg-negative/5 px-3 py-2 text-sm">
          {ERRORS[sp.error] ?? sp.error}
        </p>
      )}

      {properties.length > 0 && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <Stat label="Estimated value" value={formatCents(totals.valueCents)} large />
          </Card>
          <Card>
            <Stat label="Paid" value={formatCents(totals.purchaseCents)} />
          </Card>
          <Card>
            <Stat
              label="Change since purchase"
              value={formatCentsSigned(totals.gainCents)}
              tone={totals.gainCents < 0 ? "negative" : "positive"}
            />
          </Card>
          <Card>
            <div className="text-[11px] uppercase tracking-wide text-muted">Refresh</div>
            <form action={refreshProperties} className="mt-2">
              <button
                type="submit"
                className="rounded border border-border px-2 py-1 text-xs text-muted hover:bg-surface-muted"
              >
                Re-read the index now
              </button>
            </form>
            <p className="mt-2 text-[11px] text-muted">
              Automatic once a day while this page opens.
            </p>
          </Card>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Add a home" className="lg:col-span-1">
          <form action={addProperty} className="grid gap-2">
            <label className="text-xs">
              <span className="mb-1 block text-muted">Address</span>
              <input
                name="address"
                required
                placeholder="Prinsengracht 263"
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted">Municipality</span>
              <input
                name="region"
                required
                placeholder="Amsterdam"
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              />
              <span className="mt-1 block text-[11px] text-muted">
                Only this name is sent to CBS, never the address.
              </span>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted">Bought for</span>
              <input
                name="purchasePrice"
                required
                inputMode="decimal"
                placeholder="425.000,00"
                className="tabular w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted">Bought on</span>
              <input
                type="date"
                name="purchasedAt"
                required
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted">Label</span>
              <input
                name="label"
                maxLength={60}
                placeholder="Home"
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="submit"
              className="mt-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
            >
              Add home
            </button>
          </form>
        </Card>

        <Card title="Your homes" className="min-w-0 lg:col-span-2">
          {properties.length === 0 ? (
            <EmptyState title="No homes yet">
              Add one on the left; its value then follows the price index for its
              municipality.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-2 font-medium">Address</th>
                    <th className="py-2 pr-2 font-medium">Region</th>
                    <th className="py-2 pr-2 font-medium">Bought</th>
                    <th className="py-2 pr-2 text-right font-medium">Paid</th>
                    <th className="py-2 pr-2 text-right font-medium">Now</th>
                    <th className="py-2 pr-2 text-right font-medium">Change</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {properties.map((property) => {
                    const value = property.estimatedValueCents ?? property.purchasePriceCents;
                    const gain = value - property.purchasePriceCents;
                    return (
                      <tr key={property.id} className="border-b border-border/60 last:border-0">
                        <td className="py-1.5 pr-2">
                          <span className="block max-w-[16rem] truncate" title={property.address}>
                            {property.address}
                          </span>
                          <span className="block text-[11px] text-muted">
                            {property.label ?? "Home"}
                            {property.indexPeriod ? ` · index ${property.indexPeriod}` : ""}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-xs text-muted">
                          {property.regionName}
                          <span className="block text-[10px]">
                            {index(property.indexAtPurchaseMicro)} → {index(property.indexLatestMicro)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-2 text-xs text-muted tabular">
                          {formatDay(property.purchasedAt)}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular">
                          {formatCents(property.purchasePriceCents)}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular">{formatCents(value)}</td>
                        <td
                          className={`py-1.5 pr-2 text-right tabular ${
                            gain < 0 ? "text-negative" : "text-positive"
                          }`}
                        >
                          {formatCentsSigned(gain)}
                        </td>
                        <td className="py-1.5">
                          <form action={deleteProperty}>
                            <input type="hidden" name="id" value={property.id} />
                            <button
                              type="submit"
                              className="text-[11px] text-muted underline hover:text-negative"
                              title="Remove this home"
                            >
                              delete
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
