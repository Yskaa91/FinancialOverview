# Financial Overview

Personal wealth, income and expense tracker. Runs entirely on your Home
Assistant box: one SQLite file in the add-on's `/data`, no cloud, no account.

Import the CSV exports you already have — ASN Bank, PayPal and ICS credit card —
review them in one dialog, and the app keeps track of what you earn, what you
spend, and what your accounts and ETFs are worth.

> **Set an access password.** Without the `access_password` option there is no
> login and anything that can reach your Home Assistant host on port 3000 can read
> and rewrite your finances. With it, one password protects every page and every
> action. Keep it on your LAN either way and do not forward the port.

## Install

1. Settings → Add-ons → Add-on store → ⋮ → **Repositories**
2. Add `https://github.com/Yskaa91/FinancialOverview`
3. Install **Financial Overview**, start it, then **Open Web UI**

The first start creates the database and the schema. It stays empty until you
import a statement, which is the point: nothing is invented.

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| `access_password` | *(empty)* | **Set this.** Password for the web interface. Without it anything that reaches port 3000 can read and rewrite your finances. Changing it signs every session out. |
| `ai_provider` | `none` | Enables *Suggest with AI* in the import review. `none` keeps everything local; rules, merchant memory and manual picks work either way. |
| `ai_api_key` | *(empty)* | Key for the provider. Stored in Home Assistant's add-on options, not in this repository. |
| `ai_model` | `mistral-small-latest` | Any cheap chat model from the provider. |
| `ai_max_batches` | `5` | Hard cap on API calls per import review (40 merchants per call). |
| `min_hits_for_rule` | `3` | Visits within 12 months before a merchant earns a rule. Higher means fewer, more predictable rules. |
| `price_fetch` | `disabled` | `stooq` refreshes ETF quotes when you open a broker account. |

Only merchant text, a group total and a row count are ever sent to an AI
provider — never IBANs, account names or balances.

## What it does with your statements

- **ASN, PayPal, ICS** CSV imports, with per-source parsing quirks handled
  (encodings, sign conventions, localised decimals, masked card numbers).
- **Rules first.** Importing opens one review dialog: what the rules matched,
  what needs a decision, grouped per merchant so 200 rows become a handful of
  choices. Your rules are editable in one popup, with hit counts.
- **AI as a helper, never an authority.** It fills the gaps and proposes rules
  only for merchants that actually recur. Nothing is applied until you approve.
- **Transfers** get one category, so moving money between your own accounts never
  shows up as income or expense.
- **Overlapping statements** warn about possible duplicates (exact and
  look-alike) instead of silently dropping rows.
- **Accounts and ETFs**: balances per account, trades with FIFO cost basis.

## Data and backups

Everything lives in `/data/financial.db` inside the add-on. Add-on backups
include it; the option `backup: cold` means the add-on stops during backup so the
file is consistent. Export or copy the file before uninstalling anything.

## Development

The app is a normal Next.js project in this folder:

```bash
npm ci
cp .env.example .env.local
npm run db:migrate
npm run dev
```

See `docs/ARCHITECTURE.md` for the data model, the import pipeline and the
categorisation design, and `samples/README.md` for statements to click through.
