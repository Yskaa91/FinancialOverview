# Security review — FinancialOverview

> **Status: remediation landed in `90cffac`.** F-01 to F-08 are fixed and covered
> by tests; F-09 is closed by the F-01 guard (an unauthenticated caller can no
> longer reach the AI button); F-10 is accepted, since the advisories are in the
> Prisma CLI and are not reachable from the web surface. What remains open is
> listed at the end under "Still open after remediation".
>
> This document is the review as it was delivered, kept verbatim so the reasoning
> and the ruled-out hypotheses stay on the record. Do not edit the findings to
> match the code; add to the status section instead.

**Repo:** /home/sari/Programming/FinancialOverview · **Commit reviewed:** working tree, clean (`git status` empty)
**Scope:** `financial_overview/src/**`, `prisma/**`, `Dockerfile`, `run.sh`, `config.yaml`, `build.yaml`, `scripts/`, `next.config.mjs`, `.gitignore`, `.vibe/config.toml`. Out of scope: `tests/`, `docs/`, `samples/`, `node_modules`.
**Method:** code reading end to end for every claim, plus executable probes against copies of the parser/rule code in `/tmp` (never against the repo or the real database), plus inspection of the existing `.next` build output and of Next 16.4.6's own source in `node_modules`.

## Threat model (as given, restated)

Single-user personal finance app, Home Assistant add-on, LAN-reachable at `http://<host>:3000` with **no authentication by design**. It ingests bank statements the owner uploads, keeps all state in one SQLite file, and may send merchant text to an AI provider. The questions that matter: what can an unauthenticated LAN caller do beyond reading; what can a malicious page in the owner's browser make the app do; what can malicious statement input do to the parsers; what actually leaves the machine; what does the container expose; where do secrets live.

Judged against that model: no login screen is not a finding. An unauthenticated write that changes financial data is. Availability loss of a locally-hosted single-user tool ranks below silent data corruption, but above cosmetic issues, because it is remotely triggerable and needs no victim action.

## Verdict

**Safe to run on a home LAN: conditionally yes for availability, no for integrity.** Read-only exposure is the intended design and I found no way to escalate it into RCE, SSRF, path traversal, shell execution, SQL injection or XSS. But the write surface is wide open: all 21 UI-referenced Server Actions are invocable by anyone on the LAN with no credential, so a neighbour on the guest Wi-Fi, a compromised IoT device, or a malicious page the owner visits can rewrite categories, hide spending in the Transfers category, fabricate trades and prices to move net worth, delete rules, and commit the owner's staged import without review. Two further flaws are remotely triggerable without any victim: a stored-regEX rule that locks the Node event loop for minutes to forever, and a 1 MB statement upload that makes every `/import` render burn 2–9 seconds of the only thread. The AI boundary is tighter than the code comments claim but not airtight: an IBAN can ride along inside a "merchant" label. The container is a stock root process with the API key in plaintext in two places and no security headers in front of destructive buttons.

**Exposed to the internet, this becomes critical, not merely worse.** The absence of authentication stops being a LAN trust assumption and becomes an open write API to the owner's ledger, the ReDoS becomes a one-request outage, and the AI key — which is only protected by the fact that nothing unauthenticated can read the process environment — sits behind the same surface. Do not port-forward this without putting HA Ingress (or any authenticated reverse proxy) in front and adding per-action authorization first.

---

## Findings

