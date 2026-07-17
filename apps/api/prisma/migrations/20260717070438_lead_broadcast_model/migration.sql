-- DropForeignKey
ALTER TABLE "Offer" DROP CONSTRAINT "Offer_orderId_fkey";

-- DropForeignKey
ALTER TABLE "Offer" DROP CONSTRAINT "Offer_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "OfferStatusEvent" DROP CONSTRAINT "OfferStatusEvent_offerId_fkey";

-- AlterTable
ALTER TABLE "DispatchSettings" DROP COLUMN "autoClaimMode",
DROP COLUMN "escalateToOperatorMinutes",
DROP COLUMN "minOffersTarget",
DROP COLUMN "waveWaitMinutes",
ALTER COLUMN "waveSize" SET DEFAULT 15;

-- AlterTable
ALTER TABLE "DispatchWave" DROP COLUMN "waitMinutes";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "clientConfirmedCompletion",
DROP COLUMN "selectedOfferId",
DROP COLUMN "supplierConfirmedCompletion";

-- DropTable
DROP TABLE "Offer";

-- DropTable
DROP TABLE "OfferStatusEvent";

-- DropEnum
DROP TYPE "QuickResponseType";

