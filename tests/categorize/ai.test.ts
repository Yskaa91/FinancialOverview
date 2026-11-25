import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_MODEL,
  buildMessages,
  isAiConfigured,
  parseSuggestions,
  proposeForPreview,
  suggestForUncategorised,
  suggestGroupCategories,
  type AiGroupInput,
} from "@/lib/categorize/ai";
import type { CategoryOption } from "@/lib/review/types";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const categories: CategoryOption[] = [
  { id: "c1", name: "Groceries", kind: "EXPENSE" },
  { id: "c2", name: "Transport", kind: "EXPENSE" },
  { id: "c3", name: "Dining out", kind: "EXPENSE" },
  { id: "c4", name: "Rent", kind: "EXPENSE" },
  { id: "c5", name: "Energy", kind: "EXPENSE" },
  { id: "c6", name: "Health", kind: "EXPENSE" },
  { id: "c7", name: "Insurance", kind: "EXPENSE" },
  { id: "c8", name: "Subscriptions", kind: "EXPENSE" },
  { id: "c9", name: "Shopping", kind: "EXPENSE" },
  { id: "c10", name: "Travel", kind: "EXPENSE" },
  { id: "c11", name: "Fees", kind: "EXPENSE" },
  { id: "c12", name: "Income", kind: "INCOME" },
  { id: "c13", name: "Savings", kind: "TRANSFER" },
  { id: "c14", name: "Transfers", kind: "TRANSFER" },
];

const groups: AiGroupInput[] = [
  { key: "ALBERT HEIJN", label: "Albert Heijn 1234", amountCents: -5432, rows: 3 },
  { key: "SHELL", label: "Shell Station | Utrecht", amountCents: -6800, rows: 1 },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildMessages", () => {
  it("stays tiny: one system line, numbered categories", () => {
    const [system, user] = buildMessages(groups, categories);

    expect(system.role).toBe("system");
    expect(system.content).toContain("1=Groceries; 2=Transport");
    expect(system.content).toContain("14=Transfers");
    expect(system.content).toContain("0 = unsure");
    expect(system.content.length).toBeLessThan(340); // a few dozen tokens, not a paragraph
    expect(user.role).toBe("user");
  });

  it("spells out the reply shape, because a real model skipped lines with i:0", () => {
    const [system] = buildMessages(groups, categories);
    expect(system.content).toContain("One object per line");
    expect(system.content).toContain("i = the line number, echo it back");
    expect(system.content).toContain('{"r":[{"i":1,"c":2}]}');
  });

  it("sends one line per group, not per transaction, with an Nx marker", () => {
    const [, user] = buildMessages(groups, categories);
    expect(user.content.split("\n")).toHaveLength(2);
    expect(user.content).toContain("1|Albert Heijn 1234|-54.32|3x");
    // A single row carries no marker: the model only flags real recurrence.
    expect(user.content).toContain("2|Shell Station Utrecht|-68.00");
    expect(user.content).not.toContain("-68.00|1x");
  });

  it("strips pipes and newlines so the row format cannot break", () => {
    const [, user] = buildMessages([groups[1]], categories);
    expect(user.content).not.toContain("|Utrecht|");
    expect(user.content.split("\n")).toHaveLength(1);
  });

  it("truncates long labels", () => {
    const [, user] = buildMessages(
      [{ key: "X", label: "X".repeat(200), amountCents: -100, rows: 1 }],
      categories,
    );
    expect(user.content).toContain("X".repeat(32));
    expect(user.content).not.toContain("X".repeat(33));
  });
});