| ID | Severity | Area | File:line | Summary |
|----|----------|------|-----------|---------|
| F-01 | **High** (~8.1, AV:A/AC:L/PR:N/UI:N/VI:H) | Server Actions / authz | `src/app/{transactions,settings,accounts,accounts/[id],import}/actions.ts` | 21 exported actions with no authorization: any LAN caller rewrites, fabricates or erases financial data |
| F-02 | **High** (~7.1, VA:H) | Rule engine / ReDoS | `src/lib/categorize/rules.ts:59` + `src/app/settings/actions.ts:73-87` | User-writable REGEX rules run `new RegExp` over unbounded statement text: catastrophic backtracking wedges the whole app |
| F-03 | Medium (~5.7) | Import preview / DoS | `src/app/import/actions.ts:83,140,174-175`, `src/lib/import/duplicates.ts:52` | 1 MB upload → 37k rows, 13.7 MB Setting blob, 2.3–8.8 s of blocked event loop per page view; `Math.min(...)` throws at 125k rows |
| F-04 | Medium (~5.9, browser-driven) | CSRF / headers / framing | `next.config.mjs:2-16` (no `headers()`), Next `action-handler.js:440-460` | Origin check compares Origin against Host, so DNS rebinding defeats it; zero security headers, so clickjacking of destructive buttons always works |
| F-05 | Medium (~4.8, privacy) | AI boundary | `src/lib/categorize/recurrence.ts:40-43` → `ai.ts:56-66` | The "merchant label" is the raw description when merchant extraction fails, so IBANs, card fragments and counterparty names can leave the machine |
| F-06 | Medium (~5.3) | Container / secrets at rest | `Dockerfile:42-62`, `run.sh:14-24`, `config.yaml:28` | Runs as root, API key in `/tmp/options.env` (0644, never removed) and plaintext `/data/options.json` that lands in every HA backup |
| F-07 | Low (~2.3) | Error handling / logging | `src/app/settings/actions.ts:33-40`, `src/app/accounts/[id]/actions.ts:72`, `src/lib/queries/transactions.ts:35` | Unvalidated ids/params reach Prisma uncaught → 500 with query arguments (financial fields) in the HA log |
| F-08 | Low (~3.1) | Import atomicity | `src/app/import/actions.ts:448` vs `:461-527` | `Statement` row is created outside the transaction: a mid-way failure permanently blocks re-import of that file hash and strands the preview |
| F-09 | Low (~2.9) | AI spend | `src/app/transactions/actions.ts:68`, `src/app/import/actions.ts:305` | Unauthenticated, unthrottled AI runs on the owner's key (up to 5 provider calls per request, unlimited requests) |
| F-10 | Low (~2.1) | Dependencies | `package.json:15,19` | 3 high advisories (`effect` ReDoS) via `prisma`; not reachable from HTTP input, but the CLI ships in the runtime image |

*(17 further hypotheses were tested and ruled out — see "Verified safe". Nothing was dropped for space; the list above is everything I could substantiate.)*

---

## F-01 — Unauthenticated write surface across all Server Actions

**What.** Five `"use server"` modules export 22 functions, and Next registers every one as an RPC endpoint keyed by a 42-hex id (`server-reference-manifest.json` lists all 22). Twenty-one are referenced by the UI, so their ids are served to any caller in page HTML (`$ACTION_ID_…` on `<form action={…}>`) or in `.next/static` chunks. The id is the only capability, and it is public: `grep -rn 'authoriz\|authenticat\|getSession\|requireAuth' src/` returns zero hits.

**Attack path.** From any LAN host: `GET /settings`, read the `markAsTransfer` id, then `POST /settings` with `Next-Action: <id>` and `transactionId=<any>` — that row becomes a Transfers row with `reviewState=OK`. Same for `setCategory` (scope `merchant` rewrites a whole merchant), `addTrade`/`setPrice` (fabricate a holding or quote, moving net worth and the charts), `deleteTrade`, `deleteRule`/`toggleRule`/`updateRule`, `deleteCategory`, `forgetMerchant`, `createAccount`. `commitPreview` with an empty body commits whatever the owner staged, applying attacker-chosen categories and importing duplicates the owner had not reviewed.

**Impact.** Silent, persistent corruption of the ledger the owner makes decisions from — the outcome the brief calls out. `markAsTransfer` is sharpest: it removes real spending from every total without deleting a row, so the books still reconcile. No victim action required.

**Fix.** One gate at the top of every exported action: `requireOwner()` in `src/lib/auth.ts`, comparing a shared secret from the add-on options against an `HttpOnly; SameSite=Strict` cookie set by a one-time `/unlock` form. Cheaper and better for HA: `ingress: true` in `config.yaml`, drop `ports:`, bind `--hostname 127.0.0.1` in `run.sh:32`, so the Supervisor's authenticated proxy is the only path in. Also delete or validate `archiveAccount` (`accounts/actions.ts:53`), which is referenced by nothing and validates nothing.

---

## F-02 — Catastrophic backtracking in user-supplied REGEX rules

**What.** `ruleMatches` compiles and runs a stored pattern against transaction text for every row (`rules.ts:56-62`), with a `try/catch` for syntax only — no time or complexity limit. Patterns are written by `createRule` (`settings/actions.ts:73-87`), which skips the `compiles()` check that `updateRule` performs (`:117`), and may be 120 chars (`:68`) — ample for `(a+)+$`. The tested value, `txn.description`, is never length-capped by the parsers (`asn.ts:56`, `ics.ts:54`, `paypal.ts:78`).

