// AI category suggestions. Built for cheap models: one short system prompt, one
// line per transaction, integer answers, no prose, no chain of thought. The app
// works without this; when configured it only *proposes*, a human confirms.
//
// Nothing here sends account names, IBANs or balances: only the merchant or
// description text and the amount.

import { prisma } from "@/lib/db";

export const AI_MODEL = process.env.AI_MODEL ?? "mistral-small-latest";
export const AI_BATCH_SIZE = 40;
/** Hard cap so a bad run cannot burn a wallet: batches per invocation. */
export const AI_MAX_BATCHES = Number(process.env.AI_MAX_BATCHES ?? 5);

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";

export function isAiConfigured(): boolean {
  return (process.env.AI_PROVIDER ?? "none") !== "none" && Boolean(process.env.AI_API_KEY);
}

export type AiCandidate = {
  transactionId: string;
  merchant: string | null;
  description: string;
  amountCents: number;
};

export type AiCategory = { id: string; name: string; kind: string };

/**
 * Deliberately tiny. Category numbers instead of ids keeps the prompt at a few
 * dozen tokens, and a JSON object reply is what small models get right.
 * `0` means "not sure", which is cheaper than forcing a wrong answer.
 */
export function buildMessages(candidates: AiCandidate[], categories: AiCategory[]) {
  const categoryList = categories.map((c, index) => `${index + 1}=${c.name}`).join("; ");
  const rows = candidates
    .map((candidate, index) => {
      // One line, no pipes: the row format must never break on a merchant name.
      const label = (candidate.merchant ?? candidate.description)
        .replace(/[|\n\r]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 32);
      const amount = (candidate.amountCents / 100).toFixed(2);
      return `${index + 1}|${label}|${amount}`;
    })
    .join("\n");

  return [
    {
      role: "system" as const,
      content:
        "Map each transaction to one category number. Use 0 when unsure. " +
        "Negative amount = expense. Reply JSON only, no prose: " +
        '{"r":[{"i":1,"c":2}]}  Categories: ' +
        categoryList,
    },
    { role: "user" as const, content: rows },
  ];
}

/**
 * Tolerant reader for whatever a cheap model returns: fenced JSON, a bare array,
 * an object with `r`, or a trailing comma. Invalid entries are dropped, never
 * guessed.
 */
export function parseSuggestions(raw: string, candidateCount: number, categoryCount: number): Map<number, number> {
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
    if (start === -1 || end <= start) return new Map();
    try {
      parsed = JSON.parse(clear.slice(start, end + 1));
    } catch {
      return new Map();
    }
  }

  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { r?: unknown }).r)
      ? (parsed as { r: unknown[] }).r
      : [];

  const result = new Map<number, number>();
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const { i, c } = entry as { i?: unknown; c?: unknown };
    const index = Number(i);
    const category = Number(c);
    if (!Number.isInteger(index) || index < 1 || index > candidateCount) continue;
    if (!Number.isInteger(category) || category < 1 || category > categoryCount) continue;
    result.set(index, category);
  }
  return result;
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** One API call. Returns transaction index -> category number (1-based). */
export async function suggestBatch(
  candidates: AiCandidate[],
  categories: AiCategory[],
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<Map<number, number>> {
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.AI_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0,
      max_tokens: 60 + candidates.length * 12,
      response_format: { type: "json_object" },
      messages: buildMessages(candidates, categories),
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`ai request failed: ${response.status}`);
  const payload = JSON.parse(await response.text()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  return parseSuggestions(content, candidates.length, categories.length);
}

export type AiRunResult = {
  suggested: number;
  fromCache: number;
  calls: number;
  /** "not-configured" | "request-failed" | undefined */
  error?: string;
};

/**
 * Proposes categories for rows that have none. Three cost guards:
 * 1. merchant memory answers first, with no call;
 * 2. only uncategorised rows are sent, in batches of AI_BATCH_SIZE;
 * 3. AI_MAX_BATCHES caps the calls per run.
 * Suggestions land as reviewState SUGGESTED with categorySource AI, so nothing
 * is applied behind the user's back.
 */
export async function suggestCategoriesForUncategorised(limit = AI_BATCH_SIZE * 10): Promise<AiRunResult> {
  const result: AiRunResult = { suggested: 0, fromCache: 0, calls: 0 };
  if (!isAiConfigured()) return { ...result, error: "not-configured" };

  const [categories, pending, cache] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.transaction.findMany({
      where: { categoryId: null },
      orderBy: [{ bookedAt: "desc" }],
      take: Math.min(limit, AI_BATCH_SIZE * AI_MAX_BATCHES),
      select: {
        id: true,
        merchant: true,
        description: true,
        amountCents: true,
      },
    }),
    prisma.merchantMap.findMany({ where: { source: "AI" } }),
  ]);

  if (pending.length === 0 || categories.length === 0) return result;

  const categoryIdByNumber = new Map(categories.map((c, index) => [index + 1, c.id]));
  const cachedByMerchant = new Map(cache.map((entry) => [entry.merchantKey, entry.categoryId]));

  const toAsk: AiCandidate[] = [];
  for (const txn of pending) {
    const cached = txn.merchant ? cachedByMerchant.get(txn.merchant.toUpperCase()) : undefined;
    if (cached) {
      await prisma.transaction.update({
        where: { id: txn.id },
        data: { categoryId: cached, categorySource: "AI", reviewState: "SUGGESTED" },
      });
      result.fromCache += 1;
      continue;
    }
    toAsk.push({
      transactionId: txn.id,
      merchant: txn.merchant,
      description: txn.description,
      amountCents: txn.amountCents,
    });
  }

  const batches: AiCandidate[][] = [];
  for (let i = 0; i < toAsk.length; i += AI_BATCH_SIZE) {
    batches.push(toAsk.slice(i, i + AI_BATCH_SIZE));
  }

  for (const batch of batches.slice(0, AI_MAX_BATCHES)) {
    let suggestions: Map<number, number>;
    try {
      suggestions = await suggestBatch(batch, categories);
      result.calls += 1;
    } catch {
      result.error = "request-failed";
      break;
    }

    for (const [index, categoryNumber] of suggestions) {
      const candidate = batch[index - 1];
      const categoryId = categoryIdByNumber.get(categoryNumber);
      if (!candidate || !categoryId) continue;

      await prisma.transaction.update({
        where: { id: candidate.transactionId },
        data: { categoryId, categorySource: "AI", reviewState: "SUGGESTED" },
      });
      result.suggested += 1;

      if (candidate.merchant) {
        const merchantKey = candidate.merchant.toUpperCase();
        await prisma.merchantMap.upsert({
          where: { merchantKey },
          create: { merchantKey, categoryId, source: "AI" },
          update: { categoryId, source: "AI" },
        });
      }
    }
  }

  return result;
}
