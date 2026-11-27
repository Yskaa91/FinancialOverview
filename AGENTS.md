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

## Verification, not intention

Releases shipped broken from this repo for one reason: a change was reasoned
about, then described as done, without ever producing the artifact it affects.
These rules are the fix, and they override any urge to report quickly.

- **Compute generated values, never infer them.** A tag, URL, header or config
  key that a workflow, proxy or config file derives has to be printed locally and
  read before it is pushed. Publishing `…-amd64-amd64` while `config.yaml` asked
  for `…-amd64` cost two failed updates and was one `sed` away from being caught.
- **Reproduce the artifact.** For anything a browser, container or the Supervisor
  consumes — HTML, JS chunks, response headers, image tags — fetch the built
  output and read it. A green build and green tests say nothing about emitted
  output. Rewriting Next's `basePath` to `/` inside a chunk produced
  `//portfolio`; one `curl` of that chunk shows it.
- **Prove install paths in a pristine tree.** Any Dockerfile or dependency change
  is validated by a clean `npm ci` and build in an empty directory, or by a real
  image build. The working tree's `node_modules` proves nothing: dropping the
  compiler broke `npm ci` on a version that had already shipped.
- **Verify both directions of a two-sided change.** Proxy and app config,
  exporter and importer, schema and migration, workflow and `config.yaml`: check
  every mode, not the one that was convenient.
- **Facts about Home Assistant, GHCR, Prisma and Next.js come from documentation
  or the local install, never from memory.** `node_modules/next/dist/docs/` is on
  disk and the HA and GHCR docs are a search away. When a fact cannot be checked,
  say so at the point where it is used.
- **Name the evidence class in the summary: executed, simulated, or untested.**
  "Works" without one of those is not auditable. Never write "verified" when the
  evidence is a re-reading of your own diff.
- **State the assumption that would break it,** in one line: what has to be true
  for this to work, and what happens if it is not. That line is what makes a
  wrong assumption cheap to find later.
- **Secrets never enter the repo or a shared artifact.** Before making a
  repository or package public, or copying a key into anything tracked, run
  `git grep -I -l -E 'mstrl_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}' $(git rev-list --all)`
  and read the hits. A token that has to exist on a host is read-only, scoped to
  one repository or package, and documented together with where it is stored.
- **Kill background processes by PID** (`kill "$(cat pidfile)"`), never
  `pkill -f <pattern>`: the pattern matches the shell running it.
- **A version bump is a release.** It is only correct once the artifact exists at
  the tag the add-on asks for: check the registry or the workflow run before
  telling anyone to update.