**Attack path.** `POST createRule` with `operator=REGEX`, `matchOn=DESCRIPTION`, `pattern=(a+)+$`; then trigger any classification path — upload a small ASN file whose field 17 is a few thousand `a`s and load `/import` (`loadReview` → `classifyPreview` → `resolveCategory` → `ruleMatches`), or call `runRules`. Measured on this repo's rule code: 28 characters = 19 s; 30 characters = past a 30 s timeout; growth is exponential and statement text can be megabytes. The rule persists in SQLite, so every later `/import` render and every `categoriseUncategorised()` re-enters it — the app stays wedged across restarts until someone edits the DB.

**Impact.** Total, restart-surviving loss of availability of the single-threaded server from two unauthenticated POSTs — and, more likely in practice, from a legitimate user pasting a bad pattern into the rules editor.

**Fix.** In `rules.ts:56`, cap what the regex sees (`value.slice(0, 512)`) and memoise `new RegExp` per pattern (currently rebuilt per row). Reject nested quantifiers at write time in `settings/actions.ts` (`/(\([^)]*[+*][^)]*\)[+*])/`) and run `compiles()` in `createRule` too. Stronger: drop the `REGEX` operator — `CONTAINS`/`EQUALS` cover every sample rule in the repo.

---

## F-03 — Preview blob is the app's own decompression bomb

**What.** `previewUpload` reads the upload into memory, parses it, and stores every row — including `rawJson`, the whole CSV record — as one JSON string in `Setting.valueJson` (`import/actions.ts:83,147`). No parser caps row count (`asn.ts:34-72`). The blob is re-read and re-parsed on every render of `/import` (`:269` → `loadReview` → `classifyPreview` + `loadDuplicateCandidates`), and that duplicate window is the preview's own min/max dates ±14 days (`:174-179`), so rows dated 1970 and 2200 pull the entire transaction table into memory; `findDuplicateCandidates` then loops incoming × existing (`duplicates.ts:52`).

**Measured** on copies of the real code: a 1 MB file of minimal 27-byte rows → 37,037 rows, 310 ms parse, 13.7 MB blob; the duplicate scan costs 561 ms against 1,000 historic rows, 2.3 s against 5,000, 8.8 s against 20,000 — per render, with the preview alive until cancelled. At 5 MB the same trick yields 185,185 rows and `Math.min(...dates)` (`:140`) throws `RangeError: Maximum call stack size exceeded` (spread limit ≈125,259), crashing that upload. Separately, the `5_000_000` check at `:84` is dead code — Next's action body limit defaults to 1 MB (`action-handler.js:513`, never raised in `next.config.mjs`) — so a genuine 2 MB statement gets a raw 413 before the friendly error path runs.

**Impact.** Any LAN caller makes the app unusable in slow motion for the price of one upload, and can evict the owner's own staged import.

**Fix.** Cap rows per statement in each parser (5,000), cap the serialized preview (~4 MB), bucket `duplicates.ts:52` by `amountCents` in a `Map`, replace `Math.min(...)` with a loop, and set `serverActions.bodySizeLimit: "5 MB"` — or lower the in-code cap to 1 MB so the message matches reality.

---

## F-04 — CSRF protection is satisfiable by DNS rebinding; framing is unprotected

**What.** No `middleware.ts` and no `headers()` in `next.config.mjs` (`:2-16`): no CSP, no `X-Frame-Options`/`frame-ancestors`, no `nosniff`, no `Referrer-Policy`. Next 16.4.6's action guard derives `originHost` from `Origin` and compares it to `Host`, and lets requests with no `Origin` through on a warning (`action-handler.js:440-460`).

**Attack path A (rebinding).** The owner visits `http://evil.example`; its DNS first answers with the attacker, then re-resolves to `192.168.1.50` on a short TTL. The page posts to `http://evil.example:3000/<page>` with `Next-Action: <stolen-id>`; the browser sends `Host: evil.example:3000` and `Origin: http://evil.example:3000`, which Next compares and accepts. The same trick reads every page — same-origin after rebinding, so no CORS wall. This is the browser-side counterpart to F-01 and needs no LAN position, only that the owner loads one page.

**Attack path B (framing).** Nothing prevents framing, so an attacker page frames `http://192.168.1.50:3000/settings` and overlays a button on "remove"/"Run rules". That click is genuinely same-origin with a real `Origin` header, so the origin check is irrelevant.

