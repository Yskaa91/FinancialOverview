// Pairing the two statements that describe the same money. The bank knows that
// €93,79 left for PayPal; PayPal knows it went to Servicecenter Windhorn. Neither
// is wrong, and neither is complete — so both rows are kept and linked.
//
// Pure on purpose: no database, no clock. Callers pass rows and the window they
// want matched, which is what makes the pairing testable against real statements.

export const TRANSFER_LINK_KINDS = ["FUNDING", "SETTLEMENT", "OWN_ACCOUNT"] as const;
export type TransferLinkKind = (typeof TRANSFER_LINK_KINDS)[number];

export const TRANSFER_LINK_METHODS = ["AUTO", "MANUAL"] as const;
export type TransferLinkMethod = (typeof TRANSFER_LINK_METHODS)[number];

/** Days between the two bookings. PayPal pulls 1–4 days later, a card settles 1–7. */
export const PAIRING_WINDOW_DAYS = 7;

export type PairingRow = {
  id: string;
  accountId: string;
  /** yyyy-mm-dd: pairing must not depend on a timezone. */
  bookedAt: string;
  amountCents: number;
  currency: string;
  /** description + counterparty + counterparty IBAN, already concatenated. */
  text: string;
  /** True when the row itself names the shop. */
  hasMerchant: boolean;
};

export type PairingAccount = {
  id: string;
  /** Lowercase tokens that identify this account inside another statement. */
  hints: string[];
  /** A credit card is collected once a month. */
  settlesMonthly: boolean;
  /**
   * True when this account's statements name the shop (PayPal, a card). The leg on
   * this side is the one worth counting: it is the leg that says what the money was
   * for.
   */
  carriesDetail: boolean;
};

export type TransferPair = {
  /** Both rows of the pair, in no particular order. */
  transactionIds: [string, string];
  kind: TransferLinkKind;
  dayGap: number;
  /**
   * The leg that keeps counting as income or expense. Null means neither counts:
   * the movement is internal on both sides (a card bill, a bank-to-bank transfer).
   */
  carrierId: string | null;
};

/**
 * Hints are few and specific: what the *other* statement prints when it pays this
 * account. The institution's name, the account's own name, its IBAN.
 */
export function accountHints(account: {
  name: string;
  iban: string | null;
  institution: string;
}): string[] {
  const hints = new Set<string>();
  const name = account.name.trim();
  if (name.length >= 4) hints.add(name);
  if (account.iban) hints.add(account.iban);

  switch (account.institution) {
    case "PAYPAL":
      hints.add("paypal");
      break;
    case "ICS":
      // The bank prints "INT CARD SERVICES" as the payee, and the card company's
      // own wording ("creditcard ICS-klantnummer") in the narrative.
      hints.add("card services");
      hints.add("creditcard");
      hints.add("ics");
      break;
    default:
      // ASN and OTHER: the IBAN, or the account's name if the user typed one the
      // bank actually prints. "ASN" itself appears in unrelated narratives.
      break;
  }

  return [...hints];
}

/**
 * Does this text name that account? Words match whole words, so "ICS" never matches
 * "statistics"; numbers match on digits, so a spaced IBAN is the same hint.
 */
