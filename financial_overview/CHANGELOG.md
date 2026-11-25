# Changelog

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
