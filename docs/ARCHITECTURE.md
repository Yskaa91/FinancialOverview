# FinancialOverview — Architecture

Personal wealth tracker: bank/PayPal/credit-card statement import, automatic
categorisation, ETF portfolio tracking, account balances, and a dashboard.
Single user, single machine, local data.

Non-goals: multi-user accounts, remote hosting, bank API connections (PSD2),
invoicing, tax filing, budgeting envelopes.

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | One process serves pages and mutations; Server Actions remove the need for a REST layer |
| UI | Tailwind CSS + shadcn/ui + lucide icons | Copy-in components, no runtime UI dependency to maintain |
| Charts | Recharts | Declarative SVG charts, no canvas, no extra bundle step |
| DB | SQLite via Prisma 7 + `@prisma/adapter-better-sqlite3` | Single file, trivially backed up by copying it. Prisma 7 talks SQLite through a driver adapter |
| Validation | Zod | Parsers and forms are trust boundaries; parse, don't hope |
| Tests | Vitest | Parser and FIFO tests are the only tests that matter here |
| Forms/actions | Server Actions + `revalidatePath` | Fewer files than route handlers |

No ORM abstraction layer above Prisma, no state library, no API routes except
the CSV export stream. React Server Components read via Prisma directly;
mutations are Server Actions in `actions.ts` files next to their route.

## 2. Runtime

```
npm run dev          # http://localhost:3000
npm run build && npm start
npm test             # vitest
npx prisma migrate dev
npx prisma studio    # inspect data
```

Bound to `127.0.0.1` only. The database file is `dev.db` in the repository root
(`DATABASE_URL="file:./dev.db"`, git-ignored). `.env.local` holds `DATABASE_URL`
and optional AI keys; `.env.example` is the committed template.

Prisma 7 specifics: the connection URL lives in `prisma.config.ts` (which loads
`.env` through `dotenv/config`) and in the driver adapter in `src/lib/db.ts` —
never in `schema.prisma`. `prisma.config.ts` also pins the migrations path.
`cacheComponents` and `partialPrefetching` are off in `next.config.ts`; with them
on, every database read has to sit inside a Suspense boundary, which is a phase 6
concern.

## 3. Repository layout

```
src/
  app/
    layout.tsx                 # shell: sidebar/tabs, header, import button
    page.tsx                   # / dashboard
    transactions/page.tsx      # income & expenses
    transactions/actions.ts
    accounts/page.tsx          # accounts overview
    accounts/[id]/page.tsx     # account detail, holdings + trade log for brokers
    accounts/actions.ts
    import/page.tsx            # 3-step import wizard (not a tab)
    import/actions.ts
    settings/page.tsx          # categories, rules, AI, data, danger zone
    settings/actions.ts
    api/export/route.ts        # CSV export of filtered transactions
  components/
    ui/                        # shadcn primitives
    charts/                    # NetWorthChart, CashflowBars, CategoryPie
    transactions/              # table, filter bar, inline category picker
    accounts/                  # account card, balance editor, holdings table
  lib/
    db.ts                      # PrismaClient singleton
    money.ts                   # cents helpers, Intl formatting, fx
    dates.ts                   # period ranges, DD-MM-YYYY parsing
    queries/
      dashboard.ts             # net worth, deltas, cashflow, top categories
      transactions.ts          # filtered/paged lists, aggregates
      accounts.ts              # balances, history series
    import/
      index.ts                 # detect → parse → normalize → dedupe → commit
      asn.ts  paypal.ts  ics.ts
      normalize.ts             # merchant extraction, description cleanup, hash
    categorize/
      rules.ts                 # priority chain, rule application, rule learning
      ai.ts                    # batched LLM suggestions, provider adapters
    portfolio/
      trades.ts                # FIFO positions, realized/unrealized P/L (pure)
      prices.ts                # manual prices + optional Stooq fetch, TTL cache
  db/schema.prisma
tests/
  import/*.test.ts
  fixtures/*.csv              # anonymised real exports
docs/
  ARCHITECTURE.md  IMPORT-FORMATS.md  TOOLING.md
```

## 4. Data model

All money is **integer cents**, EUR base. All quantities are **integer
micro-units** (×1 000 000). No floats anywhere near money.

