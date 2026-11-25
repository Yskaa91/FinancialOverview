<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project instructions

Personal finance app. Read `docs/ARCHITECTURE.md` before changing the data model,
and `docs/IMPORT-FORMATS.md` before touching a parser.

## Hard rules

- **Money is integer cents.** Every amount column, every calculation. Format with
  `src/lib/money.ts` only. A float near money is a bug.
- **Imports must stay idempotent.** Any change to the import path keeps
  `Statement.fileHash` and `Transaction.dedupeHash` doing their job, and keeps a
  fixture that re-imports the same file to prove it.
- **Never widen what leaves the machine.** Only descriptions, amounts and category
  names may go to an AI provider; tickers only to a price source. No IBANs, no
  account names, no file contents.
- **`categorySource = MANUAL` is final.** Nothing automatic overwrites it.
- SQLite/Prisma 7 limits: no enums, no Decimal, no arrays. Enum-like columns are
  `String` and validated with Zod against `src/lib/types.ts`.

## Conventions

- Server Components read the database through `src/lib/queries/*`; mutations are
  Server Actions in a sibling `actions.ts`, validated with Zod before Prisma.
- Pages that read the database export `const dynamic = "force-dynamic"`.
- **English only**, everywhere: UI copy, code, comments, commits, docs. No other
  language in this repo. Identifiers copied verbatim out of a bank file (column
  names such as `Transactiedatum`) are data, not prose, and stay verbatim.
- Design tokens live in `src/app/globals.css` (density, colours, focus ring).
  Change them there, not per component. `.vibe/skills/ui-ux-pro-max` is the
  source for style, typography and UX rules — query it before redesigning.
- `.vibe/skills/**` is vendored third-party code, unmodified and ESLint-ignored.
  Do not edit it; re-copy from upstream if it must be updated.
- `cacheComponents` is off on purpose (see `next.config.ts`); do not turn it on
  without moving DB reads into Suspense boundaries.
- Prisma 7: the URL lives in `prisma.config.ts` (with `dotenv/config`) and in the
  driver adapter in `src/lib/db.ts`, never in `schema.prisma`.

## Checks before you call it done

```bash
npm test && npm run lint && npm run build
```

New non-trivial logic (a parser, FIFO, money or date handling) needs a test or an
assert-based self-check. A new parser needs a fixture file in `tests/fixtures/`.
