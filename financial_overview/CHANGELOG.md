# Changelog

## 0.7.5

- **Card rows stop pretending to be unmatched.** A card is collected once a month,
  so its individual purchases can never pair with anything — the bank holds one
  debit for the whole statement. Every ICS row therefore sat in the
  reconciliation list as if something were wrong, which hid the rows that really
  do need attention. Card rows are now left out of that list, and the statement
  itself is checked: `/reconcile` shows, per card statement, the charges it adds
  up to and the bank debit that paid it, or says that no debit was found. On a real
  statement the two agree to the cent (−377,45, four days apart).

## 0.7.4

- **The browser could keep serving an old, wrong build of the app.** Chunks are
  sent with `cache-control: public, max-age=31536000, immutable`, but the proxy
  rewrites their contents per serving mode, so one URL can hold different bytes
  for the Home Assistant panel and for direct access — and Next names chunks
  after their on-disk content, which a rewrite does not change. A browser that
  had cached the chunk before 0.7.3 kept the `basePath = "/"` version for a year,
  which is why tab links still went to `http://portfolio` after updating.
  Rewritten responses now carry `cache-control: private, max-age=0,
  must-revalidate` and `Vary: X-Ingress-Path`; assets the proxy does not touch
  keep their immutable caching.

## 0.7.3

- **Tab links work again.** Clicking "Portfolio" went to `http://portfolio`.
  The build runs the app under a placeholder path (`/__ingress`) that the proxy
  swaps for the real one, and for direct access on port 3000 that swap turned the
  placeholder into `/` — including inside the client bundle, where Next keeps it
  as its base path and concatenates: `addPathPrefix("/portfolio", "/")` produced
  `//portfolio`, and a browser reads a lead-in `//` as a host name. In scripts the
  placeholder now becomes the empty string, so the link goes where the anchor
  says. Markup keeps the `/` form, where the placeholder means the app root.

## 0.7.2

- **The add-on opens inside Home Assistant.** It used to publish port 3000 and
  point `webui` at it, so the button only worked if you exposed the port. It now
  runs under ingress: the sidebar entry opens the app in a Home Assistant panel,
  with nothing published. Next.js bakes its asset paths at build time and the
  ingress path is only known at runtime, so the build uses a placeholder
  (`basePath: /__ingress`) that a small proxy swaps for the real prefix on every
  response — links, chunks, redirects and the session cookie included. Direct
  access on port 3000 still works, and framing is now same-origin instead of
  refused, which is what the iframe needed.
- **Add-on updates are a download now, not a build.** The Supervisor had no
  `image:` to pull, so every version was compiled on the Home Assistant host:
  `npm ci`, `prisma generate`, `next build` and `npm prune` on a machine that is
  often a Pi. That is where the quarter of an hour went — the add-ons that
  update in two minutes ship ready-made images and do none of it.
  `.github/workflows/build-addon-image.yml` now builds the image on GitHub and
  pushes it to GHCR, and `config.yaml` points at it, so updating fetches layers
  instead of compiling the app.
- **Labels travel with the image.** The Supervisor normally stamps version and
  architecture onto a build with `docker build --label`; a prebuilt image gets
  none of that, so the runtime stage declares `io.hass.version`,
  `io.hass.type` and `io.hass.arch` itself.
## 0.7.1

- **The net-worth chart includes the house again.** The headline figure on the
  dashboard counted real estate, the twelve-month chart under it did not, so the
  two disagreed by the value of the home. The chart now adds the homes too.
- **Estimates get a history.** The value of a home comes from a CBS or Eurostat
  index series fetched over the network, so it cannot be recomputed for a month
  that has passed. Each refresh now stores a dated `PropertyValuation` row
  (one per day at most), and the chart reads the newest estimate at or before each
  month end: the price paid stands in between the purchase and the first stored
  estimate, and a month before the purchase counts for nothing. Homes therefore
  gain a real history from their first refresh onward instead of a flat line.

## 0.7.0

