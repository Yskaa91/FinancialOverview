# Tooling: plugins, skills and MCP servers

What helps this project, what is installed already, and what to add next.
Everything below is **project-scoped**: `.vibe/skills/` and `.vibe/config.toml`,
nothing in `~/.vibe/`. A fresh clone gets the same setup. Project-local config is
only read in a trusted folder, so this repo is listed in
`~/.vibe/trusted_folders.toml`.

## Installed skills

| Skill | Why it is here |
|---|---|
| `ui-ux-pro-max` | Design intelligence for this UI: 80 styles, palettes, 74 font pairings, 141 UX rules, chart guidance, 22 stacks. Local Python search, no network. |
| `design-system` | Token architecture (primitive → semantic → component), component specs, Tailwind integration. Backs the tokens in `src/app/globals.css`. |

Both are vendored from
[`nextlevelbuilder/ui-ux-pro-max-skill`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
(`.claude/skills/*` → `.vibe/skills/*`), unmodified. They ship Python scripts and
CSV data, no install hooks, no network calls. ESLint ignores `.vibe/**` because
that code is not ours.

Query them from the repo root:

```bash
python3 .vibe/skills/ui-ux-pro-max/scripts/search.py "personal finance dashboard" --domain style
python3 .vibe/skills/ui-ux-pro-max/scripts/search.py "data dense financial table" --domain typography
python3 .vibe/skills/design-system/scripts/search.py "table" --domain component   # see SKILL.md for modes
```

Not vendored, available on request: `ui-styling` (shadcn/canvas, 5.8 MB),
`design` (logo/CIP/slides), `brand`, `slides`, `banner-design`. Install them only
when a task needs them — they are marketing-asset skills, not app skills.

## Installed MCP servers

Configured in `.vibe/config.toml`, started on demand with `npx` (so `npx` must be
on `PATH`; this machine's Node lives in `~/.local/bin`).

| Server | Version | Why |
|---|---|---|
| `context7` | `@upstash/context7-mcp@4.8.0` | Version-current docs for Next.js 16, Prisma 7, Recharts, shadcn. Prevents hallucinated APIs, the main failure mode in this stack. |
| `shadcn` | `shadcn@4.23.0 mcp` | Component search and correct registry installs for the UI. |

Deliberately not added: `playwright` (real value for import-flow smoke tests, but
it downloads browsers — add when phase 2 needs it), `sqlite` (use
`npx prisma studio` or `npm run db:studio`), and any "AI finance advisor" MCP
(categorisation is one HTTP call with a strict JSON contract, see
`docs/ARCHITECTURE.md` §6).

`npx prisma mcp` ships with Prisma 7 and needs no config; use it for schema work.

## Design decisions taken from the skill

Recorded so the next change can trace them:

| Decision | Source |
|---|---|
| Style: **data-dense dashboard** — 12-col grid, 8–12 px gaps, 36 px table rows, 12 px card padding, sticky table headers | `--domain style` → `styles.csv#data-dense-dashboard` |
| Typography: **Financial Trust** — IBM Plex Sans (UI) + IBM Plex Mono (figures), 14 px base, `tnum` on all amounts | `--domain typography` |
| Accessibility: visible `:focus-visible` ring on every control, skip-link, ≥ 4.5:1 muted text in both schemes, `prefers-reduced-motion` honoured | skill priority 1–2 + `references/pro-rules.md` |
| Icons: Lucide SVG only, never emoji | `references/pro-rules.md` |

The generic `--design-system` query returned a landing-page pattern
(hero + glassmorphism, Caveat/Quicksand) which does not fit an internal ledger.
Per the skill's own query contract it was re-run per domain and the domain
results above were used instead.

## Project skills still worth writing

Author these with `vibe:skill-creator` when the work reaches them:

| Skill | Contents |
|---|---|
| `finance-domain` | Money as integer cents, expense-negative convention, Dutch statement quirks, transfer pairing, what may and may not leave the machine. |
| `statement-parser` | The `RawRow → NRow` contract, how to add a source: parser, fixture, test, dedupe visit. |
| `prisma-sqlite` | SQLite/Prisma 7 limits (no enum/Decimal/arrays), `Int` cents boundaries, transaction-per-import. |
| `dashboard-metrics` | Definition of every number on the dashboard, so a metric never silently changes meaning. |
