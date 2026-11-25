-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "institution" TEXT NOT NULL DEFAULT 'OTHER',
    "iban" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "openingBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Statement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Statement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "statementId" TEXT,
    "bookedAt" DATETIME NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "fxRateMicro" INTEGER,
    "description" TEXT NOT NULL,
    "counterparty" TEXT,
    "counterpartyIban" TEXT,
    "merchant" TEXT,
    "categoryId" TEXT,
    "categorySource" TEXT NOT NULL DEFAULT 'NONE',
    "categoryConfidence" INTEGER,
    "reviewState" TEXT NOT NULL DEFAULT 'UNCATEGORIZED',
    "transferGroupId" TEXT,
    "balanceAfterCents" INTEGER,
    "rawJson" TEXT NOT NULL,
    "dedupeHash" TEXT NOT NULL,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "Statement" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parentId" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "matchOn" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "accountId" TEXT,
    "amountMinCents" INTEGER,
    "amountMaxCents" INTEGER,
    "categoryId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "hits" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Rule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MerchantMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantKey" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "hits" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MerchantMap_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "isin" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ETF',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "priceSymbol" TEXT
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "tradedAt" DATETIME NOT NULL,
    "quantityMicro" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Trade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Trade_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Price" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    CONSTRAINT "Price_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "takenAt" DATETIME NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    CONSTRAINT "Snapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "valueJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Account_archived_sortOrder_idx" ON "Account"("archived", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Statement_fileHash_key" ON "Statement"("fileHash");

-- CreateIndex
CREATE INDEX "Statement_accountId_importedAt_idx" ON "Statement"("accountId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_dedupeHash_key" ON "Transaction"("dedupeHash");

-- CreateIndex
CREATE INDEX "Transaction_bookedAt_idx" ON "Transaction"("bookedAt");

-- CreateIndex
CREATE INDEX "Transaction_accountId_bookedAt_idx" ON "Transaction"("accountId", "bookedAt");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_bookedAt_idx" ON "Transaction"("categoryId", "bookedAt");

-- CreateIndex
CREATE INDEX "Transaction_reviewState_idx" ON "Transaction"("reviewState");

-- CreateIndex
CREATE INDEX "Transaction_merchant_idx" ON "Transaction"("merchant");

-- CreateIndex
CREATE INDEX "Transaction_transferGroupId_idx" ON "Transaction"("transferGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_kind_parentId_key" ON "Category"("name", "kind", "parentId");

-- CreateIndex
CREATE INDEX "Rule_enabled_priority_idx" ON "Rule"("enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantMap_merchantKey_key" ON "MerchantMap"("merchantKey");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_symbol_key" ON "Instrument"("symbol");

-- CreateIndex
CREATE INDEX "Trade_accountId_instrumentId_tradedAt_idx" ON "Trade"("accountId", "instrumentId", "tradedAt");

-- CreateIndex
CREATE INDEX "Price_instrumentId_fetchedAt_idx" ON "Price"("instrumentId", "fetchedAt");

-- CreateIndex
CREATE INDEX "Snapshot_accountId_takenAt_idx" ON "Snapshot"("accountId", "takenAt");
