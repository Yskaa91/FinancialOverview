# Sample statements

Three ASN statements sized for clicking through the whole import flow by hand:
categorisation, account transfers, and an overlapping re-export. Every number
below was measured against the seeded demo database.

| File | Rows | What it is for |
| --- | --- | --- |
| `asn-demo-november-2026.csv` | 14 | Rules, merchant memory, two account transfers, one recurring merchant, three one-offs |
| `asn-demo-november-2026-overlap.csv` | 4 | Re-export of the same month: exact and likely duplicates |
| `asn-demo-december-2026.csv` | 8 | Shows a learned rule paying off on the next import |

Start from the demo state so the numbers match:

```bash
npm run db:seed
npm run dev
```

Then open <http://127.0.0.1:3000/import>, pick **ASN Checking**, leave the source on
*Detect automatically*, and upload the November file.

## November: what the dialog shows before you click anything

14 rows → **7 matched**, **4 to decide**, and **2 likely duplicates**.

| Merchant | Rows | Handled by |
| --- | --- | --- |
| ACME BV | 1 | rule `Payroll` (matches the **counterparty**, not the merchant) → Salary |
| Woningstichting Noord | 1 | rule `Rent` → Rent |
| Vattenfall | 1 | rule `Energy` → Utilities |
| Albert Heijn | 1 | merchant memory → Groceries |
| Spotify | 1 | merchant memory → Subscriptions |
| ASN Savings | 1 | **account transfer** → Transfers |
| Storting van PayPal | 1 | **account transfer** → Transfers |
| LIDL | 3 | `seen 5x in 12 months`, recurring, so it can earn a rule |
| Bloemist Roos | 2 | one-off, never earns a rule |
| Geldopname automaat | 1 | nothing — merchant derived from the description |
| Kaaswinkel De Boer | 1 | one-off |

### The two transfers

`SEPA Overboeking naar ASN Savings` and `STORTING VAN PAYPAL` are recognised as
movements between your own accounts and land in the single **Transfers**
category. No balancing, no pairing: that category is `kind TRANSFER`, so the
dashboard and the income/expense overview skip those rows entirely. The
counterpart comes in with the other account's statement and is classified the
same way, so nothing is counted twice.

Detection is deliberately conservative: an own IBAN in the counterparty field, an
own IBAN or another account's name plus a movement word in the description, or a
card settlement line (`GEINCASSEERD`, `VORIG SALDO`). Nothing is guessed from the
word "overboeking" alone, because a wrong transfer hides real spending from
every report.

### The two likely duplicates

The seeded demo database already contains a November rent and salary payment, so
this file's rent (−€ 1.425,00 on 01-11) and salary (+€ 3.850,00 on 25-11) show up
as **LIKELY** duplicates: same amount, within three days of a stored row. That is
exactly the overlapping-statement case the warning is for. Switch them to **Skip**
if you do not want them twice; the dialog's *Skip all* does both in one click.

## Then click "Suggest with AI"

One API call, four answers. A real run returned:

```
LIDL                -> Groceries    [would propose a rule]
BLOEMIST ROOS       -> Groceries
GELDOPNAME AUTOMAAT -> Transport
KAASWINKEL DE BOER  -> Groceries
```

Categories vary between models and runs; the **rule gating** does not. Only LIDL
is recurring, so only LIDL appears under *Proposed rules*. The florist has two
visits, gets a category for those two rows, and gets **no rule**.

Then **Save**. Afterwards:

- `/transactions` shows `RULE` / `AI` / `MANUAL` as the source per row;
- `/settings` → *Manage rules* lists the new `LIDL` rule with origin `LEARNED`;
- nothing was written before you pressed Save, so *Cancel* leaves the database
  untouched.

## The overlap file: exact duplicates

Upload `asn-demo-november-2026-overlap.csv` **after** importing November. It
contains three rows you already imported plus one look-alike that is a genuinely
different purchase two days later:

```
EXACT   11-11  -35,00  Bloemist Roos   -> Skip    (already imported)
EXACT   12-11  -31,82  LIDL            -> Skip    (already imported)
EXACT   19-11  -18,95  LIDL            -> Skip    (already imported)
LIKELY  13-11  -31,82  LIDL            -> Import  (looks the same, but it is not)
```

Saving with the defaults writes one row and skips three, so
`Save 1 transaction` is what the footer says. *Import all* would write all four —
an approved exact duplicate gets a suffixed hash, because `dedupeHash` is unique
by design.

## December: the payoff

Upload `asn-demo-december-2026.csv` after the November import:

- **before** you accept a LIDL rule: LIDL lands in *Needs a category* again;
- **after** it: LIDL appears under *Matched by rules* with rule `LIDL`, so the
  only thing left to decide is `ACTION`.

## Things worth knowing while testing

- **Recurrence counts 12 months of history**, including rows already imported and
  the rows in the current file. A merchant that keeps appearing does eventually
  become recurring — intended, not drift.
- **Duplicates have two verdicts.** `EXACT` means the row's hash is already
  stored: skipped unless you say otherwise. `LIKELY` means same amount within
  three days (or same merchant within fourteen): imported unless you say
  otherwise, because it is often a second genuine purchase.
- **Approve all / Deny all** exist on both the duplicate block and the
  categorisation block. *Deny all suggestions* only clears rows the AI proposed;
  rule-matched and transfer rows keep their category.
- **Re-uploading the same file** is refused at upload (`fileHash`) — the duplicate
  window is for *overlapping* exports, which is a different thing.
- **No key? No problem.** With `AI_PROVIDER=none` the dialog still does rules,
  merchant memory, transfers and manual picks; the AI button is not rendered.

## Not what you want?

The parser-level fixtures live in `tests/fixtures/` (`asn-*.csv`, `paypal-nl.csv`,
`ics.csv`). They are minimal assertion files — PayPal and ICS live there if you
want to exercise those parsers through the same dialog.