**Fix.** Add `async headers()` in `next.config.mjs`: `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'; default-src 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Add a `Host` allowlist that refuses anything but the configured hostname/IP — that is what kills path A; `serverActions.allowedOrigins` only widens the comparison. The F-01 gate neutralises both.

---

## F-05 — The AI prompt can carry an IBAN inside the "merchant" label

**What.** `AGENTS.md` promises "Only descriptions, amounts and category names… No IBANs, no account names", and `settings/page.tsx:177` tells the user "never IBANs". The prompt is built from `AiGroupInput.label` (`ai.ts:56-66`), fed by `groupLabel(txn)` (`ai.ts:242-247`) or `classifyPreview`'s `group.label` (`classify.ts:47`). `groupLabel` takes `(row.merchant?.trim() || row.description).slice(0, 32)` (`recurrence.ts:40-43`) — the **raw** description. `merchantKeyOf` strips IBAN-shaped tokens (`recurrence.ts:15,26`); `groupLabel` does not.

**Condition.** Not attacker-driven; it fires on a normal run whenever `extractMerchant` returns null (`normalize.ts:49-55`) — transfer wording with no counterparty, or first words containing digits (`normalize.ts:94`). A row like `SEPA NL91ABNA0417164300 J DOE` with an empty counterparty column is exactly that, and `cleanDescription` (`asn.ts:56`) strips card-terminal noise but not IBANs. The first 32 characters then go to `api.mistral.ai` as `1|<label>|<amount>`. The counterparty column usually saves it, which is why this is Medium — but it is silent and contradicts a documented invariant.

**Rest of the claim verified:** the body carries only label, dominant amount `/100`, row count and the category taxonomy (`ai.ts:50-70`) — no IBAN column, balances, account names or filenames. The batch cap and 20 s timeout hold (`ai.ts:18,157,191`), and the reply parser maps integers to indices only (`ai.ts:96-133`), so a hostile model cannot inject a category id or a rule.

**Fix.** `recurrence.ts:40`: return `normalise(raw).slice(0, 32) || "UNKNOWN"`, so the label is the same scrubbed text the key uses; additionally drop labels matching `/[A-Z]{2}\d{2}[A-Z0-9]{6,}/` in `buildMessages` (`ai.ts:56`). Correct the sentence at `settings/page.tsx:177` to match what is enforced.

---

## F-06 — Root container, and the API key in two plaintext places plus every backup

**What.** `Dockerfile:42-62` has no `USER`, so the app runs as uid 0 and `/data` is root-owned. `run.sh:18-23` writes `/tmp/options.env` from `/data/options.json` and never deletes it, leaving `AI_API_KEY=…` in clear text at the default umask (0644) for the container's life. `/data/options.json` itself holds `ai_api_key` plaintext (`config.yaml:28` — `password` only masks the UI), and `backup: cold` (`config.yaml:12`) copies it into every HA snapshot. Positives: the image carries no `.env*`, `dev.db` or `.git` (`.dockerignore:9-10`), there is no build-time secret (`Dockerfile` sets only `DATABASE_URL`/`PORT`), and `scripts/container-env.mjs:23` quotes correctly, so a key containing `'`, `$(…)` or newlines cannot inject into `run.sh`.

**Impact.** Any code execution in the container (none found — this is defence in depth) is root with the ledger writable; the key is readable to any process there and travels inside every backup the owner shares.

**Fix.** Add `USER node` plus `RUN mkdir -p /data && chown node:node /data`. In `run.sh`, stop writing a file — `eval "$(node scripts/container-env.mjs /data/options.json)"` — or at minimum `umask 077` before the redirect and `rm -f /tmp/options.env` after sourcing. Document that backups contain the key.

---

## F-07 — Unvalidated ids and params reach Prisma uncaught; errors carry query data

**What.** Several actions trust a string straight into Prisma with no existence check: `createCategory` passes `parentId` through unchecked (`settings/actions.ts:33-40`) → FK violation; `deleteTrade` (`accounts/[id]/actions.ts:72`), `deleteRule` (`settings/actions.ts:137`), `archiveAccount` (`accounts/actions.ts:53-54`) → `P2025` on any unknown id; `toggleRule` checks first, `forgetMerchant` does not. `listTransactions` receives `page: Number(first(sp.page) ?? 1)` (`transactions/page.tsx:22`), and `Math.max(1, NaN)` is `NaN`, so `?page=abc` sends `skip: NaN` into Prisma (`queries/transactions.ts:41`). Nothing catches these, so Next returns its 500 page and prints the Prisma error — which for validation failures quotes the offending arguments, i.e. statement rows, amounts and descriptions — into the add-on log the owner is invited to paste into issue trackers.

