// Money lives as integer cents everywhere. Never a float, never a string, in
// the database or in a calculation. These helpers are the only place that
// touches the text form.

export const BASE_CURRENCY = "EUR";
export const LOCALE = "nl-NL";

const eur = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: BASE_CURRENCY,
  minimumFractionDigits: 2,
});

/** "€ 1.234,56" — sign always shown for negatives, never for positives. */
export function formatCents(cents: number): string {
  return eur.format(cents / 100);
}

/** For deltas: always carries an explicit + or −. */
export function formatCentsSigned(cents: number): string {
  const s = eur.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${s}` : `+${s}`;
}

/** Plain number without currency symbol, for inputs and CSV. */
export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Parses a statement amount to cents. Three sources, three conventions:
 * ASN "1234.56", ICS "1.234,56", PayPal "1,234.56" or "1234.56".
 *
 * Rule: with both separators present the right-most one is the decimal
 * separator. A lone comma is a decimal comma. A lone dot is decimal when 1-2
 * digits follow it, and a thousands separator when it groups 3 digits
 * ("1.234"). Anything still ambiguous returns null: a silent factor-100 error
 * in a financial app is worse than a failed import.
 */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.replace(/[\s\u00a0€$]/g, "").trim();
  if (cleaned === "" || !/^-?[\d.,]+$/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  let body = negative ? cleaned.slice(1) : cleaned;
  if (body === "") return null;

  const commas = (body.match(/,/g) ?? []).length;
  const dots = (body.match(/\./g) ?? []).length;

  let decimalChar: "," | "." | null = null;
  if (commas > 0 && dots > 0) {
    decimalChar = body.lastIndexOf(",") > body.lastIndexOf(".") ? "," : ".";
  } else if (commas === 1) {
    decimalChar = ",";
  } else if (commas > 1) {
    return null; // no source emits "1,234,567" with a comma decimal
  } else if (dots === 1) {
    const at = body.lastIndexOf(".");
    if (body.length - at - 1 === 3) {
      // "1.234" is a thousands group only when the head is 1-3 digits.
      if (at > 3) return null;
      decimalChar = null;
    } else {
      decimalChar = ".";
    }
  } else if (dots > 1) {
    decimalChar = null; // "1.234.567": dots are thousands separators
  }

  let decimalPart = "";
  if (decimalChar) {
    const at = body.lastIndexOf(decimalChar);
    decimalPart = body.slice(at + 1);
    body = body.slice(0, at);
  }

  const wholeDigits = body.replace(/[.,]/g, "");
  if (!/^\d*$/.test(wholeDigits) || !/^\d*$/.test(decimalPart)) return null;
  if (wholeDigits === "" && decimalPart === "") return null;

  // Round half-up on the third decimal, which is what a statement does.
  const cents = Number(wholeDigits || "0") * 100 + Number((decimalPart + "00").slice(0, 2));
  const third = Number((decimalPart + "000").charAt(2));
  const total = cents + (third >= 5 ? 1 : 0);

  return negative ? -total : total;
}

/** Converts an amount in a foreign currency to EUR cents using a x1e6 rate. */
export function toBaseCents(cents: number, fxRateMicro: number | null): number {
  if (!fxRateMicro) return cents;
  return Math.round((cents * fxRateMicro) / 1_000_000);
}

/** Quantities for trades: integer micro-units (x1e6) keep 6 decimals exact. */
export function microToQuantity(micro: number): string {
  return (micro / 1_000_000).toFixed(6).replace(/\.?0+$/, "");
}

export function quantityToMicro(input: string): number | null {
  const n = Number(input.replace(",", ".").replace(/\s/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1_000_000);
}