```
Account        id, name, type(CHECKING|SAVINGS|BROKER|CREDIT_CARD),
               institution(ASN|PAYPAL|ICS|OTHER), iban?, currency,
               openingBalanceCents, archived, sortOrder, notes
Statement      id, accountId, source, filename, fileHash UNIQUE,
               importedAt, periodStart?, periodEnd?, rowCount, importedCount,
               skippedCount
Transaction    id, accountId, statementId?, bookedAt, amountCents,
               currency, fxRateMicro?, description, counterparty?,
               counterpartyIban?, merchant?, categoryId?,
               categorySource(MANUAL|RULE|AI|NONE), categoryConfidence?,
               reviewState(OK|SUGGESTED|UNCATEGORIZED),
               transferGroupId?, balanceAfterCents?, rawJson, dedupeHash UNIQUE
Category       id, name, kind(EXPENSE|INCOME|TRANSFER), parentId?,
               color?, icon?, sortOrder, isSystem
Rule           id, name, matchOn(DESCRIPTION|COUNTERPARTY|IBAN|MERCHANT),
               operator(CONTAINS|EQUALS|REGEX), pattern, accountId?,
               amountMinCents?, amountMaxCents?, categoryId, priority,
               origin(MANUAL|LEARNED), hits, enabled
MerchantMap    id, merchantKey UNIQUE, categoryId, source(RULE|AI|MANUAL),
               hits, updatedAt          -- the learning loop, per merchant
Instrument     id, symbol, isin?, name, kind(ETF|STOCK|BOND|CASH),
               currency, priceSymbol?  -- Stooq ticker when different from symbol
Trade          id, accountId, instrumentId, side(BUY|SELL), tradedAt,
               quantityMicro, priceCents, feeCents, currency, note?
               -- positions are derived; never stored
Price          id, instrumentId, fetchedAt, priceCents, source(MANUAL|STOOQ)
Snapshot       id, accountId, takenAt, balanceCents, source(IMPORT|MANUAL)
Setting        key PRIMARY KEY, valueJson
```

Key decisions:

- **Trades, not positions.** A position is always `fifo(accountId,
  instrumentId, trades)`. This makes "remove a holding" mean "record the sale",
  keeps cost basis honest, and needs no reconciliation after a bad edit.
- **Idempotent imports.** `Statement.fileHash` blocks the same file twice;
  `Transaction.dedupeHash` blocks overlapping statement ranges. Re-importing a
  period must never double income.
- **`rawJson` on every transaction.** The original row survives, so a parser
  fix can re-derive fields without asking the user to re-export.
- **Liability sign.** Credit-card accounts store negative balances. Net worth is
  a plain sum; assets vs liabilities split by `type` and sign.
- **Balance truth order.** Latest statement `balanceAfterCents` → opening
  balance plus transaction sum → manual `Snapshot`. Broker accounts use cash
  snapshot plus holdings value.

## 5. Import pipeline

```
upload(accountId, file)
  → detect source (explicit choice, else header sniffing)
  → parser → RawRow[]                       (source-specific: encodings, signs,
                                             preamble rows, multi-line fields)
  → normalize → NRow[]                      (date, cents, currency, description,
                                             counterparty, iban, merchant,
                                             balanceAfter, rawJson)
  → hash → dedupe against DB and inside the file
  → PREVIEW (counts, date range, sum, duplicates, first rows)   [step 2, no write]
  → COMMIT in one SQLite transaction: Statement + Transactions
  → categorise (rules + merchant map, then optional AI batch)
  → report: imported N, duplicates M, needs review K               [step 3]
```

Normalisation rules shared by all parsers (`lib/import/normalize.ts`). The exact
per-source details, with evidence, are in `docs/IMPORT-FORMATS.md`:

- Amounts: the three sources disagree. ASN writes dot decimals without a
  thousands separator; ICS writes comma decimals and flips the sign (a purchase
  is positive, a payment negative); PayPal localises the decimal separator and
  quotes thousands. One `parseAmountToCents` handles all of it and returns `null`
  rather than guessing, so **expense = negative** holds after the source's own
  convention is applied.
- Dates: ASN `dd-mm-jjjj` (not zero padded), ICS `dd-mm-yyyy` twice (transaction
  and posting date), PayPal `Date` + `Time` + `TimeZone` in three columns. Store
  UTC midnight; keep the PayPal time zone in `rawJson`.
