// Demo data for a first look at the app. Wipes the tables it owns and inserts a
// realistic six-month picture: five accounts, two-level categories, rules, a
// learned merchant map, ASN/ICS/PayPal transactions (including transfer pairs and
// uncategorised rows), and an ETF portfolio with trades and prices.
//
//   npm run db:seed
//
// Deterministic: same output every run, so screenshots and tests stay stable.

import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" }),
});

// mulberry32: tiny deterministic PRNG, no dependency.
function makeRandom(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) % 4294967296;
    return ((a ^ (a >>> 15)) * (1 | a)) % 4294967296 / 4294967296;
  };
}
const random = makeRandom(20261125);
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => min + Math.floor(random() * (max - min + 1));

const today = new Date();
const utcDay = (offsetMonths, day) => {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offsetMonths, day));
  return d;
};
const iso = (d) => d.toISOString().slice(0, 10);

let hashCounter = 0;
const nextHash = (label) => `seed-${label}-${++hashCounter}`;

async function wipe() {
  // Order matters: children first.
  await prisma.transaction.deleteMany();
  await prisma.statement.deleteMany();
  await prisma.trade.deleteMany();
  await prisma.price.deleteMany();
  await prisma.snapshot.deleteMany();
  await prisma.instrument.deleteMany();
  await prisma.rule.deleteMany();
  await prisma.merchantMap.deleteMany();
  await prisma.category.deleteMany();
  await prisma.account.deleteMany();
  await prisma.setting.deleteMany();
}

