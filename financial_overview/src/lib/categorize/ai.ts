// AI category suggestions. Built for cheap models: one short system prompt, one
// line per merchant GROUP (not per transaction), integer answers, no prose. The
// app works without this; when configured it only *proposes*, a human confirms.
//
// Nothing here sends account names, IBANs or balances: only the merchant label
// and the amount.
//
// An AI guess never enters the rule engine's memory: no MerchantMap writes, no
// Rule writes. Approved categorisations are the caller's job.

import { prisma } from "@/lib/db";
import { displayLabel, dominantAmountCents, merchantKeyOf } from "@/lib/categorize/recurrence";
import type { CategoryOption } from "@/lib/review/types";

export const AI_MODEL = process.env.AI_MODEL ?? "mistral-small-latest";
export const AI_BATCH_SIZE = 40;
/** Hard cap so a bad run cannot burn a wallet: batches per invocation. */
export const AI_MAX_BATCHES = Number(process.env.AI_MAX_BATCHES ?? 5);

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";

export function isAiConfigured(): boolean {
  return (process.env.AI_PROVIDER ?? "none") !== "none" && Boolean(process.env.AI_API_KEY);
}

export type AiGroupInput = {
  /** Group key from recurrence.ts: the answer comes back per key, not per row. */
  key: string;
  label: string;
  /** Dominant amount of the group, in cents. */
  amountCents: number;
  rows: number;
  /**
   * What the statement actually says. The label alone is the merchant name and
   * loses the rest ("ALBERT HEIJN 1234 AMSTERDAM" tells more than "ALBERT HEIJN"),
   * and it is the only transaction text the privacy rules allow to leave.
   */
  description?: string;
};

/**
 * Deliberately tiny. Category numbers instead of ids keeps the prompt at a few
 * dozen tokens, and a JSON object reply is what small models get right.
 * `0` means "not sure", which is cheaper than forcing a wrong answer.
 *
 * The reply shape is spelled out because a real model answered the first line
 * and skipped the rest with `i:0`: `i` must be the line number, echoed back.
 */
export function buildMessages(
  groups: AiGroupInput[],
  categories: CategoryOption[],
): { role: "system" | "user"; content: string }[] {
  const kindLetter = { EXPENSE: "E", INCOME: "I", TRANSFER: "T" } as const;
  const categoryList = categories
    .map((category, index) => `${index + 1}=${category.name}/${kindLetter[category.kind] ?? "E"}`)
    .join("; ");
  const clean = (raw: string, limit: number) =>
    raw
      .replace(/[|\n\r]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);

  const lines = groups
    .map((group, index) => {
      // One line, no pipes: the row format must never break on a merchant name.
      const label = clean(group.label, 32);
      const amount = (group.amountCents / 100).toFixed(2);
      const repeat = group.rows > 1 ? `|${group.rows}x` : "";
      const description = clean(group.description ?? "", 120);
      return `${index + 1}|${label}|${amount}${repeat}|${description}`;
    })
    .join("\n");

  return [
    {
      role: "system",
      content:
        "Categorise every line: i = the line number, echoed back, c = category " +
        "number. Only pick a category the merchant clearly belongs to, otherwise " +
        "0: a wrong bucket is worse than none. Amount negative = money out. " +
        "Line format: i|merchant|amount|count|statement text. " +
        "E=expense, I=income, T=transfer category. JSON only, one object per line: " +
        '{"r":[{"i":1,"c":2}]} Categories: ' +
        categoryList,
    },
    { role: "user", content: lines },
  ];
}

/**
 * Tolerant reader for whatever a cheap model returns: fenced JSON, a bare array,
 * an object with `r`, or a trailing comma. Invalid entries are dropped, never
 * guessed. Returns group index (1-based) -> category number (1-based).
 *
 * Positional fallback: a model that keeps the line order but fills in `i:0` (or
 * omits `i`) for the lines it is unsure about still tells us which line it
 * meant. So when the reply holds exactly one entry per line and any index is
 * unusable, positions win; otherwise the echoed index is trusted.
 */
