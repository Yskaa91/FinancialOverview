# FinancialOverview

Personal overview of wealth, income and expenses. Runs locally, on one machine,
with a single SQLite file. Imports from ASN, PayPal and ICS, automatic
categorisation with rules and (optionally) AI proposals you approve, and manually tracked ETF positions.

Status: **working prototype**. Accounts, statements from all three sources with
preview and idempotent commit, rule engine with merchant learning, review queue,
ETF portfolio with FIFO valuation, dashboard with charts, and demo data to look
at immediately. Remaining phases are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §12.

## Quick start

Node 20.9 or higher is required (Next.js 16 needs it).

```bash
npm install
cp .env.example .env        # DATABASE_URL="file:./dev.db"
npx prisma migrate deploy   # creates dev.db and the tables
npm run db:seed             # optional: six months of demo data
npm run dev                 # http://localhost:3000
```

`npm run db:seed` **wipes** the tables it owns and inserts a deterministic demo
set: five accounts, fourteen categories, four rules, two learned merchants, 132
transactions (including transfer pairs and rows left to categorise), three
instruments with nine trades and prices. Run it again any time to get back to a
known state.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | dev server on localhost:3000 |
| `npm run build` / `npm start` | production build and server |
| `npm test` | Vitest: money and date tests (parsers and FIFO next) |
| `npm run lint` | ESLint |
| `npm run db:migrate` | new migration after a schema change |
| `npm run db:studio` | Prisma Studio on dev.db |
| `npm run db:generate` | regenerate Prisma Client |
| `npm run db:seed` | rebuild the demo dataset (destructive) |

## Pages

| Route | Contents |
|---|---|
| `/` | Dashboard: net worth, 30-day delta, monthly figures, largest categories, needs a category |
| `/transactions` | Income & expenses: filter, inline category picker, review queue, run rules |
| `/accounts` | Accounts: balance per account; detail page with transactions, imports and, for broker accounts, holdings and the trade log |
| `/settings` | Categories, the rules editor popup, merchant memory, AI and price status |
| `/import` | Three-step wizard: upload, check the preview, commit (not a tab) |

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — stack, data model, import
  pipeline, categorisation logic, portfolio, phases, risks.
- [`docs/IMPORT-FORMATS.md`](docs/IMPORT-FORMATS.md) — exact ASN, PayPal and ICS
  file formats, with sources and what is *not* documented.
- [`docs/TOOLING.md`](docs/TOOLING.md) — project-scoped skills and MCP servers,
  and the design decisions that follow from them.

## UI

Dense dashboard: IBM Plex Sans for text, IBM Plex Mono for amounts, 12 px card
padding, 36 px table rows, sticky table headers, visible focus ring and a skip
link. Tokens live in `src/app/globals.css`; change them there, not per component.
Design decisions are traceable in `docs/TOOLING.md`.

## AI category suggestions

Optional, off by default. Rules and manual corrections are the primary path.

```bash
# .env.local
AI_PROVIDER=mistral
AI_API_KEY=your-key
AI_MODEL=mistral-small-latest   # any cheap chat model
AI_MAX_BATCHES=5                # 5 calls x 40 transactions per run
```

With that set, the import review dialog grows a **Suggest with AI** button. It
fills the categories of the merchants no rule matched, and proposes a *rule* for
the merchants that recur (default 3 visits in 12 months, `MIN_HITS_FOR_RULE`).
A one-off florist gets a category and no rule; a weekly shop gets a rule, so the
next statement needs neither a click nor an API call. Nothing is applied until
you approve it, and the rules stay the predictable part of the system. Only
merchant text, the group total and a row count leave the machine.

All copy is English. Amounts and dates still render in the Dutch convention
(€ 1.234,56 and 31-01-2026) because that matches the source statements; the
formatting lives in `src/lib/money.ts` and `src/lib/dates.ts`.

## Rules that must not break

- Money is **integer cents**, never a float. See `src/lib/money.ts`.
- Imports are **idempotent**: `Statement.fileHash` and `Transaction.dedupeHash`
  prevent double income when periods overlap.
- A credit card account carries a **negative** balance; net worth is the sum.
- Nothing leaves the machine except (optionally) description + amount to an AI
  provider and tickers to Stooq. No IBANs, no account names.
- The app has **no authentication** and is meant to stay on `127.0.0.1`.

## Database file

`dev.db` sits in the repository root and is git-ignored. Backing up is copying
the file.
