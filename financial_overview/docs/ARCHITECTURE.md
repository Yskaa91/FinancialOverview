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
(`DATABASE_URL="file:./dev.db"`, git-ignored). `.env` holds `DATABASE_URL`
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
- **Ingress, so the app opens inside Home Assistant.** The add-on is served in an
  iframe at `https://<home-assistant>/api/hassio_ingress/<token>/`, which means
  every URL the app emits has to live under a prefix that does not exist at build
  time. Next.js bakes `basePath` into the client bundles, so the build fixes
  `basePath: /__ingress` (`scripts/ingress-path.mjs`) and `scripts/ingress-proxy.mjs`
  replaces that marker with the real prefix on the way out — assets, chunk URLs,
  `<a href>`, the flight data that repeats those hrefs after hydration, redirects
  and the refresh header. The Supervisor strips the prefix before the request
  arrives and sends it as `X-Ingress-Path`; the proxy also accepts a prefix that
  was not stripped. A direct request on port 3000 has no prefix, and the same
  swap removes the marker, so LAN access keeps working at `/`.
- **The proxy is the only process on the published port.** It starts `next start`
  on loopback (`APP_PORT`, default 3001), waits for it to accept connections, and
  exits when it does, so a crashed server restarts the container instead of
  answering 502. It forwards the client's `Host` and sets `X-Forwarded-Host`:
  Next compares `Origin` against `Host` for every Server Action, and the browser's
  origin is Home Assistant.
- **Framing is same-origin.** `X-Frame-Options: SAMEORIGIN` and
  `frame-ancestors 'self'`: the ingress iframe is served from the Home Assistant
  origin, so it is same-origin, while a foreign page still cannot frame a UI with
  destructive buttons one click away.
- **The session cookie is scoped to the ingress path.** The cookie's origin is
  Home Assistant, so a `Path=/` cookie would ride along on every Home Assistant
  request; the proxy rewrites it to the prefix.
- **The image is prebuilt, so updating is a pull.** `config.yaml` carries
  `image: ghcr.io/yskaa91/financial-overview-{arch}`, which makes the Supervisor
  fetch `ghcr.io/yskaa91/financial-overview-amd64:<version>` instead of running
  the Dockerfile on the Home Assistant host. Without it, every update compiled
  the app there (`npm ci`, `prisma generate`, `next build`, `npm prune`), which is
  minutes on x86 and much more on a Pi. `.github/workflows/build-addon-image.yml`
  builds both architectures with buildx/QEMU and pushes `<arch>-<version>` and
  `<arch>-latest`; the version it tags comes from `config.yaml`, and so does the
  image name, so the two cannot drift. The Dockerfile stays buildable on its own
  for a local build, which is what the workflow uses. The package is private, not
  public: the Supervisor is given a `ghcr.io` credential (Settings → Apps → ⋮ →
  Registries) and the store URL carries a read-only token, so nothing about the
  app is world-readable.
- **The add-on labels are baked into the image.** `io.hass.version`,
  `io.hass.type` and `io.hass.arch` are normally passed with
  `docker build --label` by the Supervisor; a pulled image has to declare them
  itself, so the runtime stage takes `BUILD_VERSION` and `BUILD_ARCH` build args.
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
- **One install, then prune.** The build used to run `npm ci` in one stage and
  `npm ci --omit=dev` in another — two multi-minute installs for the same tree.
  Now the builder installs once, builds, and runs `npm prune --omit=dev`, which
  keeps `prisma` (a runtime dependency, since `run.sh` migrates on start) and the
  generated client in `node_modules/.prisma`.