**Impact.** Cosmetic-to-low: a reproducible 500 on `?page=abc` and on any stale id (which the UI itself can produce in a second tab), plus financial fields in logs. No data is corrupted. Caveat worth stating: the `?error=` and `?aiError=` values taken from the URL are interpolated into text but escaped by React (`import/page.tsx:25-27`, `transactions/page.tsx:74-79`), so this is not XSS; the only ugly edge is that a 1 MB header row produces an oversized `Location` header via `redirect(`/import?error=...`)` in `import/actions.ts:100`.

**Fix.** Wrap each action body in a `try/catch` that maps Prisma codes (`P2025`, `P2003`, `P2002`) to a redirect/returned message, and reject non-finite paging (`const page = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1`). Validate `parentId` with `z.string().cuid().optional()` plus an existence check.

---

## F-08 — Non-atomic commit can permanently block re-import of a file

**What.** `commitPreview` creates the `Statement` row at `import/actions.ts:448` — **outside** the `prisma.$transaction` that starts at `:461` — and deletes the preview only after the transaction (`:533`). If anything throws inside the transaction (disk full, `SQLITE_BUSY` from a concurrent request, an integer that SQLite refuses), the statement row survives with `rowCount > 0` and `importedCount` unset, its `fileHash` is now taken, and `previewUpload`'s idempotency check (`:88-89`) will reject the same file forever with `?error=already-imported`. The zero-amount/oversized-amount paths are also unguarded: `parseAmountToCents` has no magnitude cap (`money.ts:83`), so a 30-digit amount becomes ~1e32 cents and is handed to SQLite as-is.

**Impact.** Low under this model, but nasty: the owner sees "already imported, nothing was changed" for a statement that was never imported, with an empty statement row in the DB and no way to retry without DB surgery.

**Fix.** Move `prisma.statement.create` inside the `$transaction` (create then `createMany` with the returned id in one `tx`), and `deleteMany` the preview in the same commit path. Clamp `parseAmountToCents` to a sane bound (`Math.abs(total) > 1e15 → null`).

---

## F-09 — Unauthenticated AI spend on the owner's key

**What.** `suggestWithAi` (`transactions/actions.ts:68`) and `suggestForPreview` (`import/actions.ts:305`) call the provider with the owner's key. The only limits are per-invocation (`AI_MAX_BATCHES`, default 5, `ai.ts:18,191`) and there is no quota, no cooldown and no authorization. A LAN caller can POST either action in a loop; each allocates up to 5 billed completions. `suggestForPreview` additionally requires a preview to exist, which the caller can upload themselves in one request.

**Impact.** Direct monetary cost and provider-side rate-limit exhaustion; also makes the "AI is off by default" posture meaningless once the owner enables it. Not data-integrity.

**Fix.** Same gate as F-01 (this closes it), plus a cheap per-hour counter persisted in `Setting` (e.g. `aiCallsThisHour`) checked in `proposeForPreview`, and honour HTTP 429 from the provider by stopping the batch loop (`ai.ts:191-200` currently aborts the whole run on the first failure, which is the right shape).

---

## F-10 — Dependency advisories: unreachable, but the CLI ships to production

**What.** `npm audit --omit=dev` reports 3 high advisories in `effect` (ReDoS in `Schema.TemplateLiteral` compilation, GHSA-7589-6fvf-x4pw) reached via `@prisma/config` ← `prisma`, which is a **runtime** dependency here (`package.json:19`) because `run.sh:30` runs `npx prisma migrate deploy` on every boot. Not reachable from HTTP input: the vulnerable path compiles Prisma schema strings, and no user input reaches it. `next@16.4.6`, `react@19.3.0`, `zod@4.6.7`, `better-sqlite3@13.2.0` and the three chart/icon libraries are clean. No unused production dependencies: `dotenv` is used by `prisma.config.ts:1`, `better-sqlite3` is the adapter's peer, `lucide-react` by `nav.tsx`, `recharts` by the three chart components.

**Impact.** Informational — supply-chain surface and a noisy audit, not an exploitable weakness.

