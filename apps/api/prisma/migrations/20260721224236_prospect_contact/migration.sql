-- CreateTable
CREATE TABLE "ProspectContact" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "firstContactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'sent',
    "leadSource" TEXT NOT NULL DEFAULT 'cold_outreach',

    CONSTRAINT "ProspectContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProspectContact_phone_idx" ON "ProspectContact"("phone");

-- CreateIndex
CREATE INDEX "ProspectContact_status_idx" ON "ProspectContact"("status");

-- AddForeignKey
ALTER TABLE "ProspectContact" ADD CONSTRAINT "ProspectContact_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
