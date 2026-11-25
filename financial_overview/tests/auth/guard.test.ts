import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const { cookieStore, redirectMock } = vi.hoisted(() => ({
  cookieStore: {
    value: undefined as string | undefined,
    set: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  },
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "fo_session" && cookieStore.value ? { value: cookieStore.value } : undefined),
    set: cookieStore.set,
    delete: cookieStore.delete,
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { requireSession, sessionToken, startSession } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.value = undefined;
  delete process.env.ACCESS_PASSWORD;
});

describe("session guard", () => {
  it("lets everything through when no password is configured", async () => {
    await expect(requireSession()).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to the login page without a cookie", async () => {
    process.env.ACCESS_PASSWORD = "correct horse";
    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("accepts the cookie derived from the configured password", async () => {
    process.env.ACCESS_PASSWORD = "correct horse";
    cookieStore.value = sessionToken("correct horse");
    await expect(requireSession()).resolves.toBeUndefined();
  });

  it("rejects a cookie derived from another password", async () => {
    process.env.ACCESS_PASSWORD = "correct horse";
    cookieStore.value = sessionToken("wrong horse");
    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("rejects a malformed cookie without throwing on length mismatch", async () => {
    process.env.ACCESS_PASSWORD = "correct horse";
    cookieStore.value = "short";
    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("only starts a session for the right password", async () => {
    process.env.ACCESS_PASSWORD = "correct horse";
    await expect(startSession("wrong horse")).resolves.toBe(false);
    expect(cookieStore.set).not.toHaveBeenCalled();

    await expect(startSession("correct horse")).resolves.toBe(true);
    expect(cookieStore.set).toHaveBeenCalledWith("fo_session", sessionToken("correct horse"), expect.anything());
  });

  it("signs every session out when the password changes", async () => {
    process.env.ACCESS_PASSWORD = "first";
    const oldCookie = sessionToken("first");
    process.env.ACCESS_PASSWORD = "second";
    cookieStore.value = oldCookie;
    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

// The guard is only worth anything if it is actually called. This walks the real
// sources and fails the build when a future action or page forgets it.
describe("every entry point calls the guard", () => {
  const appDir = join(process.cwd(), "src", "app");

  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return files(path);
      return entry.name === "actions.ts" || entry.name === "page.tsx" ? [path] : [];
    });

  const guarded = (source: string, signature: string): boolean => {
    const index = source.indexOf(signature);
    if (index === -1) return true;
    const body = source.slice(source.indexOf("{", index), source.indexOf("{", index) + 200);
    return body.includes("await requireSession();");
  };

  it("guards every exported server action", () => {
    const offenders: string[] = [];
    for (const file of files(appDir)) {
      if (!file.endsWith("actions.ts")) continue;
      const source = readFileSync(file, "utf8");
      if (!source.includes('"use server"')) continue;
      // The login action is the one endpoint that must stay reachable.
      if (file.endsWith(`${join("login", "actions.ts")}`)) continue;
      for (const match of source.matchAll(/export async function (\w+)\(/g)) {
        if (!guarded(source, match[0])) offenders.push(`${file}:${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("guards every page except the login page", () => {
    const offenders: string[] = [];
    for (const file of files(appDir)) {
      if (!file.endsWith("page.tsx")) continue;
      if (file.endsWith(`${join("login", "page.tsx")}`)) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/export default async function \w+\(/g)) {
        if (!guarded(source, match[0])) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
