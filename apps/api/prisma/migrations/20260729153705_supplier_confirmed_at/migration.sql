-- AlterTable
ALTER TABLE "SupplierProfile" ADD COLUMN     "confirmedAt" TIMESTAMP(3);

-- Backfill: every supplier that already exists got here through the WhatsApp
-- onboarding dialogue, which is itself an explicit opt-in. Leaving them NULL
-- would silently demote them to "cold" — they'd start receiving invitation
-- messages with a stripped-down summary instead of real dispatches.
UPDATE "SupplierProfile" SET "confirmedAt" = "createdAt" WHERE "confirmedAt" IS NULL;