describe("parseSuggestions", () => {
  it("reads the documented shape", () => {
    const map = parseSuggestions('{"r":[{"i":1,"c":2},{"i":2,"c":0}]}', 2, 2);
    expect(map.get(1)).toBe(2);
    expect(map.has(2)).toBe(false); // 0 means unsure
  });

  it("survives fences, bare arrays, trailing commas and prose", () => {
    expect(parseSuggestions('```json\n{"r":[{"i":1,"c":1},]}\n```', 1, 2).get(1)).toBe(1);
    expect(parseSuggestions('[{"i":1,"c":2}]', 1, 2).get(1)).toBe(2);
    expect(parseSuggestions('Here you go: {"r":[{"i":1,"c":2}]} done', 1, 2).get(1)).toBe(2);
  });

  it("drops out-of-range and nonsense entries instead of guessing", () => {
    const map = parseSuggestions(
      '{"r":[{"i":9,"c":1},{"i":1,"c":7},{"i":"x","c":1},{"i":1,"c":"Groceries"},null]}',
      2,
      2,
    );
    expect(map.size).toBe(0);
  });

  it("returns an empty map for garbage", () => {
    expect(parseSuggestions("no json here", 2, 2).size).toBe(0);
    expect(parseSuggestions("", 2, 2).size).toBe(0);
  });

  it("recovers the real reply that answered line 1 and skipped the rest with i:0", () => {
    // Exactly what mistral-small sent for 3 groups: the indices are junk, the
    // order is not. Position 1 is the answer for line 1; c:0 means nothing.
    const map = parseSuggestions(
      '{"r": [{"i": 2, "c": 3}, {"i": 0, "c": 0}, {"i": 0, "c": 0}]}',
      3,
      4,
    );
    expect([...map]).toEqual([[1, 3]]);
  });

  it("falls back to positions when one entry per line carries junk indices", () => {
    const map = parseSuggestions('{"r":[{"c":2},{"i":"x","c":2},{"i":0,"c":0}]}', 3, 4);
    expect([...map]).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("trusts the echoed index when every entry has one", () => {
    const map = parseSuggestions('{"r":[{"i":2,"c":3},{"i":1,"c":1},{"i":3,"c":1}]}', 3, 4);
    expect([...map]).toEqual([
      [2, 3],
      [1, 1],
      [3, 1],
    ]);
  });

  it("never invents entries when the reply length does not match the group count", () => {
    expect(parseSuggestions('{"r":[{"i":0,"c":3}]}', 2, 4).size).toBe(0);
    expect(parseSuggestions('{"r":[{"c":3},{"c":2}]}', 3, 4).size).toBe(0);
  });
});

describe("suggestGroupCategories", () => {
  it("sends a JSON-mode request and maps numbers back to group keys", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '{"r":[{"i":2,"c":2}]}' } }] }),
    }));

    const map = await suggestGroupCategories(groups, categories, fetchImpl);
    expect(map.get("SHELL")).toBe("c2");
    expect(map.has("ALBERT HEIJN")).toBe(false);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { body: string; headers: Record<string, string>; signal?: AbortSignal },
    ];
    const body = JSON.parse(init.body);
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(body.model).toBe(AI_MODEL);
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toHaveLength(2);
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on a non-2xx answer so the caller can stop spending", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, text: async () => "{}" }));
    await expect(suggestGroupCategories(groups, categories, fetchImpl)).rejects.toThrow(/429/);
  });
});

describe("proposeForPreview", () => {
  it("does nothing without a configured provider", async () => {
    vi.stubEnv("AI_PROVIDER", "none");
    vi.stubEnv("AI_API_KEY", "");
    expect(isAiConfigured()).toBe(false);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const run = await proposeForPreview(groups, categories);
    expect(run.error).toBe("not-configured");
    expect(run.calls).toBe(0);
    expect(run.categories.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns keyed categories without touching the database", async () => {
    vi.stubEnv("AI_PROVIDER", "mistral");
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: '{"r":[{"i":1,"c":1}]}' } }] }),
      })),
    );

    const run = await proposeForPreview(groups, categories);
    expect(run.calls).toBe(1);
    expect(run.error).toBeUndefined();
    expect([...run.categories]).toEqual([["ALBERT HEIJN", "c1"]]);
  });

  it("reports a failed call instead of throwing at the dialog", async () => {
    vi.stubEnv("AI_PROVIDER", "mistral");
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "{}" })),
    );

    const run = await proposeForPreview(groups, categories);
    expect(run.error).toBe("request-failed");
    expect(run.calls).toBe(0);
  });

  it("makes no call when there is nothing to ask", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const run = await proposeForPreview([], categories);
    expect(run.calls).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("suggestForUncategorised", () => {
  it("skips the queue without a configured provider", async () => {
    vi.stubEnv("AI_PROVIDER", "none");
    vi.stubEnv("AI_API_KEY", "");
    await expect(suggestForUncategorised()).resolves.toEqual({
      suggested: 0,
      calls: 0,
      error: "not-configured",
    });
  });
});
