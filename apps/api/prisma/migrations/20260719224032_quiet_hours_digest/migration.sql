-- AlterTable
ALTER TABLE "DispatchSettings" ADD COLUMN     "quietHoursEnd" TEXT,
ADD COLUMN     "quietHoursStart" TEXT;

-- CreateTable
CREATE TABLE "PendingSupplierNotification" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingSupplierNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingSupplierNotification_supplierId_idx" ON "PendingSupplierNotification"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingSupplierNotification_supplierId_orderId_key" ON "PendingSupplierNotification"("supplierId", "orderId");

-- AddForeignKey
ALTER TABLE "PendingSupplierNotification" ADD CONSTRAINT "PendingSupplierNotification_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingSupplierNotification" ADD CONSTRAINT "PendingSupplierNotification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

