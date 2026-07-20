-- AlterTable
ALTER TABLE "Category" ALTER COLUMN "name" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastInboundWhatsAppAt" TIMESTAMP(3);
