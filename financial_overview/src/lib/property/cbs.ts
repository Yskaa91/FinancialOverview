// Regional house-price index from CBS StatLine, keyless. Only a municipality name
// or code leaves the machine — never the address, never a price.
//
// Table 85792NED: "Bestaande koopwoningen; verkoopprijzen, prijsindex 2020=100,
// regio". Quarterly, per gemeente ("GM0363"), province ("PV27") and the country
// ("NL01"). The API answers ascending and ignores $orderby, so sorting is ours.

import { isQuarterCode, toIndexMicro, type IndexPoint } from "./valuation";

const TABLE = "85792NED";
const BASE = `https://opendata.cbs.nl/ODataApi/odata/${TABLE}`;
const TIMEOUT_MS = 8000;
const FIRST_PERIOD = "2015KW01";

const headers = { "User-Agent": "Mozilla/5.0 (compatible; FinancialOverview)" };

async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      headers,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // A dead statistics service must never break a page.
    return null;
  }
}

/** Municipality, province or country name to its CBS region, exact match first. */
export async function resolveRegion(name: string): Promise<{ code: string; name: string } | null> {
  const wanted = name.trim();
  if (wanted.length < 2) return null;
  const escaped = wanted.replace(/'/g, "''");

  const exact = await getJson(
    `${BASE}/RegioS?$filter=Title eq '${encodeURIComponent(escaped)}'&$format=json`,
  );
  const exactHit = firstRegion(exact);
  if (exactHit) return exactHit;

  const partial = await getJson(
    `${BASE}/RegioS?$filter=substringof('${encodeURIComponent(escaped)}',Title)&$format=json`,
  );
  return firstRegion(partial);
}

function firstRegion(payload: unknown): { code: string; name: string } | null {
  const values = (payload as { value?: { Key?: unknown; Title?: unknown }[] })?.value;
  if (!Array.isArray(values)) return null;
  for (const row of values) {
    if (typeof row?.Key === "string" && typeof row?.Title === "string") {
      return { code: row.Key, name: row.Title };
    }
  }
  return null;
}

/** Quarterly index points for one region, oldest first. */
export async function fetchIndexSeries(regionCode: string): Promise<IndexPoint[]> {
  const code = regionCode.replace(/'/g, "''");
  const payload = await getJson(
    `${BASE}/TypedDataSet?$filter=RegioS eq '${encodeURIComponent(code)}' and Perioden ge '${FIRST_PERIOD}'&$format=json`,
  );
  const rows = (payload as { value?: Record<string, unknown>[] })?.value;
  if (!Array.isArray(rows)) return [];

  const points: IndexPoint[] = [];
  for (const row of rows) {
    const period = row?.Perioden;
    const index = row?.PrijsindexVerkoopprijzen_1;
    if (typeof period !== "string" || !isQuarterCode(period)) continue;
    if (typeof index !== "number" || !Number.isFinite(index) || index <= 0) continue;
    points.push({ period, indexMicro: toIndexMicro(index) });
  }
  return points.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}
