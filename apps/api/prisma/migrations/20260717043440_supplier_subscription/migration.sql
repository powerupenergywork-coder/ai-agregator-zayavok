-- AlterTable
ALTER TABLE "SupplierProfile" ADD COLUMN     "lastQuotaReminderAt" TIMESTAMP(3),
ADD COLUMN     "notificationsUsedThisMonth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quotaResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "SupplierSubscription" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NONE',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "paymentProvider" TEXT,
    "paymentReference" TEXT,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSubscription_supplierId_key" ON "SupplierSubscription"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSubscription_paymentReference_key" ON "SupplierSubscription"("paymentReference");

-- AddForeignKey
ALTER TABLE "SupplierSubscription" ADD CONSTRAINT "SupplierSubscription_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