export function textNamesHint(text: string, hint: string): boolean {
  const normalisedHint = normalise(hint);
  if (normalisedHint === "") return false;

  const haystack = normalise(text);
  if (haystack === "") return false;

  const hintDigits = normalisedHint.replace(/\D/g, "");
  // An account, card or customer number: compare digits, because every bank spaces
  // and masks them differently.
  if (hintDigits.length >= 6) {
    return haystack.replace(/\D/g, "").includes(hintDigits);
  }

  return ` ${haystack} `.includes(` ${normalisedHint} `);
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dayGap(a: string, b: string): number {
  const left = Date.parse(`${a}T00:00:00.000Z`);
  const right = Date.parse(`${b}T00:00:00.000Z`);
  return Math.abs(Math.round((left - right) / 86_400_000));
}

/**
 * One pairing pass. Deterministic: the same rows always produce the same pairs,
 * which keeps a re-run from inventing new links. Each row is used at most once, so
 * two identical amounts on one day cannot both pair with one counterpart.
 */
export function pairTransfers({
  rows,
  accounts,
  maxDays = PAIRING_WINDOW_DAYS,
}: {
  rows: PairingRow[];
  accounts: PairingAccount[];
  maxDays?: number;
}): TransferPair[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const candidates: { pair: TransferPair; cost: number }[] = [];

  // Only rows of equal magnitude can be the same money, so bucket by it first: a
  // year of statements is thousands of rows, and comparing all of them with all of
  // them is the difference between instant and unusable.
  const buckets = new Map<string, PairingRow[]>();
  for (const row of rows) {
    const key = `${row.currency}|${Math.abs(row.amountCents)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;

    for (let i = 0; i < bucket.length; i += 1) {
      const a = bucket[i];
      const accountA = accountById.get(a.accountId);
      if (!accountA) continue;

      for (let j = i + 1; j < bucket.length; j += 1) {
        const b = bucket[j];
        if (a.accountId === b.accountId) continue;
        const accountB = accountById.get(b.accountId);
        if (!accountB) continue;

        // One statement must name the other account, or this is two strangers who
        // happen to have spent the same amount.
        const namesB = accountB.hints.some((hint) => textNamesHint(a.text, hint));
        const namesA = accountA.hints.some((hint) => textNamesHint(b.text, hint));
        if (!namesA && !namesB) continue;

        const gap = dayGap(a.bookedAt, b.bookedAt);
        if (gap > maxDays) continue;

        const described = describePair(a, b, accountA, accountB);
        if (!described) continue;

        const cost =
          gap * 10 +
          (described.kind === expectedKind(accountA, accountB) ? 0 : 25) +
          (accountA.carriesDetail || accountB.carriesDetail ? 0 : 5) +
          // Money the bank received from the wallet means the wallet paid it out:
          // two credits would be the same money appearing twice.
          (a.amountCents > 0 && b.amountCents > 0 ? 40 : 0);

        candidates.push({
          pair: {
            // Sorted, so the tuple does not depend on the order the rows arrived in.
            transactionIds: [a.id, b.id].sort() as [string, string],
            kind: described.kind,
            dayGap: gap,
            carrierId: described.carrierId,
          },
          cost,
        });
      }
    }
  }

  candidates.sort(
    (x, y) =>
      x.cost - y.cost ||
      x.pair.transactionIds[0].localeCompare(y.pair.transactionIds[0]) ||
      x.pair.transactionIds[1].localeCompare(y.pair.transactionIds[1]),
  );

  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const { pair } of candidates) {
    const [left, right] = pair.transactionIds;
    if (used.has(left) || used.has(right)) continue;
    used.add(left);
    used.add(right);
    pairs.push(pair);
  }
  return pairs;
}

/**
 * What the pair means, given both rows and both accounts. Also used when a human
 * links two rows by hand, so the automatic and the manual path cannot disagree.
 *
 * Opposite signs are a settlement (the card bill paid, a withdrawal landing); two
 * negatives are funding (the bank pays for a wallet's spend); two positives are a
 * refund moving back, internal either way.
 */
export function describePair(
  a: PairingRow,
  b: PairingRow,
  accountA: PairingAccount,
  accountB: PairingAccount,
): { kind: TransferLinkKind; carrierId: string | null } | null {
  const sameSign = a.amountCents > 0 === b.amountCents > 0;

  if (!sameSign) return { kind: "SETTLEMENT", carrierId: null };
  if (a.amountCents > 0) return { kind: "SETTLEMENT", carrierId: null };

  // Two cards do not fund each other, and a card does not fund a purchase out of
  // another card: that is a coincidence, not a pair.
  if (accountA.settlesMonthly && accountB.settlesMonthly) return null;
  return { kind: "FUNDING", carrierId: carrierOf(a, b, accountA, accountB) };
}

/**
 * What this pair of accounts normally does: a card is collected once a month
 * (opposite signs), a wallet is topped up per purchase (two debits). A pair that
 * behaves differently still links, but only when nothing better is available.
 */
function expectedKind(accountA: PairingAccount, accountB: PairingAccount): TransferLinkKind {
  if (accountA.settlesMonthly || accountB.settlesMonthly) return "SETTLEMENT";
  return accountA.carriesDetail || accountB.carriesDetail ? "FUNDING" : "SETTLEMENT";
}

/**
 * A settlement is internal on both sides, so nothing is counted. Funding keeps the
 * leg that says what the money bought — the wallet's own row whenever it names a
 * shop, because that is the whole point of holding both statements.
 */
function carrierOf(
  a: PairingRow,
  b: PairingRow,
  accountA: PairingAccount,
  accountB: PairingAccount,
): string {
  // A bank row that happens to carry a merchant ("PayPal Europe") must not win over
  // the wallet row that carries the shop, so the statement that names shops gets the
  // first refusal.
  const detailRow = accountA.carriesDetail ? a : accountB.carriesDetail ? b : null;
  const otherRow = detailRow === a ? b : a;
  if (detailRow?.hasMerchant) return detailRow.id;
  // The wallet row says nothing ("User Initiated Withdrawal"): the bank's own row is
  // then the only row that can keep the expense visible.
  if (otherRow.hasMerchant) return otherRow.id;
  return detailRow?.id ?? a.id;
}