- Description: collapse whitespace, strip card-terminal noise
  (`BEA,NR:...,BETAALPAS`), keep the original in `rawJson`.
- Merchant: uppercase first two description words after noise removal, or the
  counterparty name for bank transfers. Empty when unsure — a wrong merchant key
  poisons the learning map.
- Header handling: ASN CSV has **no header row**, ICS and PayPal do. Never index
  ASN by header name; always map ICS/PayPal by name and fail loudly when the
  header changed, because ICS publishes no spec at all.
- Card accounts: ICS has **no IBAN**. The account key is a masked card number
  (`****1234`), which is why `Account.iban` is nullable and also carries a card
  number for credit cards.
- Transfers: after commit, pair rows where `amount_a = -amount_b`, the two
  accounts differ, dates are ≤ 3 days apart and one counterparty matches the
  other account's name/iban. Pair both under one `transferGroupId`; kind
  `TRANSFER` is excluded from income and expense totals. This is what stops an
  ICS direct-debit settlement (`GEINCASSEERD VORIG SALDO`) and the matching bank
  debit from counting twice.

Parser status and the documented-vs-observed split per source live in
`docs/IMPORT-FORMATS.md`. ASN also offers CAMT.053 (ISO 20022 XML), which ASN
itself recommends; it is optional and only worth adding if the CSV becomes
unstable.

## 6. Categorisation

Resolution order when displaying or aggregating a transaction:

1. **Manual** — `categorySource = MANUAL` is final; nothing overwrites it.
2. **Merchant map** — exact `merchantKey` hit (source of all automatic wins).
3. **Rules** — ordered by `priority`, first match wins; can be scoped to one
   account and to an amount band.
4. **AI suggestion** — stored as `reviewState = SUGGESTED` with a confidence.
   It is shown but counts as uncategorised until confirmed. One confirmation
   writes `MerchantMap`, so the same merchant never costs a second call.
5. **Uncategorised** — visible as a badge count, drives the review mode.

Learning loop: every manual assignment on a transaction with a merchant key
upserts `MerchantMap` and offers "apply to all N similar" as one button
(bulk update of existing rows with the same key). Nothing is auto-applied
retroactively without that click.

AI layer (`lib/categorize/ai.ts`): one provider adapter interface
(`suggestCategory(batch): {id, categoryId, confidence}[]`), implemented for an
OpenAI-compatible endpoint and Mistral, chosen by `AI_PROVIDER`. Batches of 40
transactions, category list in the system prompt, strict JSON schema out,
validated with Zod and dropped on any parse failure. Cost guard: skip rows that
already have a merchant-map hit, cap batch size, log call count. The app is
fully functional with `AI_PROVIDER=none`.

## 7. Portfolio and valuation

- Buy: `Trade(side=BUY)`. Sell: `Trade(side=SELL)`. Edit and delete are allowed
  on recent trades; a delete is a hard delete only for rows with no later sell.
- `fifo()` returns per instrument: quantity, average cost, total cost, realized
  P/L (from the sell legs), and the open lots. Pure function, unit tested.
- Value = `quantity × latest price`. Price comes from the newest `Price` row;
  `lib/portfolio/prices.ts` refreshes from Stooq (free, no key) when the price
  is older than 12 hours and `PRICE_FETCH=enabled`, otherwise manual entry.
- Account balance for a broker = cash snapshot + sum of position values.
- Net worth history: bank and savings accounts derive a balance per day from
  transactions; broker and manual accounts use `Snapshot` rows, forward-filled.
  The dashboard draws the merged series.

## 8. Pages

**Dashboard `/`** — net worth now with 30-day delta and sparkline; assets vs
liabilities; this-month income, expense, net; net-worth chart (12 months);
spend by category (month, top 8); portfolio value by instrument; uncategorised
count; last import per account.

**Income & expenses `/transactions`** — filter bar (period presets + custom,
account, category, kind, free text, amount range); table with inline category
picker, merchant, account; bulk select → set category / mark transfer; review
mode showing only `SUGGESTED` + `UNCATEGORIZED`; monthly summary strip; bar
chart per month; pie per category; CSV export of the current filter.

