-- CreateTable
CREATE TABLE "PropertyValuation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "valuedAt" DATETIME NOT NULL,
    "cents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PropertyValuation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PropertyValuation_propertyId_valuedAt_idx" ON "PropertyValuation"("propertyId", "valuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyValuation_propertyId_valuedAt_key" ON "PropertyValuation"("propertyId", "valuedAt");
