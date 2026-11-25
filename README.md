# FinancialOverview

Personal overview of wealth, income and expenses. Runs locally, on one machine,
with a single SQLite file. Imports from ASN, PayPal and ICS, automatic
categorisation with rules and (optionally) AI, and manually tracked ETF positions.

Status: **phase 0** — the skeleton is in place (stack, database schema, four pages,
money and date layer, tests). Importers, categorisation UI, portfolio and charts
follow the phases in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §12.

## Quick start

Node 20.9 or higher is required (Next.js 16 needs it).

```bash
npm install
cp .env.example .env        # DATABASE_URL="file:./dev.db"
npx prisma migrate deploy   # creates dev.db and the tables
npm run dev                 # http://localhost:3000
```

Then add accounts in `/accounts` and import files through `/import`.

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

## Pages

| Route | Contents |
|---|---|
| `/` | Dashboard: net worth, 30-day delta, monthly figures, largest categories, needs a category |
| `/transactions` | Income & expenses: filter, search, categorise, export |
| `/accounts` | Accounts: balance per account; detail page with transactions, imports and (phase 5) portfolio |
| `/settings` | Categories, rules, merchant memory, AI status, data |
| `/import` | Three-step wizard (not a tab, a button in the navigation) |

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
