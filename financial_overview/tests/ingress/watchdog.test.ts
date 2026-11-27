// The Supervisor's watchdog polls one URL and treats only 200 and 302 as alive.
// "/" is a 307 to /login whenever an access password is set, so a watchdog
// pointed back at the root restarts a healthy app every two minutes. This test
// keeps that from happening again.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const config = readFileSync(join(ROOT, "config.yaml"), "utf8");

function watchdogPath(): string {
  const line = /^watchdog:\s*(\S+)\s*$/m.exec(config);
  if (!line) throw new Error("config.yaml has no watchdog");
  return line[1].replace("http://[HOST]:[PORT:3000]", "");
}

describe("add-on watchdog", () => {
  it("polls a dedicated route, never the root", () => {
    expect(watchdogPath()).toBe("/api/health");
  });

  it("points at a route that exists and needs no session", () => {
    const route = join(ROOT, "src/app", watchdogPath(), "route.ts");
    expect(existsSync(route)).toBe(true);
    expect(readFileSync(route, "utf8")).not.toContain("requireSession");
  });
});
