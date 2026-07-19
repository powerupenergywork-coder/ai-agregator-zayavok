-- AlterTable
ALTER TABLE "Category" DROP COLUMN "name",
ADD COLUMN     "name" JSONB NOT NULL DEFAULT '{}';
