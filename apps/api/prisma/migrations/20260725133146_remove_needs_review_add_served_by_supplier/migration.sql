-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "servedBySupplierId" TEXT;

-- AlterTable
ALTER TABLE "SupplierProfile" DROP COLUMN "needsReview";

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_servedBySupplierId_fkey" FOREIGN KEY ("servedBySupplierId") REFERENCES "SupplierProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

