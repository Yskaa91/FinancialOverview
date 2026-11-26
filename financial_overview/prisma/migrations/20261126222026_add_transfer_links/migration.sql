-- CreateTable
CREATE TABLE "TransferLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'AUTO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
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
    "excludeFromSpending" BOOLEAN NOT NULL DEFAULT false,
    "transferLinkId" TEXT,
    "balanceAfterCents" INTEGER,
    "rawJson" TEXT NOT NULL,
    "dedupeHash" TEXT NOT NULL,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "Statement" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_transferLinkId_fkey" FOREIGN KEY ("transferLinkId") REFERENCES "TransferLink" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amountCents", "balanceAfterCents", "bookedAt", "categoryConfidence", "categoryId", "categorySource", "counterparty", "counterpartyIban", "currency", "dedupeHash", "description", "fxRateMicro", "id", "merchant", "rawJson", "reviewState", "statementId") SELECT "accountId", "amountCents", "balanceAfterCents", "bookedAt", "categoryConfidence", "categoryId", "categorySource", "counterparty", "counterpartyIban", "currency", "dedupeHash", "description", "fxRateMicro", "id", "merchant", "rawJson", "reviewState", "statementId" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_dedupeHash_key" ON "Transaction"("dedupeHash");
CREATE INDEX "Transaction_bookedAt_idx" ON "Transaction"("bookedAt");
CREATE INDEX "Transaction_accountId_bookedAt_idx" ON "Transaction"("accountId", "bookedAt");
CREATE INDEX "Transaction_categoryId_bookedAt_idx" ON "Transaction"("categoryId", "bookedAt");
CREATE INDEX "Transaction_reviewState_idx" ON "Transaction"("reviewState");
CREATE INDEX "Transaction_merchant_idx" ON "Transaction"("merchant");
CREATE INDEX "Transaction_transferLinkId_idx" ON "Transaction"("transferLinkId");
CREATE INDEX "Transaction_excludeFromSpending_idx" ON "Transaction"("excludeFromSpending");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TransferLink_kind_createdAt_idx" ON "TransferLink"("kind", "createdAt");

