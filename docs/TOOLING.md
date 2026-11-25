# Tooling: plugins, skills and MCP servers

What helps this project, what is already here, and what to install. Honest
inventory first: this machine has exactly one plugin, the one shipped with
Vibe, and it contains no finance or UI skills.

## Already available

| Item | Verdict for this project |
|---|---|
| `vibe:vibe` skill | Reference for CLI/config questions. Useful, unrelated to finance. |
| `vibe:skill-creator` | Use it to author the project skills listed below. |
| `vibe:create-plugin` | Only needed if these skills should ship as a package. Not now. |
| `vibe:worktree` | Useful for parallel phases in git worktrees. Optional. |
| `vibe:import` | Irrelevant (no other CLI config to migrate). |
| `connector_web_search` | Real value: format research, ETF price/ISIN lookups, library checks. |
| file system + process tools | Enough to run dev server, migrations, tests. |

There is no finance-expertise skill, no UI-design skill, and no plugin
marketplace reachable from this session. Anything that looks like one has to be
installed or written.

## Install: MCP servers

These are the ones with a concrete payoff here. Install with
`vibe mcp add <name> -- <command>` (run `vibe mcp add --help` for the exact
argument shape of your build).

| MCP server | Why | When |
|---|---|---|
| `context7` | Version-current docs for Next.js, Prisma, Recharts, shadcn. Prevents hallucinated APIs, which is the most common failure mode in this stack. | Before phase 1 |
| `shadcn` (registry MCP) | Component search and correct registry installs; keeps the UI coherent instead of hand-rolling tables and selects. | Phase 0–1 |
| `playwright` | Drives the real UI so import flows and keyboard navigation can be checked without manual clicking. | Phase 2 onward |
| `sqlite` | Ad-hoc queries against `dev.db` while debugging imports and aggregates. | Phase 2 onward |
| `prisma mcp` | Ships with Prisma 7 (`npx prisma mcp`): schema and query help that matches the installed major version. Complements Context7, and needs no separate install. | Now |

Deliberately not installed: any "AI finance advisor" MCP. Categorisation is one
HTTP call with a strict JSON contract (see `docs/ARCHITECTURE.md` §6); wrapping
it in an MCP server adds a moving part for no gain.

## Write: project skills

Four small skills under `.vibe/skills/` would carry the conventions that are
expensive to re-derive. Author them with `vibe:skill-creator`.

| Skill | Contents |
|---|---|
| `finance-domain` | Money as integer cents, expense-negative convention, Dutch statement quirks (decimal comma, `DD-MM-YYYY`, ICS sign flip), transfer pairing, what may and may not leave the machine. |
| `statement-parser` | The `RawRow → NRow` contract, how to add a source: parser file, fixture, test, dedupe visit. The checklist that keeps imports idempotent. |
| `ui-kit` | shadcn + Tailwind + Recharts conventions: table layout for dense numeric data, right-aligned amounts, tabular figures, chart fallbacks, empty states, no decoration that costs density. |
| `prisma-sqlite` | SQLite limits (no enum, no Decimal, no arrays), `Int` cents boundaries, migration discipline, transaction-per-import. |

Local skills win over re-explaining the same rules in every session, and they
live in the repo, so they survive a fresh clone.

## Skills worth writing later

- `dashboard-metrics` — definition of every number on the dashboard, so a metric
  never silently changes meaning.
- `import-recovery` — what to do when a parser throws after a format change:
  re-derive from `rawJson` instead of asking for a new export.

## Domain references to lean on instead of inventing

- Open-source ledger importers (hledger `csvrules`, Firefly III importers) for
  edge cases already solved: sign conventions, transfer detection, duplicate
  suppression.
- Official statement-format pages, recorded per source in
  `docs/IMPORT-FORMATS.md` with the evidence found.
- yfinance / Stooq quirks: Stooq CSV is free and keyless, which is why prices
  start there rather than with a paid API.
