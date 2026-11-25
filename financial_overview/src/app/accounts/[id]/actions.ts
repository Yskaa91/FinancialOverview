"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { quantityToMicro } from "@/lib/money";
import { parseAmountToCents } from "@/lib/money";

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
  revalidatePath("/");
}

export async function deleteTrade(formData: FormData): Promise<void> {
  const id = formData.get("tradeId");
  const accountId = formData.get("accountId");
  if (typeof id !== "string" || typeof accountId !== "string") return;
  await prisma.trade.delete({ where: { id } });
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/");
}

const priceSchema = z.object({
  accountId: z.string().min(1),
  instrumentId: z.string().min(1),
  price: z.string().trim().min(1),
});

/** Manual price entry: the fallback when no price source is enabled. */
export async function setPrice(formData: FormData): Promise<void> {
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
  revalidatePath("/");
}

/**
 * Refreshes quotes from Stooq for the instruments this account holds. Off unless
 * PRICE_FETCH=enabled, so nothing calls out by default.
 */
export async function refreshPrices(formData: FormData): Promise<void> {
  const accountId = formData.get("accountId");
  if (typeof accountId !== "string") return;
  if ((process.env.PRICE_FETCH ?? "disabled") !== "enabled") return;

  const instruments = await prisma.instrument.findMany({
    where: { trades: { some: { accountId } } },
  });

  for (const instrument of instruments) {
    const ticker = instrument.priceSymbol ?? `${instrument.symbol.toLowerCase()}.nl`;
    try {
      const response = await fetch(
        `https://stooq.com/q/l/?s=${encodeURIComponent(ticker)}&f=sd2t2ohlcv&h&e=csv`,
        { signal: AbortSignal.timeout(5000), cache: "no-store" },
      );
      if (!response.ok) continue;
      const text = await response.text();
      const last = text.trim().split("\n").pop()?.split(",");
      const close = last ? Number(last[6]) : NaN; // Close column in Stooq's CSV
      if (!Number.isFinite(close) || close <= 0) continue;
      await prisma.price.create({
        data: {
          instrumentId: instrument.id,
          priceCents: Math.round(close * 100),
          source: "STOOQ",
        },
      });
    } catch {
      // A dead price source must never break the page.
    }
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/");
}
