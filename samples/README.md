# Sample statements

Two ASN statements sized for clicking through the whole import + categorisation
flow by hand. Everything below was measured against the seeded demo database, not
guessed.

| File | Rows | What it is for |
| --- | --- | --- |
| `asn-demo-november-2026.csv` | 12 | The interesting one: rules, merchant memory, one recurring merchant, three one-offs |
| `asn-demo-december-2026.csv` | 8 | Shows a learned rule paying off on the next import |

Start from the demo state so the numbers match:

```bash
npm run db:seed
npm run dev
```

Then open <http://127.0.0.1:3000/import>, pick the **ASN Checking** account, leave
the source on *Detect automatically*, and upload the November file.

## November: what the dialog shows before you click anything

12 rows → **5 matched by rules**, **4 to decide** (9 decisions in total, not 12).

| Merchant | Rows | Handled by |
| --- | --- | --- |
| ACME BV | 1 | rule `Payroll` (matches the **counterparty**, not the merchant) → Salary |
| Woningstichting Noord | 1 | rule `Rent` → Rent |
| Vattenfall | 1 | rule `Energy` → Utilities |
| Albert Heijn | 1 | merchant memory → Groceries, no API call needed |
| Spotify | 1 | merchant memory → Subscriptions |
| LIDL | 3 | nothing yet — `seen 5x in 12 months`, recurring, so it can earn a rule |
| Bloemist Roos | 2 | nothing yet — one-off, so it never earns a rule |
| Geldopname automaat | 1 | nothing — merchant derived from the description |
| Kaaswinkel De Boer | 1 | nothing — one-off |

The two merchants that answer from **merchant memory** are the important ones:
they cost no API call and the category is fixed, because you confirmed that shop
before.

## Then click "Suggest with AI"

One API call, four answers. A real run returned:

```
LIDL                -> Groceries    [would propose a rule]
BLOEMIST ROOS       -> Groceries
GELDOPNAME AUTOMAAT -> Transport
KAASWINKEL DE BOER  -> Groceries
```

The exact categories vary between models and runs; what does not vary is the
**rule gating**: only LIDL is marked recurring, so only LIDL appears under
*Proposed rules*. The florist has two visits in the year, gets a category for
those two rows, and gets **no rule**. That is the whole point — rules stay a
short, meaningful list.

Approve what you agree with (or hit *Approve all suggestions*), then
**Save 12 transactions**. Afterwards:

- `/transactions` shows the rows with `RULE` / `AI` / `MANUAL` as the source;
- `/settings` → *Manage rules* lists the new `LIDL` rule with origin `LEARNED`;
- nothing was written before you pressed Save, so *Cancel* leaves the database
  untouched.

## December: the payoff

Upload `asn-demo-december-2026.csv` after the November import:

- **before** you accept a LIDL rule: LIDL lands in *Needs a category* again;
- **after** it: LIDL appears under *Matched by rules* with rule `LIDL`, so the
  only thing left to decide is `ACTION`.

## Things worth knowing while testing

- **Recurrence counts 12 months of history**, including rows already imported and
  the rows in the current file. A merchant that keeps appearing does eventually
  become recurring — that is intended, not a bug.
- **Re-uploading the same file** is refused at upload (`fileHash`). Overlapping
  periods are fine; individual duplicates are counted and shown in the dialog.
- **A wrong AI answer costs one click.** Suggestions arrive pre-selected but
  unapproved; the model answering `0` (unsure) leaves a select empty on purpose.
- **No key? No problem.** With `AI_PROVIDER=none` the dialog still does rules,
  merchant memory and manual picks; the AI button just is not rendered.

## Not what you want?

The parser-level fixtures live in `tests/fixtures/` (`asn-*.csv`, `paypal-nl.csv`,
`ics.csv`). They are minimal assertion files — PayPal and ICS live there if you
want to exercise those parsers through the same dialog.
