# FinancialOverview

Persoonlijk overzicht van vermogen, inkomsten en uitgaven. Draait lokaal, op
één machine, met één SQLite-bestand. Imports van ASN, PayPal en ICS, automatische
categorisatie met regels en (optioneel) AI, en handmatige ETF-posities.

Status: **fase 0** — het skelet staat (stack, databaseschema, vier pagina's,
geld- en datumlaag, tests). Importers, categorisatie-UI, portefeuille en grafieken
volgen volgens de fasering in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §12.

## Snel starten

Node 20.9 of hoger nodig (Next.js 16 eist dat).

```bash
npm install
cp .env.example .env        # DATABASE_URL="file:./dev.db"
npx prisma migrate deploy   # maakt dev.db en de tabellen
npm run dev                 # http://localhost:3000
```

Daarna: rekeningen toevoegen op `/accounts`, en importeren via `/import`.

## Commando's

| Commando | Doet |
|---|---|
| `npm run dev` | dev-server op localhost:3000 |
| `npm run build` / `npm start` | productiebuild en -server |
| `npm test` | Vitest: geld-, datum- en (later) parser- en FIFO-tests |
| `npm run lint` | ESLint |
| `npm run db:migrate` | nieuwe migratie na een schemawijziging |
| `npm run db:studio` | Prisma Studio op dev.db |
| `npm run db:generate` | Prisma Client opnieuw genereren |

## Pagina's

| Route | Inhoud |
|---|---|
| `/` | Dashboard: netto vermogen, 30-daagse delta, maandcijfers, grootste categorieën, te categoriseren |
| `/transactions` | Inkomsten & uitgaven: filteren, zoeken, categoriseren, exporteren |
| `/accounts` | Rekeningen: saldo per rekening; detailpagina met transacties, imports en (fase 5) portefeuille |
| `/settings` | Categorieën, regels, merchant-geheugen, AI-status, gegevens |
| `/import` | Wizard in drie stappen (geen tab, knop in de navigatie) |

## Documentatie

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — stack, datamodel, importpijplijn,
  categorisatielogica, portefeuille, fasering, risico's.
- [`docs/IMPORT-FORMATS.md`](docs/IMPORT-FORMATS.md) — exacte bestandsformaten van
  ASN, PayPal en ICS, met bronnen en wat níet gedocumenteerd is.
- [`docs/TOOLING.md`](docs/TOOLING.md) — project-scoped skills en MCP-servers,
  en de designbeslissingen die daaruit volgen.

## UI

Dense dashboard: IBM Plex Sans voor tekst, IBM Plex Mono voor bedragen, 12 px
kaartpadding, 36 px tabelregels, plakkende tabelkoppen, zichtbare focusring en
een skip-link. Tokens staan in `src/app/globals.css`; wijzig ze daar, niet per
component. Ontwerpkeuzes zijn herleidbaar in `docs/TOOLING.md`.

## Regels die niet mogen breken

- Geld is **integer centen**, nooit een float. Zie `src/lib/money.ts`.
- Imports zijn **idempotent**: `Statement.fileHash` en `Transaction.dedupeHash`
  voorkomen dubbele inkomsten bij overlappende periodes.
- Een creditcardrekening heeft een **negatief** saldo; netto vermogen is de som.
- Er gaat niets naar buiten behalve (optioneel) omschrijving + bedrag naar een
  AI-provider en tickers naar Stooq. Geen IBAN's, geen rekeningnamen.
- De app heeft **geen authenticatie** en hoort op `127.0.0.1` te blijven.

## Databestand

`dev.db` staat in de projectroot en is git-ignored. Back-up = bestand kopiëren.
