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

## 2b. Deployment as a Home Assistant add-on

The repository is an add-on store: `repository.yaml` at the root, one add-on in
`financial_overview/`. The Supervisor clones the repo and builds the add-on with
**that folder as the Docker build context**, which is why the whole app lives
inside it — anything outside cannot be copied into an image.

```
add-on options (/data/options.json)
  → scripts/container-env.mjs   maps options to the env vars the app already reads
  → run.sh                      DATABASE_URL=file:/data/financial.db,
                                prisma migrate deploy (idempotent), then next start
  → next start                  0.0.0.0:3000, published to the host
```

- **Configuration has one code path.** The app reads `AI_PROVIDER`,
  `AI_API_KEY`, `AI_MODEL`, `AI_MAX_BATCHES`, `MIN_HITS_FOR_RULE` and
  `PRICE_FETCH` from the environment in both setups; the add-on only maps its
  options onto those names. No second configuration reader exists.
- **Quoting matters.** Options are written with POSIX single-quote escaping, so an
  API key containing `'`, `$( )` or spaces stays literal when run.sh sources it.
- **State lives in `/data`.** `DATABASE_URL` defaults to
  `file:/data/financial.db`, the only path Home Assistant keeps across restarts,
  rebuilds and `backup: cold` snapshots. The old local `dev.db` is ignored.
- **Migrations at start.** `prisma migrate deploy` runs on every boot; with no
  pending migrations it is a no-op, so a rebuild cannot lose or duplicate data.
- **No ingress.** Home Assistant ingress forwards at a per-session path prefix,
  and a Next.js app cannot rebase its asset URLs at runtime (`basePath` is baked
  at build time), so the add-on publishes port 3000 and uses `webui` instead: the
  sidebar entry opens the UI in a new tab. This is a deliberate trade of sidebar
  embed for a working app.
- **The base image is pinned in the Dockerfile, not read from `BUILD_FROM`.** A
  first build resolved `BUILD_FROM` to the Alpine Home Assistant base despite
  `build.yaml`, where `apt-get` does not exist — and Alpine would also break the
  glibc prebuilds Prisma and `better-sqlite3` depend on. Both stages therefore say
  `FROM node:22-bookworm-slim`; `build.yaml` keeps the same value so either path
  agrees, but nothing depends on it.
- **The runtime image ships no `src/` and no dev dependencies.** `next.config.mjs`
  is plain JavaScript so that starting the server never needs the TypeScript
  compiler, and the only files copied in are `.next`, `public`, `prisma`, the
  Prisma config, the option mapper and `run.sh`.
- **Build stage only carries the toolchain.** `python3 make g++` exist in the
  builder so a missing prebuilt for `better-sqlite3` or Prisma cannot break the
  image; the runtime stage is the plain `node:22-bookworm-slim`.

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
      ai.ts                    # batched LLM proposals, per merchant group
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
  → PREVIEW stored in Setting; nothing is written yet              [step 2]
  → REVIEW DIALOG (one modal, two tables):
        rule-matched rows, and rows nothing matched, grouped per merchant
        → optional "Suggest with AI": proposals for unmatched groups only
        → the user approves categories, and rules for recurring merchants
  → COMMIT in one SQLite transaction: Statement + Transactions + learned Rules
  → categorise any row left empty (rules + merchant map)
  → report: imported N, duplicates M, new rules K                  [step 3]
