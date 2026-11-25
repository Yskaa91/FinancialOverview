-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT,
    "address" TEXT NOT NULL,
    "regionCode" TEXT NOT NULL,
    "regionName" TEXT NOT NULL,
    "purchasePriceCents" INTEGER NOT NULL,
    "purchasedAt" DATETIME NOT NULL,
    "estimatedValueCents" INTEGER,
    "indexAtPurchaseMicro" INTEGER,
    "indexLatestMicro" INTEGER,
    "indexPeriod" TEXT,
    "valueFetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Property_regionCode_idx" ON "Property"("regionCode");