- **The dashboard looks back, and compares.** Income, expenses, the net result
  and the spending pie are no longer stuck on "this month": a period bar walks
  backwards and forwards by month, quarter or year, and the period lives in the
  URL (`?p=2026-11`, `?p=2026-Q4`, `?p=2026`), so a view can be bookmarked and the
  back button retraces it. The label is a month picker, so a jump to some far
  month is one click.
- **Comparing is a mode of its own, and off by default.** Switching `Compare` on
  replaces the dashboard with what a comparison is for: the category table full
  width — both periods' spending per category, the difference in euros and in
  percent, income and total expenses underneath, categories that exist on only one
  side marked `new` — then the two spending pies side by side, then the account
  balances at the end of each period with their change (assets, credit card debt,
  net worth). What it measures against is picked with the same stepper-and-picker
  as the shown period, so any two periods can be held side by side; off, and the
  ordinary dashboard is back.
- **Statements are reconciled against each other.** The bank knew that €93,79 left
  for PayPal; PayPal knew it went to Servicecenter Windhorn. Imported separately
  the app counted both as spending. Rows that are the same money are now paired
  (equal amount, dates within a week, one statement naming the other account) and
  kept as two linked legs: the leg that names the shop keeps counting, the other
  one moves its account balance and is kept out of income and expenses. A card bill
  and its collection count on neither side.
- **A new Reconciliation tab** shows the linked pairs, the settlement rows that
  still have no partner (usually a statement that was never imported), statement
  coverage per account, and a Match transfers button. Any two rows can be linked
  or unlinked by hand.
- **Direct debits have a name now.** ASN's `Europese incasso: …` narrative became
  the merchant `EUROPESE INCASSO` for all 22 direct-debit rows in a month —
  PayPal, the phone bill, the insurer, the card collection. The payee column is
  the merchant now.
- **PayPal rows no longer collapse into one merchant.** The parser took the first
  two words of the `Type` column as the merchant, so every shop paid through
  "Express Checkout Payment" became a single review group, labelled after whichever
  row came first and totalling unrelated purchases. The other party (`Name`, else
  `Item Title`) is the merchant now; the type stays the description. A statement
  with five different shops shows five groups.
- **ICS statement PDFs import.** ICS only offers CSV for transaction exports, and
  a cards-only account gets nothing but the monthly PDF. The import page now
  accepts it: the PDF is read as text, one line per printed row, and the rows are
  signed the way the statement means them (`Af` spending, `Bij` payments and
  refunds). The year comes from the statement date, because the rows never carry
  one. Scans are refused with a clear message rather than imported as nothing.
- **PayPal files that say `Amount`/`Fees`/`Total` now import.** PayPal swapped
  `Gross`/`Fee`/`Net` for `Amount`/`Fees`/`Total` in the Activity Download, and
  the parser only knew the old names, so the whole file was rejected with "no
  recognisable header row". `Total` is the cash effect including the fee, and is
  used as the fallback for `Net`; a header carrying both still reads `Net`.
  Detection no longer depends on the filename: a plain `Download.csv` is
  recognised from its header.
- **A proposed rule keeps the category you picked** in the import review
  dialog instead of the AI's original suggestion.

## 0.6.3

- **0.6.2 could not be built at all.** Dropping the compiler from the image
  exposed a trap: better-sqlite3 ships prebuilt binaries but also ships a
  `binding.gyp`, and npm reads a `binding.gyp` with no install script as "compile
  this with node-gyp". With no `python3` in the image that build failed outright,
  so the Supervisor aborted the update at `npm ci`. Dependencies now install with
  `--ignore-scripts`, which skips the pointless compile, and the package loads
  its own prebuilt `prebuilds/linux-<arch>.node` — the binary the app used
  before, since it prefers a compiled build only when one exists.
- **Prisma still gets what it needs.** `npm rebuild @prisma/engines` runs the one
  install script that matters (the migration engine download), so `run.sh` still
  migrates on start without touching the network.
- **One better-sqlite3 instead of two.** The Prisma adapter asked for 12.x, which
  has no prebuilds and would have to compile; an npm `overrides` entry pins it to
  the 13.2.0 already declared, so there is a single copy, prebuilt, and about
  12 MB less in the image.

## 0.6.2

