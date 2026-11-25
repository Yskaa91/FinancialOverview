# Changelog

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
