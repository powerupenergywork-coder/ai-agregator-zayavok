-- AlterEnum
ALTER TYPE "QuickResponseType" ADD VALUE 'CLAIM';

-- AlterTable
ALTER TABLE "DispatchSettings" ADD COLUMN     "autoClaimMode" BOOLEAN NOT NULL DEFAULT true;