- **"Suggest with AI" works on large statements again.** The reply was budgeted
  at 8 tokens per merchant, but an entry costs about 14, so any batch of more
  than a handful of merchants came back cut off mid-JSON — and a truncated object
  parses to nothing. A 44-merchant statement therefore produced 2 suggestions
  from its small trailing batch and zero from the big one. The budget is now 24
  tokens per group, a cut-off reply still contributes every complete answer, and
  one failed batch no longer discards the others.
- **Suggestions use the whole transaction line.** Each merchant is sent with up
  to two full statement narratives (redacted, capped) instead of only the
  32-character merchant label, plus the amount, the row count and the kind of
  each category (expense/income/transfer) so income stops landing in a cost
  bucket.
- **Fewer forced guesses.** The prompt now asks for `0` unless the merchant
  clearly belongs to a category; with a small category set that means fewer
  wrong buckets. Category names in any language work as before — the language of
  your category names was never the problem.
- No migration, no data change: suggestions still only propose, a human approves.

## 0.6.1

- **Installing and updating the add-on is faster.** The image was carrying about
  1.1 GB of runtime tree, and the build ran the full dependency install twice. It
  now installs once and prunes, drops the compiler toolchain it never needed, and
  strips what only the build or another platform used: the Next.js Rust compiler,
  the WASM image fallback, SQLite prebuilds for macOS, Windows and musl, and
  Turbopack's rebuild cache. About 170 MB less to pull, and one multi-minute
  install less per build. Startup also skips `npx` now that both binaries are in
  the image.
- Nothing about the app changes: same routes, same data, same migrations.

## 0.6.0

- **Homes anywhere in Europe.** The real estate tab takes a country now: inside
  the Netherlands a home is still valued from the CBS index for its municipality,
  everywhere else from Eurostat's national quarterly House Price Index. The
  municipality field is only used for the Netherlands.
- Two letter codes are the only thing that reaches Eurostat; the address stays
  local, and the whole lookup still follows the `price_fetch` switch.
- Existing homes keep their data and keep using CBS — the migration adds the
  country column with `NL` as its default.

## 0.5.0

- **Real estate.** A new tab adds a home with its address, municipality, purchase
  price and purchase date, and tracks an approximate value from the CBS
  house-price index of that municipality: purchase quarter to the newest quarter,
  refreshed once a day. The page shows what was paid, the estimate and the change,
  with the index figures behind it. The total counts as an asset in net worth, and
  a card on the dashboard splits it out.
- Only the municipality name or code goes to CBS — the address never leaves the
  machine. Estimates follow the regional average, so treat them as an indication,
  not a valuation.
- Existing installs get the new `Property` table through the bundled migration on
  start; nothing else changes.

## 0.4.1

- **Holdings identified by ISIN get prices.** A fund entered as `IE00BD4TXV59`
  used to stay unpriced, because no quote endpoint answers for an ISIN. The
  lookup now asks Yahoo's search which listing matches and prices that one
  (`UETW.DE` in this case), with the result cached for the run. Typing an ISIN in
  the trade form also stores it as the instrument's ISIN. The ASN, net-worth and
  review behaviour from 0.4.0 is unchanged; no migration is needed.

## 0.4.0

Buying and selling by hand, and prices that keep themselves current.

- **A portfolio page.** `/portfolio` records a buy or a sell against any account:
  symbol (known ones offered, a new one created on the fly), side, date, quantity,
  price per unit, fee, note. Open positions show quantity, average cost, current
  price, value and unrealised P/L; the trade log lists every trade across every
  account with delete; a price can be set by hand per position.
- **Holdings count in your net worth.** A brokerage account used to report cash
  only. Its balance, the Accounts page and the dashboard's net worth now include
  the open positions, FIFO over the trade log, priced with the newest quote and
  falling back to the average cost.
- **ETF prices refresh on their own.** With `price_fetch: yahoo`, opening the
  portfolio page fetches any quote older than twelve hours. Stooq's CSV endpoint
  now answers with a JavaScript challenge, so the quote source is Yahoo Finance's
  keyless chart endpoint; `stooq` is still accepted and means the same thing. Only
  tickers leave the machine. The account page keeps a manual refresh that ignores
  the twelve-hour window.
