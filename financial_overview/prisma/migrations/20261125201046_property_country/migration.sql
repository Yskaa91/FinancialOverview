-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Property" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT,
    "address" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NL',
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
INSERT INTO "new_Property" ("address", "createdAt", "estimatedValueCents", "id", "indexAtPurchaseMicro", "indexLatestMicro", "indexPeriod", "label", "purchasePriceCents", "purchasedAt", "regionCode", "regionName", "updatedAt", "valueFetchedAt") SELECT "address", "createdAt", "estimatedValueCents", "id", "indexAtPurchaseMicro", "indexLatestMicro", "indexPeriod", "label", "purchasePriceCents", "purchasedAt", "regionCode", "regionName", "updatedAt", "valueFetchedAt" FROM "Property";
DROP TABLE "Property";
ALTER TABLE "new_Property" RENAME TO "Property";
CREATE INDEX "Property_regionCode_idx" ON "Property"("regionCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
