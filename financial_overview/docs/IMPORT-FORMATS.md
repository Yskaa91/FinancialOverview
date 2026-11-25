# Statement formats: ASN, PayPal, ICS

Reference for the three parsers. Each claim is tagged: **DOC** (vendor
documentation), **CODE** (observable in a working open-source parser),
**COMM** (community reports). Format details that the vendor never published are
flagged as such, so a future fix knows what is spec and what is observation.

Identifiers quoted from the vendor files — column names, transaction codes,
status values — are reproduced verbatim in Dutch because they are the literal
bytes a parser must match. Everything written by us is English.

Rule for every parser: anchor on what is verifiable, version-gate on the header,
and throw a typed error listing the headers seen instead of silently importing
garbage.

## 1. ASN Bank

**What the app offers (2025/2026):** CSV and PDF, plus **CAMT.053 (ISO 20022
XML)** which ASN now recommends. **MT940 is no longer offered** — ASN removed it
(DOC). Old MT940 archives are out of scope.

CSV characteristics (DOC unless tagged):

| Property | Value |
|---|---|
| Extension / name | `.CSV`, `<last10 of IBAN>_<ddmmyyyy>_<volgnummer 8>.CSV` |
| Encoding | "leesbare ASCII"; accept `cp1252` with `utf-8-sig` fallback |
| Delimiter | `,` default, `;` variant exists (COMM) |
| Header row | **none** (COMM) — map by position |
| Quoting | comma variant wraps the narrative in **single quotes `'…'`**; semicolon variant wraps every field in `"…"` (DOC/CODE) |
| Embedded newlines | possible inside `Omschrijving` — join field lines before parsing (CODE) |
| Decimal separator | **`.`**, no thousands separator |
| Sign | signed single amount column, debit negative |
| Dates | `dd-mm-jjjj`, not zero padded (`25-3-2025`) |
| Fees | no fee column; fees are their own `AFB` rows |
| FX | two currency columns per row, **no rate and no original amount column** |

Field order (20 fields observed in 2024; the 2025 doc lists 17):

```
Boekingsdatum, Opdrachtgeversrekening, Tegenrekeningnummer, Naam tegenrekening,
Adres, Postcode, Plaats, Valutasoort rekening, Saldo rekening voor mutatie,
Valutasoort mutatie, Transactiebedrag, Journaaldatum, Valutadatum,
Interne transactiecode, Globale transactiecode, Volgnummer transactie,
Betalingskenmerk, Omschrijving, Afschriftnummer, Categorie
```

A real row (20 fields, comma variant, from a public forum post):

```
10-10-2024,NL21ASNB0123456789,,,,,,EUR,335.31,EUR,-54.16,10-10-2024,10-10-2024,7913,BEA,1062920,,'BP EXPRESS 10.10.2024 11U32 KV004x x11207xx MCC:5542 Contactloze betaling NLNEDERLAND',42,Boodschappen
```

Parser plan: read fields 11 (amount), 9 (balance before), 1/12/13 (dates), 4
(name), 18 (description), and use the **tail** fields for the header-tolerance
check, because the field count grew 18 → 19 → 20 with `Categorie` appended
silently. ASN also ships a **`Categorie`** column of its own — keep it in
`rawJson` and offer it as a rule hint, never as the category.

Sources: ASN "Uitleg transactieoverzicht in ASN Online Bankieren" (30-09-2025);
ASN CAMT.053 page; 2016 export spec mirror; `gpaulissen/ofxstatement-dutch`
plugin `nl-asn`; `cwverhey/HomeBankCSV` (delimiter/quote/newline handling).

## 2. PayPal

Activity → Statements → **Activity Download**, CSV (comma) or TAB. UTF-8 (DOC).
Header always present but **localised to the account language** — the biggest
risk. Dutch header:

```
Datum, Tijd, Tijdzone, Naam, Type, Status, Valuta, Bruto, …, Saldo
```

English:

```
Date, Time, TimeZone, Name, Type, Status, Currency, Gross, Fee, Net, …
```

Safe anchors across eras: `Date`, `Time`, `TimeZone`, `Name`, `Currency`,
`Gross`, `Fee`, `Net`, `From Email Address`, `To Email Address`,
`Transaction ID`, `Reference Txn ID`, `Receipt ID`, `Balance` (DOC).

