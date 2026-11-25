"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { quantityToMicro } from "@/lib/money";
import { parseAmountToCents } from "@/lib/money";
import { requireSession } from "@/lib/auth";
import { refreshStalePrices } from "@/lib/portfolio/quotes";

const tradeSchema = z.object({
  accountId: z.string().min(1),
  symbol: z.string().trim().min(1).max(12).toUpperCase(),
  side: z.enum(["BUY", "SELL"]),
  tradedAt: z.string().min(1),
  quantity: z.string().trim().min(1),
  price: z.string().trim().min(1),
  fee: z.string().trim().optional(),
  note: z.string().trim().max(200).optional(),
});

/** Records a buy or sell. A new symbol creates the instrument on the fly. */
export async function addTrade(formData: FormData): Promise<void> {
  await requireSession();
  const parsed = tradeSchema.safeParse({
    accountId: formData.get("accountId"),
    symbol: formData.get("symbol"),
    side: formData.get("side"),
    tradedAt: formData.get("tradedAt"),
    quantity: formData.get("quantity"),
    price: formData.get("price"),
    fee: formData.get("fee") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return;

  const { accountId, symbol, side, tradedAt, quantity, price, fee, note } = parsed.data;
  const quantityMicro = quantityToMicro(quantity);
  const priceCents = parseAmountToCents(price);
  const feeCents = fee ? parseAmountToCents(fee) : 0;
  if (quantityMicro === null || quantityMicro <= 0) return;
  if (priceCents === null || priceCents < 0) return;
  if (feeCents === null || feeCents < 0) return;

  const date = new Date(`${tradedAt}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return;

  const instrument = await prisma.instrument.upsert({
    where: { symbol },
    create: { symbol, name: symbol, kind: "ETF" },
    update: {},
  });

  await prisma.trade.create({
    data: {
      accountId,
      instrumentId: instrument.id,
      side,
      tradedAt: date,
      quantityMicro,
      priceCents,
      feeCents,
      note: note || null,
    },
  });

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/portfolio");
  revalidatePath("/");
}

export async function deleteTrade(formData: FormData): Promise<void> {
  await requireSession();
  const id = formData.get("tradeId");
  const accountId = formData.get("accountId");
  if (typeof id !== "string" || typeof accountId !== "string") return;
  await prisma.trade.delete({ where: { id } });
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/portfolio");
  revalidatePath("/");
}

const priceSchema = z.object({
  accountId: z.string().min(1),
  instrumentId: z.string().min(1),
  price: z.string().trim().min(1),
});

/** Manual price entry: the fallback when no price source is enabled. */
export async function setPrice(formData: FormData): Promise<void> {
  await requireSession();
  const parsed = priceSchema.safeParse({
    accountId: formData.get("accountId"),
    instrumentId: formData.get("instrumentId"),
    price: formData.get("price"),
  });
  if (!parsed.success) return;

  const priceCents = parseAmountToCents(parsed.data.price);
  if (priceCents === null || priceCents <= 0) return;

  await prisma.price.create({
    data: {
      instrumentId: parsed.data.instrumentId,
      priceCents,
      source: "MANUAL",
      fetchedAt: new Date(),
    },
  });

  revalidatePath(`/accounts/${parsed.data.accountId}`);
  revalidatePath("/portfolio");
  revalidatePath("/");
}

/**
 * Manual refresh button. Same fetch as the automatic one on /portfolio, but it
 * ignores the twelve-hour freshness window.
 */
export async function refreshPrices(formData: FormData): Promise<void> {
  await requireSession();
  const accountId = formData.get("accountId");
  if (typeof accountId !== "string") return;

  await refreshStalePrices({ accountId, force: true });

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/portfolio");
  revalidatePath("/");
}
