# Financial Overview

A personal finance web app that tracks wealth, income and expenses: imports bank
statements from ASN, PayPal and ICS, categorises them with rules you control,
watches account balances and manually tracked ETF positions.

Ships as a **Home Assistant add-on** and runs as a plain Next.js app for
development. Either way the data is one SQLite file on your own machine.

## Install on Home Assistant

1. Settings → Add-ons → Add-on store → ⋮ → **Repositories**
2. Add `https://github.com/Yskaa91/FinancialOverview`
3. Install **Financial Overview**, start it, then open it from the sidebar — it
   runs under Home Assistant ingress, in a panel of its own, so nothing has to be
   exposed. Port 3000 is still published for direct LAN access.

Updates pull a ready-made image from GitHub Container Registry, so they take
about as long as any other add-on update. Versions up to 0.6.x had no image to
pull and compiled the app on the Home Assistant host instead, which is why they
took minutes.

AI-assisted categorisation is optional and configured in the add-on options
(provider, API key, model, call cap). Rules, merchant memory and manual picks
work with no key at all. Everything else — statement formats, the review dialog,
transfers, duplicates — is described in
[`financial_overview/README.md`](financial_overview/README.md).

> No login screen: keep it on your LAN and do not forward port 3000.

## Repository layout

```
.
├── repository.yaml          # makes this repo an add-on store
├── financial_overview/      # the add-on: Dockerfile, config.yaml, and the app
│   ├── config.yaml          # add-on metadata and options schema
│   ├── Dockerfile           # multi-stage build, Node 22 on Debian slim
│   ├── run.sh               # options -> env, migrations, then next start
│   ├── src/                 # Next.js app (pages, server actions, libs, auth)
│   ├── prisma/              # schema and migrations
│   ├── tests/               # vitest, 193 tests
│   ├── samples/             # demo statements to click through the import
│   └── docs/                # architecture, import formats, design, security review
```

The app lives inside the add-on folder because the Home Assistant Supervisor
builds each add-on with that folder as the Docker build context — sources outside
it cannot be copied into the image.

## Development

```bash
cd financial_overview
npm ci
cp .env.example .env.local     # DATABASE_URL and the optional AI settings
npm run db:migrate
npm run db:seed                # demo data: 5 accounts, 132 transactions, 3 ETFs
npm run dev                    # http://localhost:3000
```

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js development and production |
| `npm test` | Vitest suite (importers, rules, AI prompts, portfolio maths) |
| `npm run lint` / `npx tsc --noEmit` | ESLint and type check |
| `npm run db:migrate` / `db:seed` / `db:studio` | Prisma migrate, demo data, data browser |

### Releasing

Bump `version` in `financial_overview/config.yaml` and push to `main`.
`.github/workflows/build-addon-image.yml` builds amd64 and pushes
`ghcr.io/yskaa91/financial-overview-amd64:<version>`; the Supervisor pulls that
tag once the add-on store sees the new version. The workflow authenticates with
the repository's own `GITHUB_TOKEN` (`packages: write`), so no secret is stored in
the repo and neither the code nor the image has to be public.

### Private repository and private images

Both can stay private; the Supervisor just has to be able to read them. It never
holds a GitHub session, so it needs credentials for each side, entered once on the
Home Assistant host:

1. **Registry** — Settings → Apps → Install app → ⋮ → *Registries* → *Add new
   registry*: registry `ghcr.io`, username = your GitHub username, password = a
   token with **read:packages**. Stored in the Supervisor's `/data/docker.json`.
   Use a dedicated token so it can be revoked without touching anything else.
2. **Add-on store** — the repository URL can carry credentials:
   `https://<user>:<token>@github.com/Yskaa91/FinancialOverview`, with a token
   that has **Contents: read** on this repository. Home Assistant stores that URL
   as plain text, so it is also a token to keep narrow.

Keeping a token on the Home Assistant host is the price of private images. The
alternatives are a public store repository that contains only `config.yaml` and
`repository.yaml` and points at the private image, or a registry on your own
network (`registry:2` behind basic auth), which keeps the image inside the house
but needs an always-on host.

Only amd64 is built: a native build needs no QEMU, and emulating arm64 was the
expensive part of the Actions minutes a private repository spends. To cover a Pi,
add an `aarch64` / `linux/arm64` row to the workflow matrix and `aarch64` to
`config.yaml`'s arch list.

## How it decides a category

1. **Manual** — final, never overwritten.
2. **Merchant memory** — one confirmation per shop.
3. **Rules** — your list, ordered by priority, editable in one popup.
4. **Account transfer** — movements between your own accounts get the single
   `Transfers` category and stay out of income and expense.
5. **AI proposals** — filled in the import review, applied only when you approve,
   and they only become rules for merchants that genuinely recur.

Details, including the recurrence threshold and the duplicate verdicts, are in
[`financial_overview/docs/ARCHITECTURE.md`](financial_overview/docs/ARCHITECTURE.md).

## Rules that must not break

- Money is **integer cents**, never a float.
- Imports are **idempotent**: `Statement.fileHash` and `Transaction.dedupeHash`
  prevent double counting when periods overlap, and the dialog warns about
  look-alikes before writing.
- A credit card account carries a **negative** balance; net worth is the sum.
- No language other than English in code, copy or docs. Amounts and dates still
  render as Dutch convention (€ 1.234,56 / 31-01-2026) because that matches the
  source statements.
