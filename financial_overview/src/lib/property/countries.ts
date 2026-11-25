// European countries the app can value a home in. Eurostat's house price index
// covers all of these; the Netherlands additionally has municipalities, which is
// why it keeps the CBS source.

export type Country = { code: string; name: string };

export const COUNTRIES: Country[] = [
  { code: "NL", name: "Netherlands" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NO", name: "Norway" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "GB", name: "United Kingdom" },
];

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]));

export function findCountry(code: string): Country | null {
  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/**
 * The Netherlands is valued per municipality through CBS; every other country
 * uses Eurostat's national index, so no region has to be resolved.
 */
export function hasMunicipalities(code: string): boolean {
  return code.trim().toUpperCase() === "NL";
}
