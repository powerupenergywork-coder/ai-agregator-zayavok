-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_servedBySupplierId_fkey";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "servedBySupplierId";

