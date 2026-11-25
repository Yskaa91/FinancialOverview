import { prisma } from "@/lib/db";
import { fetchIndexSeries } from "@/lib/property/cbs";
import { hasMunicipalities } from "@/lib/property/countries";
import { fetchCountryIndexSeries } from "@/lib/property/eurostat";
import {
  estimateValueCents,
  indexAtPeriod,
  latestPoint,
  quarterCode,
  type IndexPoint,
} from "@/lib/property/valuation";
import { priceFetchEnabled, } from "@/lib/portfolio/quotes";

/** Value refresh cadence: the CBS index moves once a quarter, a day is plenty. */
export const PROPERTY_TTL_MS = 24 * 60 * 60 * 1000;

export type PropertyRow = {
  id: string;
  label: string | null;
  address: string;
  country: string;
  regionCode: string;
  regionName: string;
  purchasePriceCents: number;
  purchasedAt: Date;
  estimatedValueCents: number | null;
  indexAtPurchaseMicro: number | null;
  indexLatestMicro: number | null;
  indexPeriod: string | null;
  valueFetchedAt: Date | null;
};

export async function listProperties(): Promise<PropertyRow[]> {
  return prisma.property.findMany({ orderBy: [{ purchasedAt: "asc" }, { createdAt: "asc" }] });
}

/** Purchase total and estimated total, for the cards and the dashboard. */
export function totalsOf(properties: PropertyRow[]) {
  const purchaseCents = properties.reduce((sum, p) => sum + p.purchasePriceCents, 0);
  const valueCents = properties.reduce(
    (sum, p) => sum + (p.estimatedValueCents ?? p.purchasePriceCents),
    0,
  );
  return { purchaseCents, valueCents, gainCents: valueCents - purchaseCents };
}

/**
 * Index series for one home: the CBS municipality index inside the Netherlands,
 * Eurostat's national index everywhere else. Cached by the caller, once per run.
 */
async function seriesFor(property: PropertyRow): Promise<IndexPoint[]> {
  return hasMunicipalities(property.country)
    ? fetchIndexSeries(property.regionCode)
    : fetchCountryIndexSeries(property.country);
}

/**
 * Refreshes the estimate of every home whose figures are older than a day. The
 * index series is fetched once per region or country per run, and nothing is
 * looked up when `PRICE_FETCH` is off (the same switch that governs share prices).
 */
export async function refreshPropertyValues(options: { force?: boolean } = {}): Promise<number> {
  if (!priceFetchEnabled()) return 0;

  const properties = await listProperties();
  if (properties.length === 0) return 0;

  const now = Date.now();
  const seriesCache = new Map<string, IndexPoint[]>();
  let updated = 0;

  for (const property of properties) {
    const fresh =
      property.valueFetchedAt !== null &&
      now - property.valueFetchedAt.getTime() < PROPERTY_TTL_MS &&
      property.estimatedValueCents !== null;
    if (!options.force && fresh) continue;

    const cacheKey = hasMunicipalities(property.country)
      ? `CBS:${property.regionCode}`
      : `EUROSTAT:${property.country}`;
    let series = seriesCache.get(cacheKey);
    if (!series) {
      series = await seriesFor(property);
      seriesCache.set(cacheKey, series);
    }
    if (series.length === 0) continue;

    const atPurchase = indexAtPeriod(series, quarterCode(property.purchasedAt));
    const latest = latestPoint(series);
    if (!latest) continue;

    await prisma.property.update({
      where: { id: property.id },
      data: {
        indexAtPurchaseMicro: atPurchase?.indexMicro ?? null,
        indexLatestMicro: latest.indexMicro,
        indexPeriod: latest.period,
        estimatedValueCents: estimateValueCents(
          property.purchasePriceCents,
          atPurchase?.indexMicro ?? null,
          latest.indexMicro,
        ),
        valueFetchedAt: new Date(),
      },
    });
    updated += 1;
  }
  return updated;
}

/** What the homes add to net worth: the estimate, or the price until one exists. */
export async function propertyTotalCents(): Promise<number> {
  const properties = await prisma.property.findMany({
    select: { purchasePriceCents: true, estimatedValueCents: true },
  });
  return properties.reduce(
    (sum, property) => sum + (property.estimatedValueCents ?? property.purchasePriceCents),
    0,
  );
}