export function parseSuggestions(raw: string, groupCount: number, categoryCount: number): Map<number, number> {
  const clear = raw
    .replace(/```(?:json)?/gi, "")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(clear);
  } catch {
    const start = clear.indexOf("{");
    const end = clear.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(clear.slice(start, end + 1));
      } catch {
        parsed = undefined;
      }
    }
    // Still nothing: the answer was cut off mid-object (finish_reason "length").
    // Every complete pair before the cut is still a usable answer.
    if (parsed === undefined) return salvagePairs(clear, groupCount, categoryCount);
  }

  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { r?: unknown }).r)
      ? (parsed as { r: unknown[] }).r
      : [];

  const usableIndex = (entry: unknown): number => {
    if (typeof entry !== "object" || entry === null) return 0;
    const index = Number((entry as { i?: unknown }).i);
    return Number.isInteger(index) && index >= 1 && index <= groupCount ? index : 0;
  };

  const usePositions = list.length === groupCount && !list.every((entry) => usableIndex(entry) > 0);

  const result = new Map<number, number>();
  list.forEach((entry, position) => {
    if (typeof entry !== "object" || entry === null) return;
    const category = Number((entry as { c?: unknown }).c);
    // 0 (and anything out of range) means "no suggestion", never a guess.
    if (!Number.isInteger(category) || category < 1 || category > categoryCount) return;

    const index = usePositions ? position + 1 : usableIndex(entry);
    if (index < 1 || index > groupCount) return;
    if (!result.has(index)) result.set(index, category);
  });
  return result;
}

/**
 * Reads the `{i,c}` pairs out of a reply that never became valid JSON. The model
 * writes them in order, so a squeezed answer still classifies most lines.
 */
function salvagePairs(raw: string, groupCount: number, categoryCount: number): Map<number, number> {
  const result = new Map<number, number>();
  const pair = /"i"\s*:\s*(\d+)\s*,\s*"c"\s*:\s*(\d+)/g;
  for (const match of raw.matchAll(pair)) {
    const index = Number(match[1]);
    const category = Number(match[2]);
    if (index < 1 || index > groupCount) continue;
    if (category < 1 || category > categoryCount) continue;
    if (!result.has(index)) result.set(index, category);
  }
  return result;
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** One API call over one batch of groups. Returns group key -> categoryId. */
export async function suggestGroupCategories(
  groups: AiGroupInput[],
  categories: CategoryOption[],
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<Map<string, string>> {
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AI_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0,
      // ~14 tokens per entry in practice; the old 8 per group cut the JSON in
      // half, and a truncated object parses to nothing at all.
      max_tokens: 80 + groups.length * 24,
      response_format: { type: "json_object" },
      messages: buildMessages(groups, categories),
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`ai request failed: ${response.status}`);
  const payload = JSON.parse(await response.text()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content ?? "";

  const byKey = new Map<string, string>();
  for (const [index, number] of parseSuggestions(content, groups.length, categories.length)) {
    const group = groups[index - 1];
    const category = categories[number - 1];
    if (group && category) byKey.set(group.key, category.id);
  }
  return byKey;
}

export type ProposalResult = { categories: Map<string, string>; calls: number; error?: string };

/** Batched run over the unmatched groups of one import preview. NEVER writes to the database. */
export async function proposeForPreview(
  groups: AiGroupInput[],
  categories: CategoryOption[],
): Promise<ProposalResult> {
  const result: ProposalResult = { categories: new Map(), calls: 0 };
  if (!isAiConfigured()) return { ...result, error: "not-configured" };
  if (groups.length === 0 || categories.length === 0) return result;

  const batches: AiGroupInput[][] = [];
  for (let i = 0; i < groups.length; i += AI_BATCH_SIZE) {
    batches.push(groups.slice(i, i + AI_BATCH_SIZE));
  }

  for (const batch of batches.slice(0, AI_MAX_BATCHES)) {
    try {
      for (const [key, categoryId] of await suggestGroupCategories(batch, categories)) {
        result.categories.set(key, categoryId);
      }
      result.calls += 1;
    } catch {
      // Keep the batches that did answer; report the failure alongside them.
      result.error = "request-failed";
    }
  }
  return result;
}

export type UncategorisedRun = { suggested: number; calls: number; error?: string };

/**
 * The /transactions review queue: groups uncategorised DB rows by merchant, one
 * AI line per merchant, and stores the answer as categorySource "AI" +
 * reviewState "SUGGESTED". MerchantMap stays untouched: only a human
 * confirmation may teach the rule engine.
 */
export async function suggestForUncategorised(limit = AI_BATCH_SIZE * 10): Promise<UncategorisedRun> {
  if (!isAiConfigured()) return { suggested: 0, calls: 0, error: "not-configured" };

  const [categories, pending] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.transaction.findMany({
      where: { categoryId: null },
      orderBy: [{ bookedAt: "desc" }],
      take: limit,
      select: { id: true, merchant: true, counterparty: true, description: true, amountCents: true },
    }),
  ]);
  if (pending.length === 0 || categories.length === 0) return { suggested: 0, calls: 0 };

  const idsByKey = new Map<string, string[]>();
  const amountsByKey = new Map<string, number[]>();
  const labelsByKey = new Map<string, string>();
  const descriptionsByKey = new Map<string, string[]>();
  for (const txn of pending) {
    const key = merchantKeyOf(txn);
    const ids = idsByKey.get(key);
    if (ids) {
      ids.push(txn.id);
      amountsByKey.get(key)?.push(txn.amountCents);
      const seen = descriptionsByKey.get(key);
      const text = txn.counterparty ?? txn.description;
      if (seen && seen.length < 2 && !seen.includes(text)) seen.push(text);
      continue;
    }
    idsByKey.set(key, [txn.id]);
    amountsByKey.set(key, [txn.amountCents]);
    labelsByKey.set(key, displayLabel(txn));
    descriptionsByKey.set(key, [txn.counterparty ?? txn.description]);
  }

  const groups: AiGroupInput[] = [...idsByKey].map(([key, ids]) => ({
    key,
    label: labelsByKey.get(key) ?? key,
    amountCents: dominantAmountCents(amountsByKey.get(key) ?? []),
    rows: ids.length,
    description: (descriptionsByKey.get(key) ?? []).join(" · "),
  }));

  const run = await proposeForPreview(
    groups,
    categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind as CategoryOption["kind"] })),
  );

  let suggested = 0;
  for (const [key, categoryId] of run.categories) {
    const ids = idsByKey.get(key);
    if (!ids) continue;
    const updated = await prisma.transaction.updateMany({
      where: { id: { in: ids } },
      data: { categoryId, categorySource: "AI", reviewState: "SUGGESTED" },
    });
    suggested += updated.count;
  }

  return run.error ? { suggested, calls: run.calls, error: run.error } : { suggested, calls: run.calls };
}
