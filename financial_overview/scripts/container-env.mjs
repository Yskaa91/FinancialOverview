// Turns /data/options.json (written by Home Assistant from the add-on options)
// into shell assignments. Kept out of run.sh so it can be tested directly:
//
//   node scripts/container-env.mjs <options.json>
//
// Values are single-quoted with POSIX escaping, so an API key containing quotes,
// spaces or $(...) stays inert.

import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "/data/options.json";

/** add-on option name -> environment variable the app reads */
const MAP = {
  access_password: "ACCESS_PASSWORD",
  ai_provider: "AI_PROVIDER",
  ai_api_key: "AI_API_KEY",
  ai_model: "AI_MODEL",
  ai_max_batches: "AI_MAX_BATCHES",
  min_hits_for_rule: "MIN_HITS_FOR_RULE",
  price_fetch: "PRICE_FETCH",
};

const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

let options = {};
try {
  options = JSON.parse(readFileSync(path, "utf8"));
} catch {
  // No options file yet (first start, or running outside Home Assistant).
  options = {};
}

for (const [key, variable] of Object.entries(MAP)) {
  const value = options[key];
  if (value === undefined || value === null || value === "") continue;
  process.stdout.write(`${variable}=${quote(value)}\n`);
}