async function main() {
  await wipe();

  const accounts = Object.fromEntries(
    (
      await Promise.all([
        prisma.account.create({
          data: {
            name: "ASN Checking",
            type: "CHECKING",
            institution: "ASN",
            iban: "NL21ASNB0123456789",
            openingBalanceCents: 145000,
            sortOrder: 1,
          },
        }),
        prisma.account.create({
          data: {
            name: "ASN Savings",
            type: "SAVINGS",
            institution: "ASN",
            iban: "NL21ASNB9876543210",
            openingBalanceCents: 1240000,
            sortOrder: 2,
          },
        }),
        prisma.account.create({
          data: {
            name: "Brokerage",
            type: "BROKER",
            institution: "OTHER",
            openingBalanceCents: 250000,
            sortOrder: 3,
          },
        }),
        prisma.account.create({
          data: {
            name: "ICS Credit Card",
            type: "CREDIT_CARD",
            institution: "ICS",
            iban: "****4321",
            sortOrder: 4,
          },
        }),
        prisma.account.create({
          data: {
            name: "PayPal",
            type: "CHECKING",
            institution: "PAYPAL",
            openingBalanceCents: 32000,
            sortOrder: 5,
          },
        }),
      ])
    ).map((a) => [a.name, a]),
  );

  const cat = async (name, kind, color, parentId = null) =>
    prisma.category.create({ data: { name, kind, color, parentId } });

  const housing = await cat("Housing", "EXPENSE", "#6366f1");
  const rent = await cat("Rent", "EXPENSE", "#6366f1", housing.id);
  const utilities = await cat("Utilities", "EXPENSE", "#818cf8", housing.id);
  const groceries = await cat("Groceries", "EXPENSE", "#22c55e");
  const transport = await cat("Transport", "EXPENSE", "#0ea5e9");
  const subscriptions = await cat("Subscriptions", "EXPENSE", "#a855f7");
  const eatingOut = await cat("Eating out", "EXPENSE", "#f97316");
  const shopping = await cat("Shopping", "EXPENSE", "#ec4899");
  const health = await cat("Health", "EXPENSE", "#14b8a6");
  const insurance = await cat("Insurance", "EXPENSE", "#64748b");
  const salary = await cat("Salary", "INCOME", "#16a34a");
  const otherIncome = await cat("Other income", "INCOME", "#4ade80");
  // One general category for every movement between own accounts: no pairing,
  // no balancing, and nothing here counts as income or expense.
  const transfers = await prisma.category.create({
    data: { name: "Transfers", kind: "TRANSFER", color: "#0f172a", isSystem: true },
  });

  // Rules and one learned merchant, so the categoriser has something to hit.
  await prisma.rule.createMany({
    data: [
      {
        name: "Rent",
        matchOn: "MERCHANT",
        operator: "CONTAINS",
        pattern: "WONINGSTICHTING",
        categoryId: rent.id,
        priority: 10,
        origin: "MANUAL",
        hits: 6,
      },
      {
        name: "Energy",
        matchOn: "MERCHANT",
        operator: "CONTAINS",
        pattern: "VATTENFALL",
        categoryId: utilities.id,
        priority: 20,
        hits: 6,
      },
      {
        name: "Rail",
        matchOn: "MERCHANT",
        operator: "CONTAINS",
        pattern: "NS ",
        categoryId: transport.id,
        priority: 30,
        hits: 4,
      },
      {
        name: "Payroll",
        matchOn: "COUNTERPARTY",
        operator: "CONTAINS",
        pattern: "ACME",
        categoryId: salary.id,
        priority: 5,
        hits: 6,
      },
    ],
  });
  await prisma.merchantMap.create({
    data: { merchantKey: "ALBERT HEIJN", categoryId: groceries.id, source: "MANUAL", hits: 14 },
  });
  await prisma.merchantMap.create({
    data: { merchantKey: "SPOTIFY", categoryId: subscriptions.id, source: "MANUAL", hits: 6 },
  });

  const merchants = {
    groceries: ["ALBERT HEIJN", "JUMBO", "LIDL", "PLUS"],
    eatingOut: ["THUISBEZORG", "CAFE DE PLOEG", "SUSHI ONLINE"],
    shopping: ["BOL.COM", "ACTION", "COOLBLUE", "HEMA", "ZALANDO"],
    health: ["APOTHEEK", "HUISARTSENPOST"],
    transport: ["NS REIZIGERS", "SHELL", "GVB"],
  };

  const tx = [];
  const add = (row) => tx.push({ rawJson: JSON.stringify({ seed: true }), ...row });

  for (let m = 5; m >= 0; m--) {
    const monthDay = (d) => utcDay(m, Math.min(d, 28));

    // Salary and fixed costs.
    add({
      accountId: accounts["ASN Checking"].id,
      bookedAt: monthDay(25),
      amountCents: 385000,
      description: "SALARY ACME BV",
      counterparty: "ACME BV",
      merchant: "ACME",
      categoryId: salary.id,
      categorySource: "RULE",
      reviewState: "OK",
      dedupeHash: nextHash("salary"),
    });
    add({
      accountId: accounts["ASN Checking"].id,
      bookedAt: monthDay(1),
      amountCents: -142500,
      description: "HUUR WONINGSTICHTING NOORD",
      counterparty: "Woningstichting Noord",
      merchant: "WONINGSTICHTING",
      categoryId: rent.id,
      categorySource: "RULE",
      reviewState: "OK",
      dedupeHash: nextHash("rent"),
    });
    add({
      accountId: accounts["ASN Checking"].id,
      bookedAt: monthDay(3),
      amountCents: -between(8000, 14000),
      description: "VATTENFALL ENERGIE",
      counterparty: "Vattenfall",
      merchant: "VATTENFALL",
      categoryId: utilities.id,
      categorySource: "RULE",
      reviewState: "OK",
      dedupeHash: nextHash("energy"),
    });
    add({
      accountId: accounts["ASN Checking"].id,
      bookedAt: monthDay(5),
      amountCents: -12450,
      description: "ZORGVERZEKERING PREMIE",
      counterparty: "Zilveren Kruis",
      merchant: "ZILVEREN KRUIS",
      categoryId: insurance.id,
      categorySource: "MANUAL",
      reviewState: "OK",
      dedupeHash: nextHash("insurance"),
    });

    // Everyday spending, mostly categorised, a few left for review.
    for (let i = 0; i < 7; i++) {
      const group = pick(["groceries", "eatingOut", "shopping", "health"]);
      const merchant = pick(merchants[group]);
      const categoryId =
        group === "groceries" ? groceries.id
        : group === "eatingOut" ? eatingOut.id
        : group === "shopping" ? shopping.id
        : health.id;
      const leave = random() < 0.18;
      add({
        accountId: accounts["ASN Checking"].id,
        bookedAt: monthDay(between(6, 24)),
        amountCents: -between(450, 9500),
        description: `${merchant} ${between(1000, 9999)}`,
        merchant,
        categoryId: leave ? null : categoryId,
        categorySource: leave ? "NONE" : random() < 0.5 ? "MANUAL" : "RULE",
        reviewState: leave ? "UNCATEGORIZED" : "OK",
        dedupeHash: nextHash("spend"),
      });
    }

    // Transport, subscription, and two movements between own accounts.
    add({
      accountId: accounts["ASN Checking"].id,
      bookedAt: monthDay(9),
      amountCents: -between(1800, 4600),
      description: `NS REIZIGERS E-TICKET ${between(100, 999)}`,
      merchant: "NS REIZIGERS",
      categoryId: transport.id,
      categorySource: "RULE",
      reviewState: "OK",
      dedupeHash: nextHash("rail"),
    });
    add({
      accountId: accounts["ASN Checking"].id,
      bookedAt: monthDay(12),
      amountCents: -75000,
      description: "OVERBOEKING NAAR BROKERAGE",
      counterparty: "Brokerage",
      merchant: null,
      categoryId: transfers.id,
      reviewState: "OK",
      dedupeHash: nextHash("invest-out"),
    });
    add({
      accountId: accounts["Brokerage"].id,
      bookedAt: monthDay(12),
      amountCents: 75000,
      description: "STORTING VAN ASN CHECKING",
      counterparty: "ASN Checking",
      categoryId: transfers.id,
      reviewState: "OK",
      dedupeHash: nextHash("invest-in"),
    });
    add({
      accountId: accounts["ASN Checking"].id,
      bookedAt: monthDay(2),
      amountCents: -50000,
      description: "SPAAROVERBOEKING",
      counterparty: "ASN Savings",
      categoryId: transfers.id,
      reviewState: "OK",
      dedupeHash: nextHash("save-out"),
    });
    add({
      accountId: accounts["ASN Savings"].id,
      bookedAt: monthDay(2),
      amountCents: 50000,
      description: "VAN ASN CHECKING",
      counterparty: "ASN Checking",
      categoryId: transfers.id,
      reviewState: "OK",
      dedupeHash: nextHash("save-in"),
    });

    // Credit card: purchases positive in ICS, stored negative, plus the settlement.
    add({
      accountId: accounts["ICS Credit Card"].id,
      bookedAt: monthDay(20),
      amountCents: -between(3000, 9500),
      description: "SPOTIFY AB",
      merchant: "SPOTIFY",
      categoryId: subscriptions.id,
      categorySource: "MANUAL",
      reviewState: "OK",
      dedupeHash: nextHash("spotify"),
    });
    add({
      accountId: accounts["ICS Credit Card"].id,
      bookedAt: monthDay(21),
      amountCents: -between(2500, 15000),
      description: "AMAZON MARKETPLACE",
      merchant: "AMAZON",
      categoryId: random() < 0.5 ? shopping.id : null,
      categorySource: random() < 0.5 ? "AI" : "NONE",
      reviewState: random() < 0.5 ? "SUGGESTED" : "UNCATEGORIZED",
      categoryConfidence: 78,
      dedupeHash: nextHash("amazon"),
    });
    add({
      accountId: accounts["ICS Credit Card"].id,
      bookedAt: monthDay(22),
      amountCents: 42000,
      description: "GEINCASSEERD VORIG SALDO",
      reviewState: "OK",
      dedupeHash: nextHash("card-credit"),
    });
    add({
      accountId: accounts["ASN Checking"].id,
      bookedAt: monthDay(22),
      amountCents: -42000,
      description: "ICS CREDITCARD INCASSO",
      counterparty: "ICS Credit Card",
      reviewState: "OK",
      dedupeHash: nextHash("card-debit"),
    });

    // PayPal: a couple of small rows including a fee.
    add({
      accountId: accounts["PayPal"].id,
      bookedAt: monthDay(14),
      amountCents: between(1500, 6000),
      description: "PAYPAL SALE MARKETPLACE",
      counterparty: "buyer@example.com",
      categoryId: otherIncome.id,
      categorySource: "MANUAL",
      reviewState: "OK",
      dedupeHash: nextHash("paypal-in"),
    });
    add({
      accountId: accounts["PayPal"].id,
      bookedAt: monthDay(14),
      amountCents: -between(50, 320),
      description: "PAYPAL FEE",
      merchant: "PAYPAL",
      categoryId: null,
      categorySource: "NONE",
      reviewState: "UNCATEGORIZED",
      dedupeHash: nextHash("paypal-fee"),
    });
  }

  await prisma.transaction.createMany({ data: tx });

  // Two statements per imported account, so the import history is not empty.
  await prisma.statement.createMany({
    data: [
      {
        accountId: accounts["ASN Checking"].id,
        source: "ASN",
        filename: "ASN_2026-10.CSV",
        fileHash: "seed-file-asn-1",
        rowCount: 64,
        importedCount: 64,
        skippedCount: 0,
        periodStart: utcDay(2, 1),
        periodEnd: utcDay(2, 28),
      },
      {
        accountId: accounts["ICS Credit Card"].id,
        source: "ICS",
        filename: "ICS_2026-10.csv",
        fileHash: "seed-file-ics-1",
        rowCount: 18,
        importedCount: 17,
        skippedCount: 1,
        periodStart: utcDay(2, 1),
        periodEnd: utcDay(2, 28),
      },
      {
        accountId: accounts["PayPal"].id,
        source: "PAYPAL",
        filename: "PayPal_2026-10.csv",
        fileHash: "seed-file-paypal-1",
        rowCount: 9,
        importedCount: 9,
        skippedCount: 0,
        periodStart: utcDay(2, 1),
        periodEnd: utcDay(2, 28),
      },
    ],
  });

  // Portfolio: two ETFs and a stock, monthly buys, one partial sell.
  const [iwda, vwce, asml] = await Promise.all([
    prisma.instrument.create({
      data: { symbol: "IWDA", isin: "IE00B4L5Y983", name: "iShares Core MSCI World", kind: "ETF", priceSymbol: "iwda.nl" },
    }),
    prisma.instrument.create({
      data: { symbol: "VWCE", isin: "IE00BK5BQT80", name: "Vanguard FTSE All-World", kind: "ETF", priceSymbol: "vwce.de" },
    }),
    prisma.instrument.create({
      data: { symbol: "ASML", isin: "NL0010273215", name: "ASML Holding", kind: "STOCK", priceSymbol: "asml.nl" },
    }),
  ]);

  const broker = accounts["Brokerage"].id;
  const micro = (qty) => Math.round(qty * 1_000_000);
  const trades = [];
  for (let m = 5; m >= 0; m--) {
    trades.push({
      accountId: broker,
      instrumentId: iwda.id,
      side: "BUY",
      tradedAt: utcDay(m, 13),
      quantityMicro: micro(2),
      priceCents: 8450 + (5 - m) * 65,
      feeCents: 250,
      currency: "EUR",
    });
  }
  trades.push({
    accountId: broker,
    instrumentId: vwce.id,
    side: "BUY",
    tradedAt: utcDay(3, 15),
    quantityMicro: micro(4),
    priceCents: 11230,
    feeCents: 300,
    currency: "EUR",
  });
  trades.push({
    accountId: broker,
    instrumentId: asml.id,
    side: "BUY",
    tradedAt: utcDay(4, 8),
    quantityMicro: micro(3),
    priceCents: 68200,
    feeCents: 250,
    currency: "EUR",
  });
  trades.push({
    accountId: broker,
    instrumentId: asml.id,
    side: "SELL",
    tradedAt: utcDay(1, 9),
    quantityMicro: micro(1),
    priceCents: 71850,
    feeCents: 250,
    currency: "EUR",
    note: "Trimmed the position",
  });
  await prisma.trade.createMany({ data: trades });

  await prisma.price.createMany({
    data: [
      { instrumentId: iwda.id, priceCents: 8890, source: "MANUAL" },
      { instrumentId: vwce.id, priceCents: 11740, source: "MANUAL" },
      { instrumentId: asml.id, priceCents: 72500, source: "MANUAL" },
    ],
  });

  // Broker cash snapshot: deposits minus purchases, so the balance is plausible.
  await prisma.snapshot.create({
    data: { accountId: broker, takenAt: utcDay(0, 2), balanceCents: 24500, source: "MANUAL" },
  });

  await prisma.setting.createMany({
    data: [
      { key: "seeded", valueJson: JSON.stringify({ at: new Date().toISOString(), rows: tx.length }) },
      { key: "baseCurrency", valueJson: JSON.stringify("EUR") },
    ],
  });

  const counts = {
    accounts: await prisma.account.count(),
    categories: await prisma.category.count(),
    transactions: await prisma.transaction.count(),
    uncategorised: await prisma.transaction.count({ where: { reviewState: "UNCATEGORIZED" } }),
    suggested: await prisma.transaction.count({ where: { reviewState: "SUGGESTED" } }),
    trades: await prisma.trade.count(),
    instruments: await prisma.instrument.count(),
    firstDay: iso(tx.length ? utcDay(5, 1) : today),
  };
  console.log("Seeded demo data:", counts);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