```

The review step is the whole point of the flow: rules decide what they can, the
AI only fills what is left, and the user sees both before a single row is
written. Classification happens in memory against the parsed rows
(`lib/review/classify.ts`), never against committed data, which is why the dialog
can be opened and closed without side effects.

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
- Transfers: **one category, no balancing.** Every movement between own accounts
  gets the system category `Transfers` (`kind = TRANSFER`), and every report
  excludes that kind, so neither side of the movement lands in income or expense
  and nothing has to be paired. Detection (`lib/categorize/transfers.ts`) is
  deliberately narrow: another own account's IBAN in the counterparty field, an
  own IBAN or another account's name plus a movement word in the description, or
  a card settlement line (`GEINCASSEERD`, `VORIG SALDO`). The word "overboeking"
  alone never counts — a wrong transfer would hide real spending from every
  total. The legitimate PayPal case ("-X to ASN" on PayPal, "+X from PayPal" on
  ASN) is a transfer on both sides because each file names the other account.

Parser status and the documented-vs-observed split per source live in
`docs/IMPORT-FORMATS.md`. ASN also offers CAMT.053 (ISO 20022 XML), which ASN
itself recommends; it is optional and only worth adding if the CSV becomes
unstable.

## 6. Categorisation

Predictability first: **rules are the durable mechanism, AI is a one-off helper.**
The user has to be able to look at a rule list and know what happens to the next
statement.

### Resolution order

1. **Manual** — `categorySource = MANUAL` is final; nothing overwrites it.
2. **Merchant map** — exact `merchantKey` hit (source of all automatic wins).
3. **Rules** — ordered by `priority`, first match wins; can be scoped to one
   account and to an amount band.
4. **Account transfer** — a movement between own accounts gets the `Transfers`
   category. This outranks rules on purpose: no rule may park a transfer in a
   spending category.
5. **Uncategorised** — a badge count, and the rows the review dialog exists for.

### Review dialog (`/import`)

After a file parses, one large modal opens with two tables. Nothing is written
until the user commits.

| Table | Contents | What the user can do |
| --- | --- | --- |
| Needs a category (top) | rows no rule or merchant entry matched, grouped **per merchant** | pick a category per merchant, expand to see the individual rows, tick "create a rule" |
| Matched by rules (below) | rows that already have a category | see which rule fired, override the category if it is wrong |

Grouping per merchant is what makes this usable: 200 rows become a handful of
decisions, and one decision covers every row of that shop in the statement.

"Suggest with AI" fills the selects of the unmatched groups and, for recurring
merchants only, offers a rule per merchant in a third block. "Approve all
suggestions" accepts everything in one click; anything untouched stays exactly
as it was, so the dialog is safe to ignore.

### The recurrence gate

The AI never decides what becomes a rule. `lib/categorize/recurrence.ts` does:

- a merchant earns a rule only when it appears at least `MIN_HITS_FOR_RULE`
  (default 3) times within the last 12 months, counting already-imported rows
  plus the rows in this statement;
- a florist visited twice a year therefore gets a category for those two rows and
  **no rule**, so the rule list does not fill up with noise;
- a shop visited weekly gets a rule, so the next statement needs no clicks and no
  API call.

Accepted rules are written with `origin = LEARNED` and `priority = 100`, and an
identical `(matchOn, operator, pattern, categoryId)` rule is never created twice.

### AI layer (`lib/categorize/ai.ts`)

Mistral chat completions (`api.mistral.ai/v1/chat/completions`), so any
OpenAI-shaped endpoint works by changing the base URL. Written for cheap models,
because per-row cost decides whether the feature is worth having:

- **Granularity**: one line per *merchant group*, not per transaction, with a
  `|3x` marker when the group has several rows. A 200-row statement is usually a
  few dozen groups.
- **Prompt**: two sentences plus `n=Category` names, `0` = unsure, JSON reply
  `{"r":[{"i":1,"c":2}]}`. Around 330 characters plus the category names.
- **Reader**: tolerates fences, a bare array, trailing commas and `i:0` (some
  models use it as "skip"), falls back to positional mapping when the reply has
  exactly one entry per line, and drops out-of-range answers instead of guessing.
- **Guards**: `AI_BATCH_SIZE` groups per call, `AI_MAX_BATCHES` (default 5) calls
  per run, 20-second timeout, `temperature: 0`, `response_format: json_object`.
  A failed request reports `request-failed` and changes nothing.
- **Privacy**: only merchant/description text, the group total and the row count
  are sent. Never IBANs, account names or balances.

### Semantics of what gets written

| Situation | `categorySource` | `reviewState` |
| --- | --- | --- |
| rule or merchant map matched, user did not touch it | `RULE` | `OK` |
| user picked a category the AI proposed | `AI` | `OK` |
| user picked something else | `MANUAL` | `OK` |
| user left it undecided | `NONE` | `UNCATEGORIZED` |

An AI answer only ever *becomes* a row category because a human approved it in
the dialog; there is no background run that changes data. The old `MerchantMap`
AI cache is gone: a guess never enters the memory the rule engine reads.

### Rules editor

`Settings → Rules → Manage rules` opens the same modal primitive with every rule
editable in place: name, match target, operator, pattern, category, priority and
enabled, plus read-only hits and origin so the user can see what actually fires.
A row whose `REGEX` pattern does not compile is flagged and cannot be saved.

The app is fully functional with `AI_PROVIDER=none`; the dialog then simply never
offers the AI button.

### Duplicate detection

An import that overlaps a previous export is normal, so the dialog cannot simply
drop rows. `lib/import/duplicates.ts` (pure) compares the incoming rows with the
account's stored rows inside a ±14-day window and returns candidates:

| Verdict | Rule | Default |
| --- | --- | --- |
| `EXACT` | the incoming `dedupeHash` is already stored | **skip** |
| `LIKELY` | same amount within 3 days, or same amount and merchant within 14 days | **import** |

The dialog shows both sides (`03-11-2026 ALBERT HEIJN −€ 42,18` next to the
incoming row), with *Import* / *Skip* per row and *Import all* / *Skip all* in the
header. An approved exact duplicate is written with a suffixed hash, because
`dedupeHash` is unique by design; a likely duplicate inserts normally.

Skipping by default for `EXACT` protects the totals; importing by default for
`LIKELY` protects against losing a genuine second purchase. Both verdicts are
visible before anything is written, and the footer count follows the decisions.

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

## 10. Privacy and security

Financial data never leaves the machine except (a) optional AI calls, which send
the merchant label, a group total and a row count — never IBANs, account names or
balances, and the label is redacted before it is sent — and (b) optional Stooq
price lookups, which send only ticker symbols. Both are off by default.

### Authentication

One shared password (`ACCESS_PASSWORD`, or the *Access password* add-on option),
one session cookie. Enabled only when the variable is set, so local development
and a single-user laptop keep working with no login screen.

- **Stateless by construction.** The cookie value is `HMAC-SHA256(password,
  "financial-overview-session-v1")`. Nothing is stored server-side, and changing
  the password invalidates every existing session because the expected value
  changes with it.
- **`requireSession()` guards every page and every exported Server Action.** The
  page guard alone would be theatre: Server Actions are individually addressable
  endpoints, so each one checks for itself. 23 actions, 6 pages.
- **No middleware.** Next 16's middleware has no Node runtime configured here, so
  it cannot compute or compare an HMAC; a cookie-presence check there would look
  like protection without being any. The check lives where the writes happen.
- Constant-time comparison (`timingSafeEqual` over SHA-256 digests, so lengths
  cannot be inferred) and a fixed 600 ms delay on a wrong password.

Known limits, stated plainly: the cookie is not `Secure` (the add-on is reached
over plain HTTP on a LAN), there is no lockout table (one account, so the delay is
the control), and no password means no protection — the add-on logs a warning on
start in that case.

### Request handling

- `headers()` sets CSP, `X-Frame-Options: DENY` (the destructive buttons are one
  click away), `nosniff`, `no-referrer` and a restrictive `Permissions-Policy`.
  The CSP allows `'unsafe-inline'` for scripts because a nonce needs middleware;
  it still blocks foreign script origins and framing.
- Server Action bodies are capped at 12 MB (`experimental.serverActions
  .bodySizeLimit`) so the app's own 5 MB statement check is reachable — the
  framework default of 1 MB rejected real statements first, with a bare 413.
- Statements are capped at 20,000 rows, and nothing spreads a row array into
  `Math.min`/`Math.max` (that throws above ~125k arguments).

### Input handling

- Every mutation validates with Zod at the edge; ids coming from forms are bound
  and shape-checked before they reach Prisma. Prisma parameterises SQL, so
  injection is not the risk here.
- User-supplied `REGEX` rules are checked at write time and at match time
  (`isSafePattern`): nested quantifiers, quantified alternations, stacked
  quantifiers and quantified backreferences are refused, patterns are capped at
  120 characters and inputs at 256. A pattern that would backtrack catastrophically
  never runs, including one inserted straight into the database.
- Duplicate detection indexes the existing rows by amount, so the scan is linear
  rather than quadratic: 20k × 20k takes ~17 ms instead of 400M comparisons.
- Labels shown in the UI and sent to an AI provider are redacted (IBAN-shaped
  tokens, spaced account numbers, long digit runs, e-mails) before truncation.

The full review that produced this section, including the hypotheses that were
tested and ruled out, is in `docs/SECURITY-REVIEW.md`.

### Container

The add-on runs as root — Home Assistant's own convention — with a published
port. The generated `/tmp/options.env` is written under `umask 077` and deleted
immediately after sourcing, because it carries the API key and password. Note
that `/data/options.json` itself (written by Home Assistant) is part of every
add-on backup: treat backups as secret material.

## 11. Tests
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
| 4 | Rules engine, merchant learning, review dialog, AI rule proposals |
| 5 | Trades, FIFO, prices, broker account page |
| 6 | Dashboard aggregates and charts, balance history |
| 7 | Export, backup, polish |

Done: 0, 1, 2, 3, 4, 5, 6 (charts on the dashboard, net worth and cashflow
history) and the optional AI provider call in the import review. Not started: 7,
plus CAMT.053.

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
- **A learned rule can be too broad.** `MERCHANT contains "PRIMARK"` is right;
  `contains "AMSTERDAM"` would not be. Rules are editable in one popup and every
  rule shows its hit count, so a bad rule is visible and cheap to fix. Nothing
  creates a rule from a *description* pattern automatically.
- **Cheap models get ambiguous merchants wrong.** The suggestion arrives
  pre-selected but unapproved, and `c: 0` is respected as "no idea", so a wrong
  guess costs one click. It never becomes a rule for a one-off merchant.
- **`Transaction.transferGroupId` is legacy.** Reports no longer read it: they
  exclude `category.kind = TRANSFER` instead, which needs no pairing. Existing
  rows keep their old value and nothing writes it any more; dropping the column
  is a later migration, not a behaviour change.
- **The AI key is only checked on use.** A wrong key surfaces as
  `request-failed` in the dialog, not at boot; the import itself is unaffected.
