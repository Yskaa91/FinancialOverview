// House-price index for the rest of Europe, from Eurostat's quarterly House Price
// Index (prc_hpi_q, 2015 = 100, all dwellings, national). Keyless, and only the
// two-letter country code leaves the machine.
//
// JSON-stat: one flat `value` map keyed by the row number, and separate
// dimensions. Everything except `time` is pinned to a single category, so the row
// number divided by the time stride is the quarter.

import { toIndexMicro, type IndexPoint } from "./valuation";

const BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hpi_q";
const TIMEOUT_MS = 8000;
const FIRST_PERIOD = "2015-Q1";

type JsonStat = {
  id?: string[];
  size?: number[];
  value?: Record<string, number>;
  dimension?: {
    time?: { category?: { index?: Record<string, number> } };
  };
};

/** Eurostat "2024-Q2" to the CBS-style "2024KW02" the rest of the code compares. */
export function eurostatPeriod(period: string): string | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(period.trim());
  return match ? `${match[1]}KW0${match[2]}` : null;
}

/** Quarterly points out of a JSON-stat payload, oldest first. */
export function parseEurostatSeries(payload: unknown): IndexPoint[] {
  const data = payload as JsonStat | null;
  const ids = data?.id;
  const sizes = data?.size;
  const values = data?.value;
  const timeIndex = data?.dimension?.time?.category?.index;
  if (!ids || !sizes || !values || !timeIndex) return [];

  const timePosition = ids.indexOf("time");
  if (timePosition === -1) return [];
  const timeSize = sizes[timePosition] ?? 0;
  if (timeSize === 0) return [];

  // Row number -> quarter label, through the ordinal table Eurostat ships.
  const labelByOrdinal = new Map<number, string>();
  for (const [label, ordinal] of Object.entries(timeIndex)) {
    labelByOrdinal.set(ordinal, label);
  }

  const stride = sizes.slice(timePosition + 1).reduce((product, size) => product * size, 1);
  const points: IndexPoint[] = [];
  for (const [key, value] of Object.entries(values)) {
    const row = Number(key);
    if (!Number.isInteger(row) || typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      continue;
    }
    const label = labelByOrdinal.get(Math.floor(row / stride) % timeSize);
    const period = label ? eurostatPeriod(label) : null;
    if (!period) continue;
    points.push({ period, indexMicro: toIndexMicro(value) });
  }
  return points.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

export async function fetchCountryIndexSeries(countryCode: string): Promise<IndexPoint[]> {
  const geo = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(geo)) return [];

  const url =
    `${BASE}?format=JSON&lang=EN&purchase=TOTAL&unit=I15_Q` +
    `&geo=${encodeURIComponent(geo)}&sinceTimePeriod=${FIRST_PERIOD}`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FinancialOverview)" },
    });
    if (!response.ok) return [];
    return parseEurostatSeries(await response.json());
  } catch {
    // A dead statistics service must never break a page.
    return [];
  }
}