- **ASN statements that carry a header row import again.** A 2026 export labels
  the same twenty columns and was being sent to the PayPal parser, which answered
  "no recognisable header row" because the file's prose mentioned "Bruto". The
  header row is now recognised and skipped, and PayPal is sniffed from its header
  line alone. Nothing else about the ASN positions changed.
- **Rows are labelled with the other party.** The import review, `/transactions`
  and the account page show `Naam`/counterparty ("ODIDO NETHERLANDS B.V.") instead
  of the merchant guessed from the narrative ("Europese incasso"), and fall back
  to that guess and then the full description when the field is empty. The stored
  merchant is untouched, so re-importing the same file stays idempotent, and the
  AI provider still receives the description-derived label only.
- **Date order in the import review.** The rows inside a merchant group run newest
  first, and the merchant table is ordered by its newest booking date instead of
  by amount, so an import reads like the statement it came from.
- **Development conveniences.** The Content-Security-Policy allows `eval()` in
  development, where React needs it, and still refuses it in production. The
  access password tolerates surrounding whitespace, so a password manager's stray
  space no longer reads as "Wrong password".

## 0.3.0

Managing what you already configured. Everything you can create, you can now
correct, and nothing gets deleted without telling you what it costs.

- **Edit accounts.** Name, type, institution, IBAN or card number and opening
  balance — the same fields as creation, prefilled, in a dialog.
- **Archive instead of hiding.** Archived accounts stay visible with a badge and a
  Restore action; before this they disappeared from the page for good.
- **Delete shows the impact first.** An account's deletion lists the transactions,
  statements, trades, price snapshots and rules that go with it, plus the balance
  leaving net worth, and stays disabled until you tick "I understand".
- **Edit categories.** Name, kind, colour and parent, prefilled from the creation
  form; a subcategory can be moved or promoted.
- **Deleting a category explains the cascade** instead of silently refusing when it
  is in use: transactions survive without a category, subcategories move up to the
  top level, rules and merchant memory are removed.
- **Guards.** The built-in Transfers category keeps its name and kind (transfers are
  classified by name, so a rename would create a second one and turn every transfer
  back into income). A category with subcategories cannot change kind, which would
  otherwise leave an income parent holding expense children.
- Both deletions require an explicit confirmation, checked on the server, so a
  stray submit destroys nothing.

## 0.2.0

Security and access control. **This release asks for a password**: set the new
*Access password* option before you start it, or the interface stays open to
anything that can reach port 3000.

- **Login.** One shared password protects every page and every server action, not
  just the screens. Changing it signs existing sessions out. Leave the option
  empty to keep running without one.
- **Rule patterns can no longer wedge the app.** A stored regex that backtracks
  catastrophically is refused when written and never executed when matched.
  Patterns are capped at 120 characters, inputs at 256.
- **Statements are bounded.** 20.000 rows per import, a clear message instead of a
  framework error, and the duplicate scan went from quadratic to linear (~17 ms
  for 20k x 20k rows instead of 400M comparisons).
- **Security headers**: CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`,
  `Permissions-Policy`.
- **Merchant labels are redacted** (IBAN, spaced account numbers, long digit runs,
  e-mails) before they are shown or sent to an AI provider.
- **The API key and password are no longer left behind** in `/tmp/options.env`.
- **Fixed:** a failed import could leave a statement row that made the same file
  unimportable forever; the file is now created inside the transaction.
- **Fixed:** uploads larger than 1 MB were rejected by the framework before the
  app's own 5 MB check ran, so real statements failed with a bare 413.
- **Fixed:** rules matched on the counterparty or IBAN never fired during import
  review.
- Added: an in-app rules editor, the import review dialog with duplicate warnings,
  and the single `Transfers` category for movements between your own accounts.

## 0.1.0

- First add-on release: ASN, PayPal and ICS statement import, rule-based and
  AI-assisted categorisation with an approval dialog, duplicate warnings for
  overlapping exports, account and ETF tracking, dashboard.
- Configuration through add-on options: AI provider, API key, model, call cap,
  recurrence threshold and ETF price refresh.
- Database in `/data`, migrations applied on every start.