**Accounts `/accounts`** — card per account: balance, type, 30-day delta,
sparkline, last import date; add/edit/archive; totals row. Broker card opens
`/accounts/[id]`: holdings table (instrument, quantity, avg cost, price, value,
unrealised P/L, share of account), trade log with add-buy/add-sell dialog,
realised P/L total, manual price entry, price refresh.

**Settings `/settings`** — categories CRUD (two-level), rules CRUD with a test
preview ("matches 14 existing transactions"), merchant map browser with
override, AI provider and key status (never echoes the key), base currency and
locale, backup (download `.db`) and CSV export, danger zone (delete statement /
all data, guarded by a typed confirmation).

**Import `/import`** (header button, not a tab) — the 3-step wizard above.

## 9. Conventions

- Money enters the system as `number` cents; `lib/money.ts` owns formatting
  (`Intl.NumberFormat('nl-NL', {currency:'EUR'})`), parsing and fx. All copy is
  English; the `nl-NL` locale is kept for amounts and dates only, because it
  matches the source statements.
- Every list query is server-side filtered and paginated (50/page); no client
  data hydration of the whole ledger.
- Dates: store UTC, render in `Europe/Amsterdam` (`dd-mm-yyyy`).
- Server Actions validate input with Zod before touching Prisma.
- Accessibility: interactive rows are keyboard reachable, category picker is a
  combobox with a labelled input, charts have a text summary alternative.

## 10. Privacy and safety

Financial data never leaves the machine except (a) optional AI calls, which send
description + amount + category list only, never IBANs or account names, and
(b) optional Stooq price lookups, which send only ticker symbols. Both are off
by default and shown as off in Settings.

The app has no authentication. It binds to `127.0.0.1`; exposing it on a LAN or
Tailscale requires adding auth first. Import commits run in a single
transaction; backups are a file copy of `prisma/dev.db`.

## 11. Tests

- `tests/import/*.test.ts` — one fixture per source plus the ugly cases: comma
  decimals, credit-card sign flip, PayPal preamble, duplicate rows inside one
  file, overlapping periods.
- `tests/portfolio/fifo.test.ts` — partial sells, sells spanning lots, oversell
  rejection, fees in cost basis.
- `tests/money.test.ts`, `tests/dates.test.ts` — parsing round trips.
- Manual smokes for each page; no component test suite.

## 12. Phases

| # | Deliverable |
|---|---|
| 0 | Skeleton: stack, schema, four pages with empty states, layout shell |
| 1 | Accounts CRUD, categories CRUD, settings, money/format helpers |
| 2 | ASN importer end to end + transactions table + dedupe |
| 3 | PayPal and ICS importers, transfer pairing |
| 4 | Rules engine, merchant learning, AI suggestions, review mode |
| 5 | Trades, FIFO, prices, broker account page |
| 6 | Dashboard aggregates and charts, balance history |
| 7 | Export, backup, polish |

Done: 0, 1, 2, 3, 4, 5, 6 (charts on the dashboard, net worth and cashflow
history). Not started: 7, plus the optional AI provider call and CAMT.053.

## 13. Known risks and shortcuts

- **ICS sign convention and card payments.** ICS makes purchases positive and
  payments negative, and a bank→card transfer must not count twice. Both are
  handled by one parser rule and the transfer pairing, and both have fixtures.
- **PayPal localised headers and amounts.** The CSV header follows the account
  language (EN/NL at minimum) and amounts are "localized". Build a column map by
  name, and verify the decimal separator against one real NL export before making
  the parser strict.
- **ICS publishes no format spec.** Column list, encoding and sign convention are
  observations from a real file. Version-gate on the header string and throw a
  typed error instead of importing garbage.
- **PayPal multi-currency.** Cross-currency rows carry a conversion column; the
  parser uses it when present and otherwise stores the original currency with a
  live-rate estimate flagged in `rawJson`.
- **`Int` cents.** Safe per row (€21M); aggregates are summed in JS `number`,
  safe to €90 trillion. Do not move to `BigInt` without measuring.
- **No price history.** Valuation uses the latest price only; the dashboard's
  portfolio history is therefore approximate until `Price` rows accumulate.
- **Parsers drift.** Export formats change without notice. Each parser throws a
  typed error with the offending header list, so the fix is one file and one
  fixture.
