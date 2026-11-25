import { describe, expect, it, vi } from "vitest";
import {
  buildMessages,
  parseSuggestions,
  suggestBatch,
  type AiCandidate,
} from "@/lib/categorize/ai";

const candidates: AiCandidate[] = [
  { transactionId: "t1", merchant: "ALBERT HEIJN", description: "ALBERT HEIJN 1234", amountCents: -5432 },
  { transactionId: "t2", merchant: null, description: "SHELL STATION | UTRECHT", amountCents: -6800 },
];

const categories = [
  { id: "c1", name: "Groceries", kind: "EXPENSE" },
  { id: "c2", name: "Transport", kind: "EXPENSE" },
];

describe("buildMessages", () => {
  it("keeps the prompt tiny: one line per row, numbered categories", () => {
    const [system, user] = buildMessages(candidates, categories);

    expect(system.content).toContain("1=Groceries; 2=Transport");
    expect(system.content).toContain("0 when unsure");
    expect(system.content.length).toBeLessThan(320); // a few dozen tokens, not a paragraph
    expect(user.content.split("\n")).toHaveLength(2);
    expect(user.content).toContain("1|ALBERT HEIJN|-54.32");
  });

  it("strips pipes and newlines out of labels so the row format cannot break", () => {
    const [, user] = buildMessages(candidates, categories);
    expect(user.content).toContain("2|SHELL STATION UTRECHT|-68.00");
  });

  it("truncates long descriptions", () => {
    const [long] = buildMessages(
      [{ transactionId: "t3", merchant: null, description: "X".repeat(200), amountCents: -100 }],
      categories,
    ).slice(1);
    expect(long.content).toContain("X".repeat(32));
    expect(long.content).not.toContain("X".repeat(33));
  });
});

describe("parseSuggestions", () => {
  it("reads the documented shape", () => {
    const map = parseSuggestions('{"r":[{"i":1,"c":2},{"i":2,"c":0}]}', 2, 2);
    expect(map.get(1)).toBe(2);
    expect(map.has(2)).toBe(false); // 0 means unsure
  });

  it("survives fences, bare arrays and trailing commas", () => {
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
  });
});

describe("suggestBatch", () => {
  it("sends a JSON-mode request and maps numbers back to rows", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '{"r":[{"i":2,"c":2}]}' } }] }),
    }));

    const map = await suggestBatch(candidates, categories, fetchImpl);
    expect(map.get(2)).toBe(2);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    const body = JSON.parse(init.body);
    expect(body.model).toBeTruthy();
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(init.headers.Authorization).toMatch(/^Bearer /);
  });

  it("throws on a non-2xx answer so the caller can stop spending", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, text: async () => "{}" }));
    await expect(suggestBatch(candidates, categories, fetchImpl)).rejects.toThrow(/429/);
  });
});
