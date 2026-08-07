-- Что поставщик рассказал о себе своими словами (см. captureSupplierInfo).
ALTER TABLE "SupplierProfile" ADD COLUMN "selfDescription" TEXT;
ALTER TABLE "SupplierProfile" ADD COLUMN "selfDescriptionAt" TIMESTAMP(3);