| Property | Value |
|---|---|
| Sign | signed `Gross`/`Fee`/`Net`; refunds invert; a refund's `Fee` is `0.00` |
| Decimals | "localized": US `.` with quoted thousands, NL reports of `,` (DOC/COMM) |
| Dates | `Date` + `Time` + `TimeZone` in three columns; US `MM/DD/YYYY`, NL `DD/MM/YYYY` |
| IBAN | **none** — identity is the email columns |
| Statuses | `Status` includes `Pending`, `Temporary Hold`, `Reversed`, `Refunded` — filter before counting |
| Splits | >50 000 rows → ZIP where only the first part carries the header |

Parser plan: detect header language (EN/NL at minimum), build a column map by
name, use `Net` for the balance effect and keep `Gross`/`Fee`/`Currency` in
`rawJson`; skip non-final statuses. Cross-currency rows carry the conversion in
the original-currency columns — record the original amount and flag an estimated
rate.

Sources: PayPal activity-download docs; "changed download fields"; NL CSV header
list (`coenfin.nl`); `nils-werner/beancount-paypal` (per-language column packs);
`cmbuckley/paypal-history` (multi-format, hold/refund logic).

## 3. ICS (International Card Services)

**Only CSV is machine readable** — ICS: "transacties zijn uitsluitend te
downloaden in CSV formaat", PDF is display-only (DOC). Mijn ICS → Overzicht →
Downloaden (transacties).

The CSV has **no vendor spec**. Header below is from a real fixture plus two
independent parsers (CODE). Version-gate on it and fail loudly on a mismatch.

```
Transactiedatum;Boekingsdatum;Omschrijving;Naam Card-houder;Card nummer;Debit/Credit;Bedrag;Merchant categorie;Land;Valuta;Bedrag in oorspronkelijke valuta;Type transactie;Wallet provider
```

| Property | Value |
|---|---|
| Encoding | UTF-8 **with BOM**; fall back to `latin-1` (CODE) |
| Delimiter | `;` (CODE) |
| Decimals | `,`, no thousands separator |
| Dates | `dd-mm-yyyy`, two columns (transaction and posting date) |
| Sign | **inverted**: purchases positive (`D`), payments negative (`C`) — use `Debit/Credit` and negate yourself |
| IBAN | **none** — the key is `Card nummer`, masked (`****1234`) |
| FX | `Bedrag` (billed, EUR) **and** `Bedrag in oorspronkelijke valuta`; no rate column, derive it |
| Fees | none; interest and settlement are ordinary rows |
| Statement period | often mid-month to mid-month, not a calendar month (COMM) |
| `Wallet provider` | literal string `null` on normal card rows |

Sample rows (real shape):

```
01-10-2026;02-10-2026;MUSICBOX.COM/BILL CORK IRL;"Jansen, J";****1234;D;9,99;Digital Goods-Multi Categ;IRL;EUR;9,99;Transaction;null
06-09-2026;07-09-2026;ACME* CLOUD PLAN SAN FRANCISCO USA;"Jansen, J";****1234;D;4,29;Computer Software Stores;USA;USD;4,85;Transaction;null
12-09-2026;12-09-2026;GEINCASSEERD VORIG SALDO;"Jansen, J";****null;C;-163,94;;;EUR;-163,94;Payment;null
```

Parser plan: negate `D` rows to negative cents, keep the original amount and
currency, and treat `GEINCASSEERD VORIG SALDO` as the settlement row that pairs
with the bank debit (see the transfer pairing in `docs/ARCHITECTURE.md` §5).

Sources: ICS customer-service page (CSV only); `yholkamp/transactiesinladen`
`example.csv` fixture; `TerrorSource/BankCSV-rompslomp` (`parse_ics_csv`);
`gpaulissen/ofxstatement-dutch` `nl-icscards` (PDF path); `statementbridge`
(masked card, positive-expense convention).

## Reusable parsers (Python, read for the edge cases)

| Repo | Use |
|---|---|
| `gpaulissen/ofxstatement-dutch` | ASN CSV, ICS PDF; Dutch format conventions |
| `cwverhey/HomeBankCSV` | ASN comma+`'` vs semicolon+`"` detection, newline-in-field fix |
| `nils-werner/beancount-paypal` | PayPal per-language column packs |
| `cmbuckley/paypal-history` | PayPal status/refund/FX logic |
| `TerrorSource/BankCSV-rompslomp` | ICS CSV reference reader |
| `kedder/ofxstatement` | Statement model if OFX export is ever wanted |

## Not documented by anyone (write it down in the code)

1. ICS CSV column list, encoding and sign convention — observation only.
2. ASN header-row absence and the real field count.
3. ASN encoding beyond "readable ASCII".
4. PayPal `Balance Impact` column presence and position.
5. PayPal amount localisation for NL accounts — verify against one real export
   before making the parser strict.