**Fix.** Let the advisory ride, or move `migrate deploy` into the image build so `prisma` can become a devDependency and vanish from the runtime layer (`Dockerfile:34` then ships one fewer package tree). Track the effect upgrade in Prisma's next patch.

---

## Verified safe — hypotheses I tested and ruled out

Each line: the attack I looked for, and why it does not work here.

- **SQL injection** — no `$queryRaw`/`$executeRaw` anywhere in `src/` (grep), all access through Prisma's parameterised client (`src/lib/queries/*.ts`), `contains` filters are escaped by Prisma.
- **XSS** — zero `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` in `src/`; every statement field (description, merchant, filename, headers seen) is rendered as a React text node or attribute (`review-dialog.tsx`, `settings/page.tsx`, `import/page.tsx`), so React escapes it. The `?error=`, `?aiError=`, `?done=` values are reflected as text only (`import/page.tsx:25-27`, `transactions/page.tsx:74-79`).
- **Prototype pollution via CSV headers** — `mapColumns`/`rawRecord` in `ics.ts:76-92` and `paypal.ts:100-113,138-143` do use header-derived keys, but every assigned value is a string, and `obj["__proto__"] = "string"` is a no-op (probe: `Object.prototype` unchanged, `hasOwnProperty('__proto__')` false). Consequence is a data-quality bug — a column literally named `__proto__` or `constructor` is silently dropped — not a security one.
- **Server Actions reachable by GET** — `getServerActionRequestMetadata` requires `req.method === 'POST'` for all three action shapes (`node_modules/next/dist/server/lib/server-action-request-meta.js:33-36`), so the `<img src>`/link CSRF primitive does not exist; every mutation needs a POST.
- **The classic cross-site form POST** — Next compares `Origin` against `Host` and aborts on mismatch (`action-handler.js:440-460`); a form on `http://evil.example` posting to `http://192.168.1.50:3000` is rejected. (The rebinding variant that *does* work is F-04.)
- **AI API key in the browser** — grepped the existing `.next` build: no `mstrl_` anywhere; `AI_API_KEY` appears only as an environment-variable *name* inside `.next/server/chunks/ssr/…`; `.next/static/**` (what the browser actually downloads) has zero hits for `AI_API_KEY`, `AI_MAX_BATCHES` or the key value. `AI_MODEL`/`AI_MAX_BATCHES` remain runtime `process.env` lookups in the built chunk (`process.env.AI_MODEL??"mistral-small-latest"`), not build-time inlines.
- **Secrets in git** — `.env.local`, `.env` and `dev.db` are untracked and ignored (`.gitignore:32,43`); `git log --all` for the key pattern returns only documented placeholders in `.env.example`/`README.md`; no key material in any commit.
- **Secrets in the image** — `.dockerignore` excludes `.env*`, `dev.db`, `tests`, `.git`; the runner stage copies only `node_modules`, `.next`, `public`, `package.json`, config, `prisma/`, `scripts/container-env.mjs` and `run.sh` (`Dockerfile:50-58`). No `ARG`/`ENV` secret.
- **Shell injection through the options mapping** — `scripts/container-env.mjs:23` single-quotes and escapes `'` as `'\''`, so a key with quotes, `$(…)`, newlines or `;` stays inert when sourced; only the six whitelisted names are emitted (`:14-21,33-35`). The residual issues are file permissions and lifetime, reported as F-06.
- **Command injection / fs access in the app** — no `child_process`, `exec`, `readFile`, `writeFile` or `path.join` anywhere in `src/`; the only `fs` use is `container-env.mjs` reading a fixed path. No upload is ever written to disk; bytes stay in memory and in SQLite.
- **SSRF** — exactly one outbound `fetch` in the app (`accounts/[id]/actions.ts:124`): fixed host `stooq.com`, ticker from the DB (validated `.max(12).toUpperCase()` on entry), `encodeURIComponent`, 5 s timeout. The AI endpoint is a constant (`ai.ts:21`); the model name from options only lands in the JSON body. No user-controlled URL reaches a fetcher.
- **Open redirect** — every `redirect()` target is a literal with encoded text appended (`import/actions.ts:77-100,383-544`, `transactions/actions.ts:69-76`); no `?next=` style parameter exists.
- **Path traversal** — no filesystem paths are derived from input; the SQLite URL is a fixed env value.
- **Unauthenticated file read of the DB** — `dev.db` sits in the repo working tree (270 KB, git-ignored) but is never served: no route serves files outside `public/`, and `.next/static` contains only compiled assets.
- **Regex DoS in the canned patterns** — the fixed `NOISE`/`TRANSFER_WORDING`/`IBANISH` regexes (`normalize.ts:18-31`, `recurrence.ts:13-16`) and `detectSource`'s sniffers (`import/index.ts:36-42`) are linear; I checked each for nested quantifiers over overlapping classes and found none.
- **CSV tokenizer blowup** — `parseCsv` (`csv.ts:12-80`) is a single linear pass with no backtracking; a 4 MB unterminated quote costs 180 ms and yields one field (measured), so the "swallow the file" behaviour is bounded by the body limit, not quadratic.
- **Encoding tricks** — `decodeStatementBytes` (`import/index.ts:70-74`) falls back to windows-1252 only when UTF-8 produced U+FFFD; no exception path, no double decode.

