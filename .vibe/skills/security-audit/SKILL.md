---
name: security-audit
description: Load when reviewing or hardening the security of this web app — server actions and input validation, statement parsing and file uploads, the Home Assistant add-on container, secrets handling, security headers, and dependency/supply-chain risk. Also for answering "is this safe to expose?" questions.
license: (MIT AND CC-BY-SA-4.0). See licenses/ — upstream: netresearch/security-audit-skill
metadata:
  source: https://github.com/netresearch/security-audit-skill
  upstream-version: 2.11.13
  vendored-from-commit: c88cb99
  scope: project
---

# Security Audit Skill

Security audit patterns (OWASP Top 10, LLM Top 10 2025, CWE Top 25 2025, CVSS v4.0), cloud/IaC and supply-chain security. Vendored into this repo; `references/` carries the depth and is read on demand.

Upstream relies on shell scanners and PHP/TYPO3 checkpoints for its own test suite; those scripts are **not** vendored here. Nothing in this skill needs a tool you do not already have.

## Expertise Areas

- **Vulnerabilities**: XXE, SQLi, XSS, CSRF, command injection, path traversal, file upload, deserialization, SSRF, SSTI, JWT, type juggling
- **Standards**: OWASP Top 10 / API / LLM (2025), CWE Top 25, CVSS v3.1/v4.0, OWASP ASVS
- **Cloud & IaC**: AWS; Terraform, Kubernetes, Docker, Helm, Ansible
- **API & Frontend**: REST/GraphQL authZ, rate limits, mass assignment, CSP, DOM-XSS
- **AI Agents**: SKILL.md/AGENTS.md/CLAUDE.md/mcp.json/hooks.json audit; prompt injection; excessive agency

## Reference files (in `references/`, `.md` implied)

Read only what the finding needs — the index is the map, not a reading list.

- **Core**: owasp-top10, cwe-top25, xxe-prevention, cvss-scoring, api-key-encryption
- **Prevention**: deserialization-prevention, path-traversal-prevention, file-upload-security, input-validation, error-message-sanitization, ssh-forced-command-hardening
- **Architecture**: authentication-patterns, security-headers, security-logging, cryptography-guide, security-invariants, indistinguishability-defences
- **Language features** (`*-security-features`): javascript-typescript, nodejs, php, python, go
- **Frameworks** (`*-security`): react, typo3, typo3-fluid, typo3-typoscript, symfony, vue
- **Cloud & IaC**: aws-security, iac-security
- **API & Frontend**: api-security, frontend-security
- **AI Agent**: llm-security (OWASP LLM Top 10 2025)
- **Threats**: modern-attacks, cve-patterns
- **DevSecOps**: ci-security-pipeline, supply-chain-security, automated-scanning, gha-security, git-history-secrets
- **Incident**: supply-chain-incident-response

## How to run a review

1. **Map the attack surface first, from code, not from assumptions.** Entry points, trust boundaries, what an unauthenticated caller can reach, what runs with elevated privilege.
2. **State the threat model explicitly** before findings. A LAN-only single-user tool and a public SaaS have different severities; say which one you are judging against and rate accordingly. A finding that is "critical" only under a threat model this app does not have is noise.
3. **Trace data from source to sink.** Every finding needs: the path (`file:line`), the concrete input that triggers it, and what the attacker gets.
4. **Verify before reporting.** A plausible-looking pattern is not a vulnerability. Read the code path end to end, and where a claim is testable, test it.
5. **Rank by CVSS v4.0 severity, then fix cost.** Highest real risk first, not the longest list.
6. **Write the fix, not the wish.** Each finding ends with a specific change: which file, which check, which default.

## Security checklist

- [ ] Dependency audit clean or triaged; no unused production dependencies
- [ ] Server-side validation on every mutation, with a schema at the edge
- [ ] Authorisation checked per action, not per page
- [ ] Output encoding + CSP; no `dangerouslySetInnerHTML` with untrusted data
- [ ] CSRF / origin checks on state-changing endpoints
- [ ] Secrets out of VCS and out of logs; keys redacted in errors
- [ ] Uploads bounded in size and type, parsed defensively, stored outside the web root
- [ ] Security headers: HSTS, X-Content-Type-Options, frame options, referrer policy
- [ ] Container: no elevated capability it does not need, no secret in the image, data volume only where it belongs
- [ ] Error messages sanitized; no stack traces or file paths to the user
- [ ] Audit logging on for destructive actions

## This repository

Next.js 16 (App Router, React 19) + Prisma 7 over SQLite, shipped as a Home Assistant add-on. The app is a single-user, LAN-scoped tool with **no authentication** — that is a deliberate product decision, but it makes exposure the central question: what does an unauthenticated caller on the same network reach?

Where the risk actually lives:

| Area | Path |
| --- | --- |
| Mutation surface | `src/app/**/actions.ts` — every `"use server"` export is a public endpoint |
| Parsers on untrusted input | `src/lib/import/*` (ASN, PayPal, ICS: encodings, CSV, signs) |
| Upload handling | `previewUpload` in `src/app/import/actions.ts` (size cap, hash, preview blob in `Setting`) |
| Rule engine (user regex) | `src/lib/categorize/rules.ts` — `new RegExp(pattern, "i")` on user input |
| AI boundary | `src/lib/categorize/ai.ts` — what text leaves the machine |
| Config and secrets | `.env.local` (dev), add-on options (prod), `scripts/container-env.mjs` |
| Container | `financial_overview/{Dockerfile,run.sh,config.yaml}` — runs as root, published port |
| Persistence | one SQLite file in `/data`; no encryption at rest |

Note the asymmetry in review effort: Prisma parameterises SQL, so injection is a low-yield hypothesis here, while parser robustness, action validation, regex DoS and container exposure are high-yield.

## Verification commands available in this repo

```bash
cd financial_overview
npm audit --omit=dev          # production dependency risk
npm ls --omit=dev --depth=0   # what actually ships
grep -rn '"use server"' src/app --include=*.ts   # enumerate the mutation surface
grep -rn 'dangerouslySetInnerHTML' src
```

If `semgrep`, `trivy`, `gitleaks` or `gh` happen to be installed, run them too — but do not treat their absence as a clean result.

## GitHub Actions security

- **NEVER** interpolate `${{ inputs.* }}` / `${{ github.event.* }}` in `run:` — use `env:`
- Dependency triage: upgrade > override > dismiss. Full patterns: `references/gha-security.md`.

---

Vendored from https://github.com/netresearch/security-audit-skill (v2.11.13, commit c88cb99).
Licenses: MIT and CC-BY-SA-4.0, see `licenses/`. `scripts/`, `evals/` and `checkpoints.yaml` are upstream test scaffolding and were not vendored.