- **What the image drops after the build.** `@next/swc-*` (the Rust compiler,
  only `next build` needs it), `sharp-wasm32` (image optimisation fallback for
  other platforms), `better-sqlite3` prebuilds for macOS/Windows/musl, and
  `.next/cache` (Turbopack's rebuild cache). Together about 170 MB less to pull
  and unpack per install or update: ~1.10 GB of runtime tree before, ~933 MB
  after, measured locally.
- **No compiler toolchain, and no compiling.** `npm ci --ignore-scripts` keeps
  npm from treating `better-sqlite3`'s `binding.gyp` as "build me with node-gyp"
  (it has no install script, so npm's default applies) and the package then loads
  the prebuilt `prebuilds/linux-<arch>.node` it ships. An `overrides` entry keeps
  a single `better-sqlite3`, so the Prisma adapter uses that prebuilt copy as
  well instead of its own 12.x, which has no prebuilds. `npm rebuild
  @prisma/engines` runs the one install script that matters: the migration
  engine download. A dependency that genuinely needs to compile has to bring back
  `python3 make g++` in the `deps` stage.
- **Not done: Next.js `output: "standalone"`.** It would cut most of the ~700 MB
  of `node_modules`, but `run.sh` needs the Prisma CLI for migrations, and that
  CLI pulls `@prisma/studio-core` and `@prisma/dev` at load time (verified: the
  CLI crashes without either), so the saving would be smaller than it looks and
  the packaging risk is not worth it today. The other lever is BuildKit cache
  mounts for npm; they need `# syntax=docker/dockerfile:1` and a builder with
  BuildKit, which is not guaranteed on older Supervisors.

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
    periods.ts                 # month/quarter/year keys, shifting, comparison rows
    queries/
      dashboard.ts             # per-period totals, comparison, net worth, recent
      transactions.ts          # filtered/paged lists, aggregates
      accounts.ts              # balances
      history.ts               # net worth series, cashflow, balances at a date
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
               excludeFromSpending, transferLinkId?, balanceAfterCents?,
               rawJson, dedupeHash UNIQUE
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
Property       id, label?, address, country(NL, DE, …), regionCode(CBS RegioS
               e.g. GM0363, else the country code), regionName,
               purchasePriceCents, purchasedAt,
               estimatedValueCents?, indexAtPurchaseMicro?, indexLatestMicro?,
               indexPeriod?, valueFetchedAt?
               -- value follows the regional index; never typed in
PropertyValuation  id, propertyId, valuedAt, cents
               -- one dated estimate per day; the net-worth history reads it
Price          id, instrumentId, fetchedAt, priceCents, source(MANUAL|STOOQ|YAHOO)
Snapshot       id, accountId, takenAt, balanceCents, source(IMPORT|MANUAL)
TransferLink   id, kind(FUNDING|SETTLEMENT|OWN_ACCOUNT), method(AUTO|MANUAL), createdAt
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
- **One movement, two rows.** The bank's direct debit to PayPal and the PayPal
  purchase it paid for are the same money. Both rows survive — the bank needs its
  row for the balance chain, PayPal needs its row for the shop — and
  `TransferLink` joins them. The leg the pairing does not pick as *carrier* is
  flagged `excludeFromSpending`, which is what keeps income and expenses honest.
- **A home is not an account.** `Property` stands on its own and is added to
  assets and net worth by the dashboard query, so it never shows up in the
  accounts list or in the import flow. Its value is an estimate: the purchase
  price moved by a regional house-price index from the purchase quarter to the
  newest one: inside the Netherlands the CBS municipality index (table `85792NED`,
  2020 = 100), everywhere else Eurostat's national quarterly House Price Index
  (`prc_hpi_q`, 2015 = 100, all dwellings). Only a municipality name or a
  two-letter country code leaves the machine; the address stays local. Drift is
  expected — a single address is not a municipal or national average.

## 5. Import pipeline

```
upload(accountId, file)
  → PDF? extract lines (unpdf), else decode bytes as text
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

## 5b. Reconciliation between statements

Each statement is a partial view. ASN prints `Europese incasso … PAYPAL` and
nothing about the shop; PayPal prints the shop and nothing about the bank. The
ICS statement prints the purchases and one `GEINCASSEERD VORIG SALDO` line that
the bank also shows as a debit. Importing both without linking counts the same
money twice in every income-and-expenses figure.

```
pairing (lib/transfers/pairing.ts, pure)
  rows of different accounts, same currency, equal |amount|                  gate 1
  one row's text names the other account (hint, see below)                   gate 2
  booking dates within PAIRING_WINDOW_DAYS (7)                              gate 3
  kind from the signs; deterministic greedy, each row used once
     ↓
linkTransfers (lib/transfers/link.ts)
  TransferLink row + transferLinkId on both rows
  excluded leg: excludeFromSpending = true, category = Transfers (never MANUAL)
     ↓
reports and the transactions list read excludeFromSpending (lib/queries/filters.ts)
```

- **Hints** come from the account itself: its name, its IBAN, and for `PAYPAL` or
  `ICS` the wording the bank actually prints (`paypal`, `card services`,
  `creditcard`, `ics`). Words match whole words so "ICS" never hits "statistics";
  numbers match on digits so a spaced IBAN is the same hint.
- **Kind.** Opposite signs are `SETTLEMENT` (a card bill, a withdrawal landing) and
  nothing counts on either side. Two debits are `FUNDING` and the leg that names
  the shop keeps counting. Two credits are penalised: money the bank received from
  a wallet means the wallet paid it out.
- **Carrier.** The statement that names shops gets first refusal: the PayPal
  purchase counts, the ASN direct debit does not. If that row names no shop (a
  withdrawal), the bank's own row keeps the expense visible.
- **Manual.** A pair the automatic pass refuses can be linked by hand from
  `/reconcile`, with the same validation minus the hint; unlinking puts both rows
  back to counting and removes only the category the app set itself.
- **Idempotent.** Linked rows are never candidates again, so re-running the pass
  changes nothing. Importing a statement runs it over that statement's period
  ±14 days, in both directions, so import order does not matter.
- **What it finds.** Rows that name another account and still have no partner are
  listed on `/reconcile` — usually a statement that was never imported. That page
  also shows per-account coverage, which is the same question asked the other way.

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
- **Line format**: `i|merchant|amount|count|statement text`. The statement text
  is the real value — the merchant name in a bank export is often truncated to
  something meaningless, while the narrative carries the shop and the branch. Two
  distinct narratives per group, redacted and capped at 120 characters.
- **Prompt**: the line format, `negative = money out`, `E/I/T` kinds next to each
  `n=Category` name, "only pick a category the merchant clearly belongs to,
  otherwise 0", and the JSON reply shape `{"r":[{"i":1,"c":2}]}`.
- **Output budget**: `80 + 24` tokens per group. An entry costs about 14 tokens,
  so the old `60 + 8` per group cut the JSON off mid-object
  (`finish_reason: length`), and a truncated object parses to nothing at all —
  that is what made a 40-merchant batch return zero suggestions while the small
  trailing batch looked fine.
- **Reader**: tolerates fences, a bare array, trailing commas and `i:0` (some
  models use it as "skip"), falls back to positional mapping when the reply has
  exactly one entry per line, salvages the complete `{i,c}` pairs out of a reply
  that was cut off, and drops out-of-range answers instead of guessing.
- **Guards**: `AI_BATCH_SIZE` groups per call, `AI_MAX_BATCHES` (default 5) calls
  per run, 20-second timeout, `temperature: 0`, `response_format: json_object`.
  A failed request reports `request-failed` but the batches that did answer are
  kept, and nothing is written without a human approval either way.
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
- Value = `quantity × latest price`. Price comes from the newest `Price` row.
  With `PRICE_FETCH` on, `lib/portfolio/quotes.ts` refreshes every instrument
  someone holds from Yahoo Finance's keyless chart endpoint (`SYMBOL.AS`, then
  `SYMBOL.DE`, then the symbol as typed, or `Instrument.priceSymbol` first). A
  holding identified by an ISIN is resolved through Yahoo's search endpoint
  (`IE00BD4TXV59` → `UETW.DE`) and that listing is tried first, because no quote
  endpoint prices an ISIN directly. Refresh happens only when the newest row is
  older than 12 hours; `/portfolio` does that on open, and the account page
  button ignores the window. Stooq was the source until
  its CSV endpoint started answering with a JavaScript challenge, so `stooq`
  stays an accepted `price_fetch` value and means the same thing.
- Account balance for a broker = cash snapshot + sum of position values. The
  same number feeds the account cards and `getDashboard().netWorthCents`, via
  `holdingsValueByAccount()` — one FIFO pass over every broker's trades, priced
  with the newest `Price` row and falling back to the average cost.
- Net worth history: an account's balance on a date is its opening balance plus
  the movements up to that date; a broker adds FIFO holdings priced with the
  newest quote known then (`balancesAtDate`, shared by the chart and the
  per-period table on `/`). The homes come from `PropertyValuation`: one dated
  estimate per day, written whenever the property refresh runs, because the index
  series behind it lives on the network and cannot be re-derived later. A date
  before the first estimate uses the price paid; before the purchase, nothing. The
  chart therefore carries the same real estate as the headline net worth.

## 8. Pages

**Dashboard `/`** — two modes, one page.

*Comparing off (the default)* — the working view: four stat cards (net worth as
of today; income, expenses and net result for the period); net-worth chart (12
months) beside the period's pie; cashflow bars (12 months) beside the
uncategorised count; account balances with assets vs liabilities directly
underneath and the last eight rows beside them.

*Comparing on* — only what a comparison is for: the category table full width,
below it the two pies side by side (one per period), below that the account
balances at the end of each period with their change. Nothing else, so the page
answers one question at a time.

The whole page follows a **period** carried in the URL (`src/lib/periods.ts`):
`?p=2026-11` (month), `?p=2026-Q4` (quarter) or `?p=2026` (year), with `←`/`→`
walking by one period of the same length, so every view is a bookmark and the
back button steps through what was actually looked at. Anything unrecognised
falls back to the current month rather than erroring.

`?c=` turns the comparison on and names the period to measure against: a key
(`2025-11`, `2025-Q4`, `2024`), and anything else — missing, `off`, a hand-edited
string — leaves it off. The right-hand stepper mirrors the left one: arrows walk
the compared period and, on a month view, its label is a picker; a picked period
takes the length of the shown one, so both columns always cover the same amount
of time. Comparing a period with itself steps back instead of drawing a table of
zeros.

The category table has one line per category with both periods' spending, the
difference in cents and in percent, plus income and total-expense rows;
categories present on only one side are kept and marked `new`/negative, because a
subscription that started this month is the finding. Rows link to
`/transactions` filtered to that category and period.

Balances per period end come from `accountBalancesAt` (`queries/history.ts`),
which shares `balancesAtDate` with the net-worth series: cash is opening balance
plus movements, a broker adds FIFO holdings priced with the newest quote known at
that date. Houses are excluded from that table — they are valued at today's
estimate, so a historical figure would be invented.

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

**Portfolio `/portfolio`** — every trade and open position in one place: record a
buy or sell against any account (symbol, side, date, quantity, price, fee, note),
delete a trade, set a price by hand, and read holdings value, unrealised P/L,
realised P/L and cash for the whole app. Numbers come from `getPortfolio()` per
account, so this page and `/accounts/[id]` can never disagree.

**Real estate `/property`** — add a home (address, country, municipality inside
the Netherlands, purchase price and date), see the estimated value, what was paid and the change, with the index
figures it came from; delete a home and refresh the index on demand. The estimate
refreshes at most once a day when the page opens, and the total joins net worth
on the dashboard.

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

### Outbound calls

Only a few things leave the machine. Share tickers go to Yahoo Finance (share
prices) and are off unless `PRICE_FETCH` is on; a municipality name or CBS region
code to CBS StatLine, or a two-letter country code to Eurostat (house-price
index), under the same switch; merchant text, group totals and row counts go to
the configured AI provider (category suggestions). The house address, account
names, IBANs and balances never do.

### Request handling

- `headers()` sets CSP, `X-Frame-Options: DENY` (the destructive buttons are one
  click away), `nosniff`, `no-referrer` and a restrictive `Permissions-Policy`.
  The CSP allows `'unsafe-inline'` for scripts because a nonce needs middleware;
  it still blocks foreign script origins and framing. `'unsafe-eval'` is added in
  development only, where React calls `eval()` for callstack reconstruction and
  Fast Refresh; the production header stays without it.
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
- **Prices are only as good as the rows.** Valuation uses the newest `Price` row
  at or before the date; holdings history is therefore approximate until those
  rows accumulate. Homes keep their own dated estimates in `PropertyValuation`, so
  a property only gains a real history from the first refresh onward.
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
- **Pairing replaced the legacy `transferGroupId`.** That column marked pairs
  without ever deciding which leg counts, and nothing read it. It is dropped;
  `TransferLink` plus `excludeFromSpending` say both things, and the pairing can be
  re-run or undone.
- **The AI key is only checked on use.** A wrong key surfaces as
  `request-failed` in the dialog, not at boot; the import itself is unaffected.
