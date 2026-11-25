#!/usr/bin/env bash
# Home Assistant add-on entrypoint.
set -euo pipefail

cd /app

# Home Assistant gives the add-on one persistent directory. Everything the user
# cannot afford to lose has to live there: the SQLite database is the whole
# application state.
export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1
export DATABASE_URL="${DATABASE_URL:-file:/data/financial.db}"

mkdir -p /data

# Add-on options -> environment. The app reads the same variable names it reads
# from .env in development, so there is one code path, not two.
#
# The generated file holds the API key and the access password, so it is created
# under a private umask and deleted as soon as it has been sourced: a leftover
# 0644 file in /tmp is readable by anything else in the container.
if [ -f /data/options.json ]; then
  umask 077
  node scripts/container-env.mjs /data/options.json > /tmp/options.env
  set -a
  # shellcheck disable=SC1091
  . /tmp/options.env
  set +a
  rm -f /tmp/options.env
fi

if [ -z "${ACCESS_PASSWORD:-}" ]; then
  echo "[financial_overview] WARNING: no access password set - the web interface is open to everything that can reach this host on port 3000. Set the 'Access password' add-on option." >&2
fi

echo "[financial_overview] database: ${DATABASE_URL}"
echo "[financial_overview] ai: ${AI_PROVIDER:-none} (${AI_MODEL:-unset}), price refresh: ${PRICE_FETCH:-disabled}"
echo "[financial_overview] login: $([ -n "${ACCESS_PASSWORD:-}" ] && echo required || echo disabled)"

# Migrations are idempotent and safe to run on every start.
npx prisma migrate deploy

exec npx next start --hostname 0.0.0.0 --port 3000