## Top 5 to fix this week

1. **Put a credential in front of every action (F-01, F-09).** Cheapest effective fix: `ingress: true` in `config.yaml`, drop the `ports:` mapping, and `--hostname 127.0.0.1` in `run.sh:32` — the Supervisor authenticates for you and the action surface stops being public. If the published port must stay, add `requireOwner()` (one shared cookie, `HttpOnly; SameSite=Strict`) as the first line of each exported action; ~25 call sites, no schema change.
2. **Defang the rule engine (F-02).** Three lines in `src/lib/categorize/rules.ts:56` and `settings/actions.ts:73`: slice the tested value to 512 chars, cache compiled regexes, and run `compiles()` in `createRule` — plus reject nested quantifiers before storing. Stops the only one-request, restart-surviving outage I found.
3. **Bound the import preview (F-03).** Cap parser rows at 5,000, refuse a serialized preview over 4 MB, bucket `duplicates.ts:52` by amount, replace `Math.min(...)` at `import/actions.ts:140,175` with a loop, and align `bodySizeLimit` with the 5 MB the UI advertises.
4. **Add response headers and a Host allowlist (F-04).** `async headers()` in `next.config.mjs` with `frame-ancestors 'none'`/`X-Frame-Options: DENY`, plus a Host check that refuses anything but the configured hostname — that closes clickjacking and the DNS-rebinding bypass in one edit.
5. **Scrub the AI label and dry up the key's copies (F-05, F-06).** One line in `recurrence.ts:40` (`normalise(raw)`) keeps IBANs out of the prompt; `umask 077` + `rm -f /tmp/options.env` in `run.sh` and `USER node` in the `Dockerfile` cut the plaintext-key surface to `/data/options.json` alone.

---

### Notes on scope discipline

- `tests/fixtures/*` and `samples/*.csv` were not audited as code; nothing in them is reachable at runtime.
- `financial_overview/.env.local` holds a live-looking Mistral key (`mstrl_…`, untracked — verified absent from git history and from the image). It is not a finding, but rotate it if this tree was ever shared or copied.
- The `dev.db` in the working tree contains real-looking seed data; it is ignored by both git and Docker.
- No `semgrep`, `trivy` or `gitleaks` was run; their absence is not a clean result, but the grep-based checks listed under "Verified safe" cover the same ground for this codebase size.

---

## Still open after remediation

These are known and deliberate, not oversights:

- **Runs as root.** Home Assistant add-ons run as root by convention. A non-root
  user would need a chown step at start and would still be one process compromise
  away from the volume.
- **No encryption at rest.** `/data/financial.db` is a plain SQLite file; the
  protection is the filesystem and the backup destination.
- **The access password is stored in `/data/options.json`**, so every add-on
  backup contains it together with the API key. Treat backups as secret material.
- **The session cookie is not `Secure`** (the add-on is served over plain HTTP on
  a LAN) and there is no lockout table: one account, 600 ms delay on failure.
- **CSP allows `'unsafe-inline'` for scripts.** A nonce requires middleware, and
  Next 16's middleware has no Node runtime configured here, so it cannot verify
  the session cookie. It still blocks foreign script origins and framing.
- **F-03's bounded case remains bounded, not eliminated.** A statement at the
  20.000-row cap still costs a few seconds to group and classify; the cap turns a
  hang into a slow render.
- **A spaced account number is redacted, an arbitrary future format is not.**
  `redactLabel` covers the shapes seen in real exports; a new one needs a new
  pattern.
